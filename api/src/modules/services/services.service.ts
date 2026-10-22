import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DeliveryOption, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { ListServicesDto } from "./dto/list-services.dto";
import { MarketplacePricingPolicy } from "../marketplace-pricing/marketplace-pricing.policy";

const pageSize = 20;

const serviceSearchDocument = Prisma.sql`(
  setweight(to_tsvector('simple', coalesce(s."title", '')), 'A') ||
  setweight(to_tsvector('simple', coalesce(s."description", '')), 'B')
)`;

const relatedSearchDocument = Prisma.sql`(
  setweight(to_tsvector('simple', coalesce(u."displayName", '')), 'A') ||
  setweight(to_tsvector('simple', coalesce(c."name", '')), 'A') ||
  setweight(to_tsvector('simple', coalesce(school."name", '')), 'B') ||
  setweight(to_tsvector('simple', coalesce(school."shortName", '')), 'A') ||
  setweight(to_tsvector('simple', coalesce(array_to_string(pp."skills", ' '), '')), 'B')
)`;

function normalizeSearchQuery(value?: string) {
  return value?.trim().replace(/\s+/g, " ").toLowerCase() ?? "";
}

function searchPredicate(query: string) {
  return Prisma.sql`(
    ${serviceSearchDocument} @@ websearch_to_tsquery('simple', ${query}) OR
    ${relatedSearchDocument} @@ websearch_to_tsquery('simple', ${query}) OR
    lower(s."title") LIKE '%' || ${query} || '%' OR
    lower(s."description") LIKE '%' || ${query} || '%' OR
    lower(u."displayName") LIKE '%' || ${query} || '%' OR
    lower(c."name") LIKE '%' || ${query} || '%' OR
    lower(school."name") LIKE '%' || ${query} || '%' OR
    lower(school."shortName") LIKE '%' || ${query} || '%' OR
    lower(s."title") % ${query} OR
    lower(u."displayName") % ${query} OR
    lower(c."name") % ${query} OR
    lower(school."name") % ${query} OR
    lower(school."shortName") % ${query} OR
    word_similarity(${query}, lower(s."description")) >= 0.45 OR
    EXISTS (
      SELECT 1 FROM unnest(pp."skills") AS skill
      WHERE lower(skill) LIKE '%' || ${query} || '%' OR lower(skill) % ${query}
    )
  )`;
}

function searchRank(query: string) {
  return Prisma.sql`(
    ts_rank_cd(${serviceSearchDocument}, websearch_to_tsquery('simple', ${query})) * 8 +
    ts_rank_cd(${relatedSearchDocument}, websearch_to_tsquery('simple', ${query})) * 5 +
    CASE
      WHEN lower(s."title") = ${query} THEN 4
      WHEN lower(s."title") LIKE '%' || ${query} || '%' THEN 2
      ELSE 0
    END +
    CASE WHEN lower(c."name") = ${query} THEN 2 ELSE 0 END +
    GREATEST(
      similarity(lower(s."title"), ${query}) * 3,
      similarity(lower(u."displayName"), ${query}) * 2,
      similarity(lower(c."name"), ${query}) * 2,
      similarity(lower(school."name"), ${query}),
      similarity(lower(school."shortName"), ${query}) * 2,
      word_similarity(${query}, lower(s."description")),
      coalesce((
        SELECT max(similarity(lower(skill), ${query}))
        FROM unnest(pp."skills") AS skill
      ), 0)
    )
  )`;
}

function budgetBounds(
  range: ListServicesDto["budgetRange"],
): [number, number | null] | null {
  switch (range) {
    case "under-500":
      return [0, 50000];
    case "500-999":
      return [50000, 100000];
    case "1000-2499":
      return [100000, 250000];
    case "2500-4999":
      return [250000, 500000];
    case "5000-plus":
      return [500000, null];
    default:
      return null;
  }
}

