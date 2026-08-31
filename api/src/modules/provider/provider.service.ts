import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import type { CreateServiceDto } from "./dto/create-service.dto";
import type { UpdateProviderProfileDto } from "./dto/update-provider-profile.dto";
import { unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { serviceMediaStorageRoot } from "./service-media-upload.config";

@Injectable()
export class ProviderService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard(userId: string) {
    const [profile, activeOrders, pendingRequests, completedOrders, student] =
      await Promise.all([
        this.prisma.providerProfile.findUnique({ where: { userId } }),
        this.prisma.order.count({
          where: {
            providerId: userId,
            status: {
              in: [
                "ACCEPTED",
                "IN_PROGRESS",
                "SUBMITTED",
                "REVISION_REQUESTED",
              ],
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
            ratingAverage: true,
            reviewCount: true,
            verificationStatus: true,
          },
        }),
      ]);
    const profileStrength = !profile
      ? 35
      : profile.skills.length >= 3
        ? 90
        : 75;
    return {
      activeOrders,
      pendingRequests,
      completedOrders,
      averageRating: Number(student?.ratingAverage ?? 0),
      reviewCount: student?.reviewCount ?? 0,
      profileStrength,
      verified: student?.verificationStatus === "APPROVED",
    };
  }

  async getProfile(userId: string) {
    return {
      data: await this.prisma.providerProfile.findUnique({ where: { userId } }),
    };
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
    };
    if (!data.skills.length)
      throw new BadRequestException("Add at least one skill");
    return {
      data: await this.prisma.providerProfile.upsert({
        where: { userId },
        create: { userId, ...data },
        update: data,
      }),
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
    if (
      new Set(input.packages.map((item) => item.tier)).size !==
      input.packages.length
    )
      throw new BadRequestException("Each package tier can only be used once");
    const slugBase =
      input.title
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")
        .slice(0, 80) || "service";
    const slug = `${slugBase}-${Date.now().toString(36)}`;
    return {
      data: await this.prisma.service.create({
        data: {
          providerId: userId,
          categoryId: input.categoryId,
          title: input.title.trim(),
          slug,
          description: input.description.trim(),
          deliveryMethod: input.deliveryMethod,
          campusLocation: input.campusLocation?.trim() || null,
          packages: {
            create: input.packages.map((item) => ({
              ...item,
              name: item.name.trim(),
              description: item.description.trim(),
            })),
          },
        },
        include: { category: true, packages: true, media: true },
      }),
    };
  }

  async updateService(userId: string, id: string, input: CreateServiceDto) {
    await this.requireVerified(userId);
    const service = await this.prisma.service.findFirst({
      where: { id, providerId: userId, deletedAt: null },
      select: { status: true },
    });
    if (!service) throw new NotFoundException("Service not found");
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
    if (
      new Set(input.packages.map((item) => item.tier)).size !==
      input.packages.length
    )
      throw new BadRequestException("Each package tier can only be used once");
    return {
      data: await this.prisma.$transaction(async (database) => {
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
            packages: {
              create: input.packages.map((item) => ({
                ...item,
                name: item.name.trim(),
                description: item.description.trim(),
              })),
            },
          },
          include: {
            category: true,
            packages: { orderBy: { priceCentavos: "asc" } },
            media: { orderBy: [{ kind: "asc" }, { sortOrder: "asc" }] },
          },
        });
      }),
    };
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
    if (!service.packages.length)
      throw new BadRequestException("Add at least one active package");
    return {
      data: await this.prisma.service.update({
        where: { id },
        data: {
          status: "PENDING_REVIEW",
          reviewedAt: null,
          reviewedBy: null,
          rejectionReason: null,
        },
      }),
    };
  }

  async uploadServiceMedia(
    userId: string,
    id: string,
    files: { cover?: Express.Multer.File[]; portfolio?: Express.Multer.File[] },
  ) {
    const uploaded = [...(files.cover ?? []), ...(files.portfolio ?? [])];
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
      const result = await this.prisma.$transaction(async (database) => {
        if (files.cover?.[0] && oldCover)
          await database.serviceMedia.delete({ where: { id: oldCover.id } });
        if (files.cover?.[0]) {
          const cover = files.cover[0];
          await database.serviceMedia.create({
            data: {
              serviceId: id,
              kind: "COVER",
              storagePath: cover.filename,
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
              storagePath: file.filename,
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
        await unlink(
          resolve(serviceMediaStorageRoot, oldCover.storagePath),
        ).catch(() => undefined);
      return { data: result };
    } catch (error) {
      await Promise.all(
        uploaded.map((file) => unlink(file.path).catch(() => undefined)),
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
    await unlink(resolve(serviceMediaStorageRoot, media.storagePath)).catch(
      () => undefined,
    );
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
}
