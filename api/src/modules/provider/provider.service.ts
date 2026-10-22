import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { RushTier, ServicePricingModel, ServiceStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { StorageService } from "../../common/storage/storage.service";
import type { CreateServiceDto } from "./dto/create-service.dto";
import type { UpdateProviderProfileDto } from "./dto/update-provider-profile.dto";
import { MessagesGateway } from "../messages/messages.gateway";
import { normalizeProviderSocialLinks } from "./provider-social-links";
import { validateProviderRushSettings } from "../marketplace-pricing/marketplace-pricing.policy";

@Injectable()
export class ProviderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly realtime: MessagesGateway,
  ) {}

  async dashboard(userId: string) {
    const [
      profile,
      activeOrders,
      pendingRequests,
      completedOrders,
      student,
      reviewAggregate,
      serviceCount,
      publishedServiceCount,
    ] = await Promise.all([
      this.prisma.providerProfile.findUnique({ where: { userId } }),
      this.prisma.order.count({
        where: {
          providerId: userId,
          status: {
            in: ["ACCEPTED", "IN_PROGRESS", "SUBMITTED", "REVISION_REQUESTED"],
          },
        },
      }),
      this.prisma.order.count({
        where: { providerId: userId, status: "REQUESTED" },
      }),
      this.prisma.order.count({
        where: { providerId: userId, status: "COMPLETED" },
      }),
      this.prisma.studentProfile.findUnique({
        where: { userId },
        select: {
          verificationStatus: true,
        },
      }),
      this.prisma.review.aggregate({
        where: { revieweeId: userId, order: { status: "COMPLETED" } },
        _avg: { overallRating: true },
        _count: { _all: true },
      }),
      this.prisma.service.count({
        where: { providerId: userId, deletedAt: null },
      }),
      this.prisma.service.count({
        where: {
          providerId: userId,
          deletedAt: null,
          status: "PUBLISHED",
        },
      }),
    ]);
    const hasCompleteIdentity = Boolean(
      profile?.headline.trim() &&
        profile.bio.trim() &&
        profile.skills.some((skill) => skill.trim().length > 0),
    );
    const profileStrength =
      (hasCompleteIdentity ? 34 : 0) +
      (serviceCount > 0 ? 33 : 0) +
      (publishedServiceCount > 0 ? 33 : 0);
    return {
      activeOrders,
      pendingRequests,
      completedOrders,
      averageRating: Number(reviewAggregate._avg.overallRating ?? 0),
      reviewCount: reviewAggregate._count._all,
      profileStrength,
      verified: student?.verificationStatus === "APPROVED",
      maxActiveOrders: profile?.maxActiveOrders ?? 5,
      maxPendingOrders: profile?.maxPendingOrders ?? 50,
      acceptingOrders:
        profile?.isAvailable === true &&
        pendingRequests < (profile?.maxPendingOrders ?? 50),
    };
  }

  async getProfile(userId: string) {
    return {
      data: await this.prisma.providerProfile.findUnique({ where: { userId } }),
    };
  }

  async getPublicProfile(userId: string) {
    const [provider, reviewAggregate, completedOrders] = await Promise.all([
      this.prisma.user.findFirst({
        where: {
          id: userId,
          status: "ACTIVE",
          roles: { some: { role: "PROVIDER" } },
          providerProfile: { isNot: null },
          studentProfile: { school: { status: "ACTIVE" } },
        },
        select: {
          id: true,
          displayName: true,
          avatarPath: true,
          createdAt: true,
          updatedAt: true,
          providerProfile: {
            select: {
              headline: true,
              bio: true,
              skills: true,
              isAvailable: true,
              instagramUrl: true,
              linkedinUrl: true,
              xUrl: true,
              portfolioUrl: true,
            },
          },
          studentProfile: {
            select: {
              program: true,
              verificationStatus: true,
              school: {
                select: {
                  id: true,
                  name: true,
                  shortName: true,
                  city: true,
                },
              },
            },
          },
          services: {
            where: { status: "PUBLISHED", deletedAt: null },
            orderBy: { publishedAt: "desc" },
            take: 12,
            select: {
              id: true,
              title: true,
              description: true,
              pricingModel: true,
              basePriceCentavos: true,
              normalDeliveryMinutes: true,
              includedRevisionLimit: true,
              acceptsRushOrders: true,
              fastestRushTier: true,
              publishedAt: true,
              category: { select: { name: true } },
              packages: {
                where: { isActive: true },
                orderBy: { priceCentavos: "asc" },
                select: {
                  id: true,
                  tier: true,
                  name: true,
                  description: true,
                  priceCentavos: true,
                  deliveryDays: true,
                  revisionLimit: true,
                },
              },
              media: {
                orderBy: [{ kind: "asc" }, { sortOrder: "asc" }],
                select: {
                  id: true,
                  kind: true,
                  originalName: true,
                  mimeType: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.review.aggregate({
        where: { revieweeId: userId, order: { status: "COMPLETED" } },
        _avg: { overallRating: true },
        _count: { _all: true },
      }),
      this.prisma.order.count({
        where: { providerId: userId, status: "COMPLETED" },
      }),
    ]);

    if (!provider?.providerProfile || !provider.studentProfile)
      throw new NotFoundException("Provider profile not found");

    const student = provider.studentProfile;
    const initials = provider.displayName
      .split(" ")
      .map((part) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("");
    const services = provider.services.map((service) => {
      const singlePrice = service.pricingModel === "SINGLE_PRICE_V2";
      const deliveryMinutes = singlePrice
        ? service.normalDeliveryMinutes
        : (service.packages[0]?.deliveryDays ?? 0) * 1440;
      return {
        id: service.id,
        title: service.title,
        description: service.description,
        pricingModel: service.pricingModel,
        basePriceCentavos: service.basePriceCentavos,
        normalDeliveryMinutes: service.normalDeliveryMinutes,
        includedRevisionLimit: service.includedRevisionLimit,
        acceptsRushOrders: service.acceptsRushOrders,
        fastestRushTier: service.fastestRushTier,
        providerId: provider.id,
        provider: provider.displayName,
        providerHasAvatar: Boolean(provider.avatarPath),
        providerAvatarVersion: provider.updatedAt.getTime(),
        initials,
        program: student.program ?? "",
        schoolId: student.school.id,
        school: student.school.name,
        category: service.category.name,
        price:
          (singlePrice
            ? (service.basePriceCentavos ?? 0)
            : (service.packages[0]?.priceCentavos ?? 0)) / 100,
        rating: Number(reviewAggregate._avg.overallRating ?? 0),
        reviews: reviewAggregate._count._all,
        publishedAt: service.publishedAt,
        delivery: deliveryMinutes
          ? deliveryMinutes % 1440 === 0
            ? `${deliveryMinutes / 1440} day${deliveryMinutes === 1440 ? "" : "s"}`
            : deliveryMinutes % 60 === 0
              ? `${deliveryMinutes / 60} hour${deliveryMinutes === 60 ? "" : "s"}`
              : `${deliveryMinutes} minutes`
          : "",
        packages: service.packages,
        coverMediaId:
          service.media.find((item) => item.kind === "COVER")?.id ?? null,
        portfolio: service.media
          .filter((item) => item.kind === "PORTFOLIO")
          .map((item) => ({
            id: item.id,
            originalName: item.originalName,
            mimeType: item.mimeType,
          })),
      };
    });

    return {
      data: {
        id: provider.id,
        displayName: provider.displayName,
        hasAvatar: Boolean(provider.avatarPath),
        avatarVersion: provider.updatedAt.getTime(),
        memberSince: provider.createdAt,
        headline: provider.providerProfile.headline,
        bio: provider.providerProfile.bio,
        skills: provider.providerProfile.skills,
        isAvailable: provider.providerProfile.isAvailable,
        socialLinks: {
          instagram: provider.providerProfile.instagramUrl,
          linkedin: provider.providerProfile.linkedinUrl,
          x: provider.providerProfile.xUrl,
          portfolio: provider.providerProfile.portfolioUrl,
        },
        verified: student.verificationStatus === "APPROVED",
        program: student.program,
        school: student.school,
        rating: Number(reviewAggregate._avg.overallRating ?? 0),
        reviewCount: reviewAggregate._count._all,
        completedOrders,
        services,
      },
    };
  }

  async getPublicReviews(userId: string, page = 1, pageSize = 5) {
    const provider = await this.prisma.user.findFirst({
      where: {
        id: userId,
        status: "ACTIVE",
        roles: { some: { role: "PROVIDER" } },
        providerProfile: { isNot: null },
        studentProfile: { school: { status: "ACTIVE" } },
      },
      select: {
        id: true,
        studentProfile: {
          select: { ratingAverage: true, reviewCount: true },
        },
      },
    });
    if (!provider?.studentProfile)
      throw new NotFoundException("Provider profile not found");

    const where = {
      revieweeId: userId,
      order: { status: "COMPLETED" as const },
    };
    const total = await this.prisma.review.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const [reviews, groupedRatings] = await Promise.all([
      this.prisma.review.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (safePage - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          overallRating: true,
          qualityRating: true,
          communicationRating: true,
          timelinessRating: true,
          comment: true,
          createdAt: true,
          reviewer: { select: { displayName: true } },
          order: { select: { titleSnapshot: true } },
        },
      }),
      this.prisma.review.groupBy({
        by: ["overallRating"],
        where,
        _count: { _all: true },
      }),
    ]);

    const counts = new Map(
      groupedRatings.map((item) => [item.overallRating, item._count._all]),
    );
    const average =
      total === 0
        ? 0
        : groupedRatings.reduce(
            (sum, item) => sum + item.overallRating * item._count._all,
            0,
          ) / total;
    return {
      data: reviews.map((review) => ({
        id: review.id,
        overallRating: review.overallRating,
        qualityRating: review.qualityRating,
        communicationRating: review.communicationRating,
        timelinessRating: review.timelinessRating,
        comment: review.comment,
        createdAt: review.createdAt,
        reviewerLabel: this.publicReviewerLabel(review.reviewer.displayName),
        serviceTitle: review.order.titleSnapshot,
      })),
      summary: {
        average: Math.round(average * 100) / 100,
        total,
        distribution: [5, 4, 3, 2, 1].map((rating) => ({
          rating,
          count: counts.get(rating) ?? 0,
        })),
      },
      pagination: {
        page: safePage,
        pageSize,
        total,
        totalPages,
      },
    };
  }

  private publicReviewerLabel(displayName: string) {
    const parts = displayName.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "CampusGig client";
    if (parts.length === 1) return parts[0];
    return `${parts[0]} ${parts.at(-1)?.[0] ?? ""}.`;
  }

  async updateProfile(userId: string, input: UpdateProviderProfileDto) {
    await this.requireVerified(userId);
    const data = {
      headline: input.headline.trim(),
      bio: input.bio.trim(),
      skills: [
        ...new Set(input.skills.map((skill) => skill.trim()).filter(Boolean)),
      ],
      isAvailable: input.isAvailable ?? true,
      ...normalizeProviderSocialLinks(input),
    };
    if (!data.skills.length)
      throw new BadRequestException("Add at least one skill");
    const profile = await this.prisma.providerProfile.upsert({
      where: { userId },
      create: {
        userId,
        ...data,
        maxActiveOrders: input.maxActiveOrders ?? 5,
        maxPendingOrders: input.maxPendingOrders ?? 50,
      },
      update: {
        ...data,
        ...(input.maxActiveOrders === undefined
          ? {}
          : { maxActiveOrders: input.maxActiveOrders }),
        ...(input.maxPendingOrders === undefined
          ? {}
          : { maxPendingOrders: input.maxPendingOrders }),
      },
    });
    this.realtime.publishAccountChanged(userId, "provider-profile");
    this.realtime.publishMarketplaceChanged?.("provider", userId);
    return { data: profile };
  }

  async updateAvailability(userId: string, isAvailable: boolean) {
    await this.requireVerified(userId);
    const profile = await this.prisma.providerProfile.findUnique({
      where: { userId },
      select: { userId: true },
    });
    if (!profile)
      throw new BadRequestException(
        "Complete your provider profile before changing availability",
      );
    const updated = await this.prisma.providerProfile.update({
      where: { userId },
      data: { isAvailable },
    });
    this.realtime.publishAccountChanged(userId, "provider-profile");
    this.realtime.publishMarketplaceChanged?.("provider", userId);
    return {
      data: updated,
      message: isAvailable
        ? "You are online and accepting new requests"
        : "You are offline and your services are paused",
    };
  }

  async listServices(userId: string) {
    return {
      data: await this.prisma.service.findMany({
        where: { providerId: userId, deletedAt: null },
        include: {
          category: true,
          packages: { orderBy: { priceCentavos: "asc" } },
          media: { orderBy: [{ kind: "asc" }, { sortOrder: "asc" }] },
        },
        orderBy: { updatedAt: "desc" },
      }),
    };
  }

  async createService(userId: string, input: CreateServiceDto) {
    await this.requireVerified(userId);
    const profile = await this.prisma.providerProfile.findUnique({
      where: { userId },
      select: { userId: true },
    });
    if (!profile)
      throw new BadRequestException(
        "Complete your provider profile before creating a service",
      );
    const category = await this.prisma.category.findFirst({
      where: { id: input.categoryId, isActive: true },
      select: { id: true },
    });
    if (!category)
      throw new BadRequestException("Select an active service category");
    const pricingModel =
      input.pricingModel ?? ServicePricingModel.LEGACY_PACKAGES;
    this.validateServiceTerms(pricingModel, input);
    const slugBase =
      input.title
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")
        .slice(0, 80) || "service";
    const slug = `${slugBase}-${Date.now().toString(36)}`;
    const created = await this.prisma.service.create({
      data: {
        providerId: userId,
        categoryId: input.categoryId,
        pricingModel,
        basePriceCentavos:
          pricingModel === ServicePricingModel.SINGLE_PRICE_V2
            ? input.basePriceCentavos
            : null,
        normalDeliveryMinutes:
          pricingModel === ServicePricingModel.SINGLE_PRICE_V2
            ? input.normalDeliveryMinutes
            : null,
        includedRevisionLimit:
          pricingModel === ServicePricingModel.SINGLE_PRICE_V2
            ? input.includedRevisionLimit
            : null,
        acceptsRushOrders:
          pricingModel === ServicePricingModel.SINGLE_PRICE_V2
            ? (input.acceptsRushOrders ?? false)
            : false,
        fastestRushTier:
          pricingModel === ServicePricingModel.SINGLE_PRICE_V2 &&
          input.acceptsRushOrders
            ? input.fastestRushTier
            : null,
        title: input.title.trim(),
        slug,
        description: input.description.trim(),
        deliveryMethod: input.deliveryMethod,
        campusLocation: input.campusLocation?.trim() || null,
        ...(pricingModel === ServicePricingModel.LEGACY_PACKAGES
          ? {
              packages: {
                create: input.packages!.map((item) => ({
                  ...item,
                  name: item.name.trim(),
                  description: item.description.trim(),
                })),
              },
            }
          : {}),
      },
      include: { category: true, packages: true, media: true },
    });
    this.realtime.publishAccountChanged(userId, "services");
    return { data: created };
  }

  async updateService(userId: string, id: string, input: CreateServiceDto) {
    await this.requireVerified(userId);
    const service = await this.prisma.service.findFirst({
      where: { id, providerId: userId, deletedAt: null },
      select: { status: true, pricingModel: true },
    });
    if (!service) throw new NotFoundException("Service not found");
    if (input.pricingModel && input.pricingModel !== service.pricingModel)
      throw new ConflictException(
        "A service pricing model cannot be converted after creation",
      );
    if (service.status !== "DRAFT" && service.status !== "REJECTED")
      throw new ConflictException(
        "Only draft or rejected services can be edited",
      );
    const category = await this.prisma.category.findFirst({
      where: { id: input.categoryId, isActive: true },
      select: { id: true },
    });
    if (!category)
      throw new BadRequestException("Select an active service category");
    this.validateServiceTerms(service.pricingModel, input);
    const updated = await this.prisma.$transaction(async (database) => {
      if (service.pricingModel === ServicePricingModel.LEGACY_PACKAGES)
        await database.servicePackage.deleteMany({ where: { serviceId: id } });
      return database.service.update({
        where: { id },
        data: {
          categoryId: input.categoryId,
          title: input.title.trim(),
          description: input.description.trim(),
          deliveryMethod: input.deliveryMethod,
          campusLocation: input.campusLocation?.trim() || null,
          rejectionReason: null,
          basePriceCentavos:
            service.pricingModel === ServicePricingModel.SINGLE_PRICE_V2
              ? input.basePriceCentavos
              : null,
          normalDeliveryMinutes:
            service.pricingModel === ServicePricingModel.SINGLE_PRICE_V2
              ? input.normalDeliveryMinutes
              : null,
          includedRevisionLimit:
            service.pricingModel === ServicePricingModel.SINGLE_PRICE_V2
              ? input.includedRevisionLimit
              : null,
          acceptsRushOrders:
            service.pricingModel === ServicePricingModel.SINGLE_PRICE_V2
              ? (input.acceptsRushOrders ?? false)
              : false,
          fastestRushTier:
            service.pricingModel === ServicePricingModel.SINGLE_PRICE_V2 &&
            input.acceptsRushOrders
              ? input.fastestRushTier
              : null,
          ...(service.pricingModel === ServicePricingModel.LEGACY_PACKAGES
            ? {
                packages: {
                  create: input.packages!.map((item) => ({
                    ...item,
                    name: item.name.trim(),
                    description: item.description.trim(),
                  })),
                },
              }
            : {}),
        },
        include: {
          category: true,
          packages: { orderBy: { priceCentavos: "asc" } },
          media: { orderBy: [{ kind: "asc" }, { sortOrder: "asc" }] },
        },
      });
    });
    this.realtime.publishAccountChanged(userId, "services");
    return { data: updated };
  }

  async submitService(userId: string, id: string) {
    const service = await this.prisma.service.findFirst({
      where: { id, providerId: userId, deletedAt: null },
      include: { packages: { where: { isActive: true } } },
    });
    if (!service) throw new NotFoundException("Service not found");
    if (service.status !== "DRAFT" && service.status !== "REJECTED")
      throw new ConflictException(
        "Only draft or rejected services can be submitted",
      );
    this.validateStoredServiceTerms(service);
    const submitted = await this.prisma.service.update({
      where: { id },
      data: {
        status: "PENDING_REVIEW",
        reviewedAt: null,
        reviewedBy: null,
        rejectionReason: null,
      },
    });
    this.realtime.publishAccountChanged(userId, "services");
    return { data: submitted };
  }

  async reviseService(userId: string, id: string) {
    const service = await this.prisma.service.findFirst({
      where: { id, providerId: userId, deletedAt: null },
      select: { status: true },
    });
    if (!service) throw new NotFoundException("Service not found");
    if (
      service.status !== ServiceStatus.PUBLISHED &&
      service.status !== ServiceStatus.PAUSED
    )
      throw new ConflictException(
        "Only published or paused services can start a revision",
      );

    const result = await this.prisma.service.updateMany({
      where: {
        id,
        providerId: userId,
        deletedAt: null,
        status: service.status,
      },
      data: {
        status: ServiceStatus.DRAFT,
        publishedAt: null,
        reviewedAt: null,
        reviewedBy: null,
        rejectionReason: null,
      },
    });
    if (result.count !== 1)
      throw new ConflictException(
        "The listing changed in another session. Refresh and try again.",
      );

    const updated = await this.prisma.service.findFirstOrThrow({
      where: { id, providerId: userId, deletedAt: null },
      include: {
        category: true,
        packages: { orderBy: { priceCentavos: "asc" } },
        media: { orderBy: [{ kind: "asc" }, { sortOrder: "asc" }] },
      },
    });
    this.realtime.publishMarketplaceChanged("service", id);
    this.realtime.publishAccountChanged(userId, "services");
    return {
      data: updated,
      message:
        "Listing moved to a private draft. Edit and resubmit it for administrator review.",
    };
  }

  pauseService(userId: string, id: string) {
    return this.transitionServiceStatus(
      userId,
      id,
      [ServiceStatus.PUBLISHED],
      ServiceStatus.PAUSED,
      "Listing paused and removed from the marketplace",
    );
  }

  resumeService(userId: string, id: string) {
    return this.transitionServiceStatus(
      userId,
      id,
      [ServiceStatus.PAUSED],
      ServiceStatus.PUBLISHED,
      "Listing is visible in the marketplace again",
    );
  }

  archiveService(userId: string, id: string) {
    return this.transitionServiceStatus(
      userId,
      id,
      [ServiceStatus.PUBLISHED, ServiceStatus.PAUSED],
      ServiceStatus.ARCHIVED,
      "Listing archived",
    );
  }

  restoreService(userId: string, id: string) {
    return this.transitionServiceStatus(
      userId,
      id,
      [ServiceStatus.ARCHIVED],
      ServiceStatus.PAUSED,
      "Listing restored in a paused state",
    );
  }

  async uploadServiceMedia(
    userId: string,
    id: string,
    files: { cover?: Express.Multer.File[]; portfolio?: Express.Multer.File[] },
  ) {
    const uploaded = [...(files.cover ?? []), ...(files.portfolio ?? [])];
    const stored = new Map<Express.Multer.File, string>();
    if (!uploaded.length)
      throw new BadRequestException("Select a cover image or portfolio file");
    try {
      const service = await this.prisma.service.findFirst({
        where: { id, providerId: userId, deletedAt: null },
        include: { media: true },
      });
      if (!service) throw new NotFoundException("Service not found");
      if (service.status !== "DRAFT" && service.status !== "REJECTED")
        throw new ConflictException(
          "Media can only be changed on draft or rejected services",
        );
      const portfolioFiles = files.portfolio ?? [];
      const currentPortfolio = service.media.filter(
        (item) => item.kind === "PORTFOLIO",
      ).length;
      if (currentPortfolio + portfolioFiles.length > 5)
        throw new BadRequestException(
          "A service can have up to five portfolio files",
        );
      const oldCover = service.media.find((item) => item.kind === "COVER");
      const storagePaths = await this.storage.persistUploads(
        "service-media",
        uploaded,
      );
      uploaded.forEach((file, index) => stored.set(file, storagePaths[index]));
      const result = await this.prisma.$transaction(async (database) => {
        if (files.cover?.[0] && oldCover)
          await database.serviceMedia.delete({ where: { id: oldCover.id } });
        if (files.cover?.[0]) {
          const cover = files.cover[0];
          await database.serviceMedia.create({
            data: {
              serviceId: id,
              kind: "COVER",
              storagePath: stored.get(cover)!,
              originalName: cover.originalname,
              mimeType: cover.mimetype,
              sizeBytes: cover.size,
            },
          });
        }
        if (portfolioFiles.length)
          await database.serviceMedia.createMany({
            data: portfolioFiles.map((file, index) => ({
              serviceId: id,
              kind: "PORTFOLIO",
              storagePath: stored.get(file)!,
              originalName: file.originalname,
              mimeType: file.mimetype,
              sizeBytes: file.size,
              sortOrder: currentPortfolio + index,
            })),
          });
        return database.serviceMedia.findMany({
          where: { serviceId: id },
          orderBy: [{ kind: "asc" }, { sortOrder: "asc" }],
        });
      });
      if (files.cover?.[0] && oldCover)
        await this.storage.delete("service-media", oldCover.storagePath);
      this.realtime.publishAccountChanged(userId, "services");
      return { data: result };
    } catch (error) {
      await Promise.all(
        uploaded.map((file) => {
          const key = stored.get(file);
          return key
            ? this.storage.delete("service-media", key)
            : this.storage.discardUpload(file);
        }),
      );
      throw error;
    }
  }

  async removeServiceMedia(userId: string, serviceId: string, mediaId: string) {
    const media = await this.prisma.serviceMedia.findFirst({
      where: {
        id: mediaId,
        serviceId,
        service: { providerId: userId, deletedAt: null },
      },
      include: { service: { select: { status: true } } },
    });
    if (!media) throw new NotFoundException("Service media not found");
    if (media.service.status !== "DRAFT" && media.service.status !== "REJECTED")
      throw new ConflictException(
        "Media can only be changed on draft or rejected services",
      );
    await this.prisma.serviceMedia.delete({ where: { id: mediaId } });
    await this.storage.delete("service-media", media.storagePath);
    this.realtime.publishAccountChanged(userId, "services");
    return { message: "Service media removed" };
  }

  async getOwnedMedia(userId: string, serviceId: string, mediaId: string) {
    const media = await this.prisma.serviceMedia.findFirst({
      where: {
        id: mediaId,
        serviceId,
        service: { providerId: userId, deletedAt: null },
      },
    });
    if (!media) throw new NotFoundException("Service media not found");
    return media;
  }

  private async transitionServiceStatus(
    userId: string,
    id: string,
    allowedStatuses: ServiceStatus[],
    nextStatus: ServiceStatus,
    message: string,
  ) {
    const service = await this.prisma.service.findFirst({
      where: { id, providerId: userId, deletedAt: null },
      select: { status: true },
    });
    if (!service) throw new NotFoundException("Service not found");
    if (!allowedStatuses.includes(service.status))
      throw new ConflictException(
        `A ${service.status.toLowerCase().replaceAll("_", " ")} listing cannot be moved to ${nextStatus.toLowerCase()}`,
      );

    const result = await this.prisma.service.updateMany({
      where: {
        id,
        providerId: userId,
        deletedAt: null,
        status: service.status,
      },
      data: { status: nextStatus },
    });
    if (result.count !== 1)
      throw new ConflictException(
        "The listing changed in another session. Refresh and try again.",
      );

    const updated = await this.prisma.service.findFirstOrThrow({
      where: { id, providerId: userId, deletedAt: null },
      include: {
        category: true,
        packages: { orderBy: { priceCentavos: "asc" } },
        media: { orderBy: [{ kind: "asc" }, { sortOrder: "asc" }] },
      },
    });
    this.realtime.publishMarketplaceChanged("service", id);
    this.realtime.publishAccountChanged(userId, "services");
    return { data: updated, message };
  }

  private async requireVerified(userId: string) {
    const profile = await this.prisma.studentProfile.findUnique({
      where: { userId },
      select: { verificationStatus: true },
    });
    if (profile?.verificationStatus !== "APPROVED")
      throw new BadRequestException(
        "Student verification approval is required",
      );
  }

  private validateServiceTerms(
    pricingModel: ServicePricingModel,
    input: CreateServiceDto,
  ) {
    if (pricingModel === ServicePricingModel.LEGACY_PACKAGES) {
      if (!input.packages?.length)
        throw new BadRequestException("Add at least one package");
      if (
        input.basePriceCentavos !== undefined ||
        input.normalDeliveryMinutes !== undefined ||
        input.includedRevisionLimit !== undefined ||
        input.acceptsRushOrders !== undefined ||
        input.fastestRushTier !== undefined
      )
        throw new BadRequestException(
          "Legacy package services cannot include single-price terms",
        );
      if (
        new Set(input.packages.map((item) => item.tier)).size !==
        input.packages.length
      )
        throw new BadRequestException(
          "Each package tier can only be used once",
        );
      return;
    }

    if (input.packages?.length)
      throw new BadRequestException(
        "Single-price services cannot include legacy packages",
      );
    if (
      input.basePriceCentavos === undefined ||
      input.normalDeliveryMinutes === undefined ||
      input.includedRevisionLimit === undefined
    )
      throw new BadRequestException(
        "Single-price services require price, delivery time, and included revisions",
      );
    validateProviderRushSettings({
      normalDeliveryMinutes: input.normalDeliveryMinutes,
      acceptsRushOrders: input.acceptsRushOrders ?? false,
      fastestRushTier: input.fastestRushTier ?? null,
    });
  }

  private validateStoredServiceTerms(service: {
    pricingModel: ServicePricingModel;
    basePriceCentavos: number | null;
    normalDeliveryMinutes: number | null;
    includedRevisionLimit: number | null;
    acceptsRushOrders?: boolean;
    fastestRushTier?: RushTier | null;
    packages: unknown[];
  }) {
    if (service.pricingModel === ServicePricingModel.LEGACY_PACKAGES) {
      if (!service.packages.length)
        throw new BadRequestException("Add at least one active package");
      return;
    }
    if (
      service.packages.length ||
      service.basePriceCentavos === null ||
      service.normalDeliveryMinutes === null ||
      service.includedRevisionLimit === null
    )
      throw new BadRequestException(
        "Complete the single-price terms before submitting this service",
      );
    validateProviderRushSettings({
      normalDeliveryMinutes: service.normalDeliveryMinutes,
      acceptsRushOrders: service.acceptsRushOrders ?? false,
      fastestRushTier: service.fastestRushTier ?? null,
    });
  }
}
