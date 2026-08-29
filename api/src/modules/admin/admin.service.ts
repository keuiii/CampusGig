import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard() {
    const [registeredStudents, activeServices, completedOrders, pendingVerifications] = await Promise.all([
      this.prisma.user.count({ where: { roles: { some: { role: "STUDENT" } } } }),
      this.prisma.service.count({ where: { status: "PUBLISHED", deletedAt: null } }),
      this.prisma.order.count({ where: { status: "COMPLETED" } }),
      this.prisma.verificationRequest.count({ where: { status: "PENDING" } }),
    ]);
    return { registeredStudents, activeServices, completedOrders, pendingVerifications };
  }

  async listPendingServices() {
    return { data: await this.prisma.service.findMany({
      where: { status: "PENDING_REVIEW", deletedAt: null },
      include: {
        category: true,
        packages: { where: { isActive: true }, orderBy: { priceCentavos: "asc" } },
        provider: { select: { displayName: true, email: true, studentProfile: { select: { school: { select: { name: true, shortName: true } } } } } },
      },
      orderBy: { updatedAt: "asc" },
    }) };
  }

  async reviewService(id: string, adminId: string, approved: boolean, reason?: string) {
    const service = await this.prisma.service.findFirst({ where: { id, deletedAt: null }, select: { status: true } });
    if (!service) throw new NotFoundException("Service not found");
    if (service.status !== "PENDING_REVIEW") throw new ConflictException("Only services awaiting review can be moderated");
    const now = new Date();
    return { data: await this.prisma.service.update({
      where: { id },
      data: approved
        ? { status: "PUBLISHED", publishedAt: now, reviewedAt: now, reviewedBy: adminId, rejectionReason: null }
        : { status: "REJECTED", publishedAt: null, reviewedAt: now, reviewedBy: adminId, rejectionReason: reason?.trim() },
      include: { category: true, packages: { where: { isActive: true }, orderBy: { priceCentavos: "asc" } } },
    }) };
  }

  async listSchoolAdmins() {
    return { data: await this.prisma.schoolAdminAssignment.findMany({ include: { user: { select: { id: true, displayName: true, email: true, status: true } }, school: { select: { id: true, name: true, shortName: true } } }, orderBy: { createdAt: "desc" } }) };
  }

  async assignSchoolAdmin(emailInput: string, schoolId: string) {
    const email = emailInput.trim().toLowerCase();
    const [user, school] = await Promise.all([
      this.prisma.user.findUnique({ where: { email }, select: { id: true, emailVerifiedAt: true, status: true } }),
      this.prisma.school.findUnique({ where: { id: schoolId }, select: { id: true, status: true } }),
    ]);
    if (!user) throw new NotFoundException("Create the user account before assigning school administrator access");
    if (!user.emailVerifiedAt || user.status !== "ACTIVE") throw new BadRequestException("The administrator account must be active and email verified");
    if (!school || school.status !== "ACTIVE") throw new BadRequestException("Select an active participating school");
    await this.prisma.$transaction([
      this.prisma.schoolAdminAssignment.upsert({ where: { userId: user.id }, create: { userId: user.id, schoolId }, update: { schoolId } }),
      this.prisma.userRoleAssignment.upsert({ where: { userId_role: { userId: user.id, role: "SCHOOL_ADMIN" } }, create: { userId: user.id, role: "SCHOOL_ADMIN" }, update: {} }),
    ]);
    return this.prisma.schoolAdminAssignment.findUnique({ where: { userId: user.id }, include: { user: { select: { id: true, displayName: true, email: true, status: true } }, school: { select: { id: true, name: true, shortName: true } } } });
  }

  async removeSchoolAdmin(userId: string) {
    const assignment = await this.prisma.schoolAdminAssignment.findUnique({ where: { userId } });
    if (!assignment) throw new NotFoundException("School administrator assignment not found");
    await this.prisma.$transaction([
      this.prisma.schoolAdminAssignment.delete({ where: { userId } }),
      this.prisma.userRoleAssignment.deleteMany({ where: { userId, role: "SCHOOL_ADMIN" } }),
    ]);
    return { message: "School administrator access removed" };
  }
}
