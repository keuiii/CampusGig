import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { MessagesGateway } from "../messages/messages.gateway";
import {
  decodeDateCursor,
  encodeDateCursor,
} from "../../common/cursor-pagination";

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: MessagesGateway,
  ) {}

  async dashboard() {
    const [
      registeredStudents,
      activeServices,
      completedOrders,
      pendingVerifications,
    ] = await Promise.all([
      this.prisma.user.count({
        where: { roles: { some: { role: "STUDENT" } } },
      }),
      this.prisma.service.count({
        where: { status: "PUBLISHED", deletedAt: null },
      }),
      this.prisma.order.count({ where: { status: "COMPLETED" } }),
      this.prisma.verificationRequest.count({ where: { status: "PENDING" } }),
    ]);
    return {
      registeredStudents,
      activeServices,
      completedOrders,
      pendingVerifications,
    };
  }

  async listPendingServices(cursor?: string, limit = 20) {
    const decoded = cursor ? decodeDateCursor(cursor, "service queue") : null;
    const services = await this.prisma.service.findMany({
      where: {
        status: "PENDING_REVIEW",
        deletedAt: null,
        ...(decoded
          ? {
              OR: [
                { updatedAt: { gt: decoded.date } },
                { updatedAt: decoded.date, id: { gt: decoded.id } },
              ],
            }
          : {}),
      },
      include: {
        category: true,
        packages: {
          where: { isActive: true },
          orderBy: { priceCentavos: "asc" },
        },
        provider: {
          select: {
            displayName: true,
            email: true,
            studentProfile: {
              select: { school: { select: { name: true, shortName: true } } },
            },
          },
        },
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: limit + 1,
    });
    const hasMore = services.length > limit;
    const data = hasMore ? services.slice(0, limit) : services;
    const last = data.at(-1);
    return {
      data,
      pagination: {
        hasMore,
        nextCursor:
          hasMore && last
            ? encodeDateCursor({ date: last.updatedAt, id: last.id })
            : null,
      },
    };
  }

  async reviewService(
    id: string,
    adminId: string,
    approved: boolean,
    reason?: string,
  ) {
    const service = await this.prisma.service.findFirst({
      where: { id, deletedAt: null },
      select: {
        status: true,
        pricingModel: true,
        basePriceCentavos: true,
        normalDeliveryMinutes: true,
        includedRevisionLimit: true,
        acceptsRushOrders: true,
        fastestRushTier: true,
        packages: { where: { isActive: true }, select: { id: true } },
      },
    });
    if (!service) throw new NotFoundException("Service not found");
    if (service.status !== "PENDING_REVIEW")
      throw new ConflictException(
        "Only services awaiting review can be moderated",
      );
    if (approved) {
      if (
        service.pricingModel === "LEGACY_PACKAGES" &&
        service.packages.length === 0
      )
        throw new BadRequestException(
          "A legacy service must have an active package before approval",
        );
      if (
        service.pricingModel === "SINGLE_PRICE_V2" &&
        (service.packages.length > 0 ||
          service.basePriceCentavos === null ||
          service.normalDeliveryMinutes === null ||
          service.includedRevisionLimit === null)
      )
        throw new BadRequestException(
          "The single-price service terms are incomplete or contradictory",
        );
    }
    const now = new Date();
    const updated = await this.prisma.service.update({
      where: { id },
      data: approved
        ? {
            status: "PUBLISHED",
            publishedAt: now,
            reviewedAt: now,
            reviewedBy: adminId,
            rejectionReason: null,
          }
        : {
            status: "REJECTED",
            publishedAt: null,
            reviewedAt: now,
            reviewedBy: adminId,
            rejectionReason: reason?.trim(),
          },
      include: {
        category: true,
        packages: {
          where: { isActive: true },
          orderBy: { priceCentavos: "asc" },
        },
      },
    });
    this.realtime.publishAccountChanged(updated.providerId, "services");
    if (approved)
      this.realtime.publishMarketplaceChanged("service", updated.id);
    return { data: updated };
  }

  async listSchoolAdmins(cursor?: string, limit = 20) {
    const decoded = cursor ? decodeDateCursor(cursor, "school admin") : null;
    const assignments = await this.prisma.schoolAdminAssignment.findMany({
      where: decoded
        ? {
            OR: [
              { createdAt: { lt: decoded.date } },
              { createdAt: decoded.date, userId: { lt: decoded.id } },
            ],
          }
        : undefined,
      include: {
        user: {
          select: { id: true, displayName: true, email: true, status: true },
        },
        school: { select: { id: true, name: true, shortName: true } },
      },
      orderBy: [{ createdAt: "desc" }, { userId: "desc" }],
      take: limit + 1,
    });
    const hasMore = assignments.length > limit;
    const data = hasMore ? assignments.slice(0, limit) : assignments;
    const last = data.at(-1);
    return {
      data,
      pagination: {
        hasMore,
        nextCursor:
          hasMore && last
            ? encodeDateCursor({ date: last.createdAt, id: last.userId })
            : null,
      },
    };
  }

  async assignSchoolAdmin(emailInput: string, schoolId: string) {
    const email = emailInput.trim().toLowerCase();
    const [user, school] = await Promise.all([
      this.prisma.user.findUnique({
        where: { email },
        select: { id: true, emailVerifiedAt: true, status: true },
      }),
      this.prisma.school.findUnique({
        where: { id: schoolId },
        select: { id: true, status: true },
      }),
    ]);
    if (!user)
      throw new NotFoundException(
        "Create the user account before assigning school administrator access",
      );
    if (!user.emailVerifiedAt || user.status !== "ACTIVE")
      throw new BadRequestException(
        "The administrator account must be active and email verified",
      );
    if (!school || school.status !== "ACTIVE")
      throw new BadRequestException("Select an active participating school");
    await this.prisma.$transaction([
      this.prisma.schoolAdminAssignment.upsert({
        where: { userId: user.id },
        create: { userId: user.id, schoolId },
        update: { schoolId },
      }),
      this.prisma.userRoleAssignment.upsert({
        where: { userId_role: { userId: user.id, role: "SCHOOL_ADMIN" } },
        create: { userId: user.id, role: "SCHOOL_ADMIN" },
        update: {},
      }),
    ]);
    return this.prisma.schoolAdminAssignment.findUnique({
      where: { userId: user.id },
      include: {
        user: {
          select: { id: true, displayName: true, email: true, status: true },
        },
        school: { select: { id: true, name: true, shortName: true } },
      },
    });
  }

  async removeSchoolAdmin(userId: string) {
    const assignment = await this.prisma.schoolAdminAssignment.findUnique({
      where: { userId },
    });
    if (!assignment)
      throw new NotFoundException("School administrator assignment not found");
    await this.prisma.$transaction([
      this.prisma.schoolAdminAssignment.delete({ where: { userId } }),
      this.prisma.userRoleAssignment.deleteMany({
        where: { userId, role: "SCHOOL_ADMIN" },
      }),
    ]);
    return { message: "School administrator access removed" };
  }
}