@Injectable()
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing?: MarketplacePricingPolicy,
  ) {}
  async findAll(filters: ListServicesDto = {}, savedByUserId?: string) {
    const page = filters.page ?? 1;
    const clauses: Prisma.Sql[] = [
      Prisma.sql`s."status" = 'PUBLISHED' AND s."deletedAt" IS NULL`,
      Prisma.sql`pp."isAvailable" = TRUE AND school."status" = 'ACTIVE'`,
      Prisma.sql`(
        (s."pricingModel" = 'LEGACY_PACKAGES' AND price."minimumPrice" IS NOT NULL) OR
        (s."pricingModel" = 'SINGLE_PRICE_V2' AND s."basePriceCentavos" IS NOT NULL AND s."normalDeliveryMinutes" IS NOT NULL AND s."includedRevisionLimit" IS NOT NULL)
      )`,
    ];
    if (savedByUserId)
      clauses.push(
        Prisma.sql`EXISTS (SELECT 1 FROM "SavedService" saved WHERE saved."serviceId" = s."id" AND saved."userId" = ${savedByUserId}::uuid)`,
      );
    const query = normalizeSearchQuery(filters.query);
    if (query) clauses.push(searchPredicate(query));
    if (filters.category)
      clauses.push(Prisma.sql`c."name" = ${filters.category}`);
    if (filters.schoolId)
      clauses.push(Prisma.sql`sp."schoolId" = ${filters.schoolId}::uuid`);
    const bounds = budgetBounds(filters.budgetRange);
    if (bounds) {
      clauses.push(Prisma.sql`price."minimumPrice" >= ${bounds[0]}`);
      if (bounds[1] !== null)
        clauses.push(Prisma.sql`price."minimumPrice" < ${bounds[1]}`);
    }
    if (filters.minimumRating)
      clauses.push(Prisma.sql`sp."ratingAverage" >= ${filters.minimumRating}`);
    if (filters.maximumDeliveryDays)
      clauses.push(
        Prisma.sql`price."minimumDeliveryMinutes" <= ${filters.maximumDeliveryDays * 1440}`,
      );

    const from = Prisma.sql`
      FROM "Service" s
      JOIN "User" u ON u."id" = s."providerId"
      JOIN "ProviderProfile" pp ON pp."userId" = u."id"
      JOIN "StudentProfile" sp ON sp."userId" = u."id"
      JOIN "School" school ON school."id" = sp."schoolId"
      JOIN "Category" c ON c."id" = s."categoryId"
      LEFT JOIN LATERAL (
        SELECT
          CASE WHEN s."pricingModel" = 'SINGLE_PRICE_V2'
            THEN s."basePriceCentavos"
            ELSE MIN(pkg."priceCentavos")
          END AS "minimumPrice",
          CASE WHEN s."pricingModel" = 'SINGLE_PRICE_V2'
            THEN s."normalDeliveryMinutes"
            ELSE MIN(pkg."deliveryDays") * 1440
          END AS "minimumDeliveryMinutes"
        FROM "ServicePackage" pkg WHERE pkg."serviceId" = s."id" AND pkg."isActive" = TRUE
      ) price ON TRUE
      WHERE ${Prisma.join(clauses, " AND ")}`;
    const order = (() => {
      const relevance = query ? searchRank(query) : null;
      switch (filters.sort) {
        case "rating":
          return relevance
            ? Prisma.sql`sp."ratingAverage" DESC, ${relevance} DESC, s."publishedAt" DESC, s."id" DESC`
            : Prisma.sql`sp."ratingAverage" DESC, s."publishedAt" DESC, s."id" DESC`;
        case "price-low":
          return relevance
            ? Prisma.sql`price."minimumPrice" ASC NULLS LAST, ${relevance} DESC, s."publishedAt" DESC, s."id" DESC`
            : Prisma.sql`price."minimumPrice" ASC NULLS LAST, s."publishedAt" DESC, s."id" DESC`;
        case "delivery-fast":
          return relevance
            ? Prisma.sql`price."minimumDeliveryMinutes" ASC NULLS LAST, ${relevance} DESC, s."publishedAt" DESC, s."id" DESC`
            : Prisma.sql`price."minimumDeliveryMinutes" ASC NULLS LAST, s."publishedAt" DESC, s."id" DESC`;
        case "newest":
          return Prisma.sql`s."publishedAt" DESC, s."id" DESC`;
        default:
          return relevance
            ? Prisma.sql`${relevance} DESC, sp."ratingAverage" DESC, s."publishedAt" DESC, s."id" DESC`
            : Prisma.sql`s."publishedAt" DESC, s."id" DESC`;
      }
    })();
    const [count] = await this.prisma.$queryRaw<{ total: bigint }[]>(
      Prisma.sql`SELECT COUNT(*)::bigint AS total ${from}`,
    );
    const total = Number(count?.total ?? 0);
    const ids = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT s."id" ${from} ORDER BY ${order} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`);
    if (ids.length === 0)
      return { data: [], page, pageSize, total, hasMore: false };
    const services = await this.prisma.service.findMany({
      where: {
        id: { in: ids.map((item) => item.id) },
        status: "PUBLISHED",
        deletedAt: null,
      },
      include: {
        category: true,
        provider: {
          include: {
            studentProfile: { include: { school: true } },
            providerProfile: true,
          },
        },
        packages: {
          where: { isActive: true },
          orderBy: { priceCentavos: "asc" },
        },
        media: { orderBy: [{ kind: "asc" }, { sortOrder: "asc" }] },
      },
    });
    const pendingOrders = await this.providerPendingOrders(
      services.map((service) => service.providerId),
    );
    const byId = new Map(services.map((service) => [service.id, service]));
    return {
      data: ids
        .map(({ id }) => byId.get(id))
        .filter((service) => service !== undefined)
        .map((service) =>
          this.toResponse(service, pendingOrders.get(service.providerId)),
        ),
      page,
      pageSize,
      total,
      hasMore: page * pageSize < total,
    };
  }
  async savedIds(userId: string) {
    const saved = await this.prisma.savedService.findMany({
      where: { userId },
      select: { serviceId: true },
    });
    return { data: saved.map(({ serviceId }) => serviceId) };
  }
  async save(userId: string, serviceId: string) {
    await this.findOne(serviceId);
    await this.prisma.savedService.createMany({
      data: [{ userId, serviceId }],
      skipDuplicates: true,
    });
    return { saved: true };
  }
  async unsave(userId: string, serviceId: string) {
    await this.prisma.savedService.deleteMany({ where: { userId, serviceId } });
    return { saved: false };
  }
  async findOne(id: string) {
    const service = await this.prisma.service.findFirst({
      where: {
        id,
        status: "PUBLISHED",
        deletedAt: null,
        OR: [
          {
            pricingModel: "LEGACY_PACKAGES",
            packages: { some: { isActive: true } },
          },
          {
            pricingModel: "SINGLE_PRICE_V2",
            basePriceCentavos: { not: null },
            normalDeliveryMinutes: { not: null },
            includedRevisionLimit: { not: null },
          },
        ],
        provider: {
          providerProfile: { isAvailable: true },
          studentProfile: { school: { status: "ACTIVE" } },
        },
      },
      include: {
        category: true,
        provider: {
          include: {
            studentProfile: { include: { school: true } },
            providerProfile: true,
          },
        },
        packages: {
          where: { isActive: true },
          orderBy: { priceCentavos: "asc" },
        },
        media: { orderBy: [{ kind: "asc" }, { sortOrder: "asc" }] },
      },
    });
    if (!service) throw new NotFoundException("Service not found");
    const pendingOrders = await this.providerPendingOrders([
      service.providerId,
    ]);
    return this.toResponse(service, pendingOrders.get(service.providerId));
  }
  async quote(userId: string, id: string, deliveryOption: DeliveryOption) {
    const service = await this.prisma.service.findFirst({
      where: {
        id,
        status: "PUBLISHED",
        deletedAt: null,
        pricingModel: "SINGLE_PRICE_V2",
        basePriceCentavos: { not: null },
        normalDeliveryMinutes: { not: null },
        includedRevisionLimit: { not: null },
        provider: {
          providerProfile: { isAvailable: true },
          studentProfile: { school: { status: "ACTIVE" } },
        },
      },
      select: {
        providerId: true,
        basePriceCentavos: true,
        normalDeliveryMinutes: true,
        includedRevisionLimit: true,
        acceptsRushOrders: true,
        fastestRushTier: true,
        provider: {
          select: {
            providerProfile: { select: { maxPendingOrders: true } },
          },
        },
      },
    });
    if (!service) throw new NotFoundException("Service is no longer available");
    if (service.providerId === userId)
      throw new BadRequestException("You cannot order your own service");
    const pendingOrders = await this.prisma.order.count({
      where: { providerId: service.providerId, status: "REQUESTED" },
    });
    if (
      pendingOrders >=
      (service.provider.providerProfile?.maxPendingOrders ?? 50)
    )
      throw new ConflictException(
        "This provider's request queue is currently full. Please try again later.",
      );
    if (!this.pricing)
      throw new Error("Marketplace pricing policy is unavailable");
    const terms = {
      basePriceCentavos: service.basePriceCentavos!,
      normalDeliveryMinutes: service.normalDeliveryMinutes!,
      includedRevisionLimit: service.includedRevisionLimit!,
      acceptsRushOrders: service.acceptsRushOrders,
      fastestRushTier: service.fastestRushTier,
    };
    return {
      data: {
        ...this.pricing.quote(terms, deliveryOption),
        eligibleDeliveryOptions: this.pricing.eligibleDeliveryOptions(terms),
      },
    };
  }
  async getPublicMedia(serviceId: string, mediaId: string) {
    const media = await this.prisma.serviceMedia.findFirst({
      where: {
        id: mediaId,
        serviceId,
        service: {
          status: "PUBLISHED",
          deletedAt: null,
          provider: {
            studentProfile: { school: { status: "ACTIVE" } },
          },
        },
      },
    });
    if (!media) throw new NotFoundException("Service media not found");
    return media;
  }
  private async providerPendingOrders(providerIds: string[]) {
    const uniqueIds = [...new Set(providerIds)];
    if (uniqueIds.length === 0) return new Map<string, number>();
    const groups = await this.prisma.order.groupBy({
      by: ["providerId"],
      where: {
        providerId: { in: uniqueIds },
        status: "REQUESTED",
      },
      _count: { _all: true },
    });
    const pendingOrders = new Map(
      uniqueIds.map((providerId) => [providerId, 0]),
    );
    for (const group of groups)
      pendingOrders.set(group.providerId, group._count._all);
    return pendingOrders;
  }

  private toResponse(service: any, pendingOrders = 0) {
    const profile = service.provider.studentProfile;
    const providerProfile = service.provider.providerProfile;
    const singlePrice = service.pricingModel === "SINGLE_PRICE_V2";
    const deliveryMinutes = singlePrice
      ? service.normalDeliveryMinutes
      : service.packages[0]?.deliveryDays * 1440;
    return {
      id: service.id,
      title: service.title,
      description: service.description,
      pricingModel: service.pricingModel ?? "LEGACY_PACKAGES",
      basePriceCentavos: service.basePriceCentavos,
      normalDeliveryMinutes: service.normalDeliveryMinutes,
      includedRevisionLimit: service.includedRevisionLimit,
      acceptsRushOrders: service.acceptsRushOrders,
      fastestRushTier: service.fastestRushTier,
      providerId: service.provider.id,
      provider: service.provider.displayName,
      initials: service.provider.displayName
        .split(" ")
        .map((part: string) => part[0])
        .slice(0, 2)
        .join(""),
      providerHasAvatar: Boolean(service.provider.avatarPath),
      providerAvatarVersion:
        service.provider.updatedAt?.getTime?.() ?? Date.now(),
      program: profile?.program ?? "",
      schoolId: profile?.schoolId ?? "",
      school: profile?.school?.name ?? "",
      category: service.category.name,
      price:
        (singlePrice
          ? service.basePriceCentavos
          : (service.packages[0]?.priceCentavos ?? 0)) / 100,
      rating: Number(profile?.ratingAverage ?? 0),
      reviews: profile?.reviewCount ?? 0,
      acceptingOrders:
        providerProfile?.isAvailable === true &&
        pendingOrders < (providerProfile?.maxPendingOrders ?? 50),
      publishedAt: service.publishedAt,
      delivery: deliveryMinutes ? this.formatDelivery(deliveryMinutes) : "",
      packages: service.packages,
      coverMediaId:
        service.media.find((item: any) => item.kind === "COVER")?.id ?? null,
      portfolio: service.media
        .filter((item: any) => item.kind === "PORTFOLIO")
        .map((item: any) => ({
          id: item.id,
          originalName: item.originalName,
          mimeType: item.mimeType,
        })),
    };
  }

  private formatDelivery(minutes: number) {
    if (minutes % 1440 === 0) {
      const days = minutes / 1440;
      return `${days} day${days === 1 ? "" : "s"}`;
    }
    if (minutes % 60 === 0) {
      const hours = minutes / 60;
      return `${hours} hour${hours === 1 ? "" : "s"}`;
    }
    return `${minutes} minutes`;
  }
}
