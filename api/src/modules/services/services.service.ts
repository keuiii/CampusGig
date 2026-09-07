import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class ServicesService {
  constructor(private readonly prisma: PrismaService) {}
  async findAll(query?: string, categoryId?: string, schoolId?: string) {
    const services = await this.prisma.service.findMany({
      where: {
        status: "PUBLISHED",
        ...(categoryId ? { categoryId } : {}),
        provider: {
          studentProfile: {
            ...(schoolId ? { schoolId } : {}),
            school: { status: "ACTIVE" },
          },
        },
        ...(query
          ? {
              OR: [
                { title: { contains: query, mode: "insensitive" } },
                { description: { contains: query, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: {
        category: true,
        provider: {
          include: { studentProfile: { include: { school: true } } },
        },
        packages: {
          where: { isActive: true },
          orderBy: { priceCentavos: "asc" },
        },
        media: { orderBy: [{ kind: "asc" }, { sortOrder: "asc" }] },
      },
      orderBy: { publishedAt: "desc" },
      take: 50,
    });
    return { data: services.map((service) => this.toResponse(service)) };
  }
  async findOne(id: string) {
    const service = await this.prisma.service.findFirst({
      where: { id, status: "PUBLISHED" },
      include: {
        category: true,
        provider: {
          include: { studentProfile: { include: { school: true } } },
        },
        packages: {
          where: { isActive: true },
          orderBy: { priceCentavos: "asc" },
        },
        media: { orderBy: [{ kind: "asc" }, { sortOrder: "asc" }] },
      },
    });
    if (!service) throw new NotFoundException("Service not found");
    return this.toResponse(service);
  }
  async getPublicMedia(serviceId: string, mediaId: string) {
    const media = await this.prisma.serviceMedia.findFirst({
      where: {
        id: mediaId,
        serviceId,
        service: { status: "PUBLISHED", deletedAt: null },
      },
    });
    if (!media) throw new NotFoundException("Service media not found");
    return media;
  }
  private toResponse(service: any) {
    const profile = service.provider.studentProfile;
    return {
      id: service.id,
      title: service.title,
      description: service.description,
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
      price: (service.packages[0]?.priceCentavos ?? 0) / 100,
      rating: Number(profile?.ratingAverage ?? 0),
      reviews: profile?.reviewCount ?? 0,
      delivery: service.packages[0]
        ? `${service.packages[0].deliveryDays} days`
        : "",
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
}
