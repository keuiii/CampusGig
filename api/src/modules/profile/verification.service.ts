import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { unlink } from "node:fs/promises";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class VerificationService {
  constructor(private readonly prisma: PrismaService) {}

  async submit(userId: string, file?: Express.Multer.File) {
    if (!file)
      throw new BadRequestException("Select a student ID image or PDF");
    try {
      const profile = await this.prisma.studentProfile.findUnique({
        where: { userId },
      });
      if (!profile)
        throw new BadRequestException(
          "Complete your student profile before requesting verification",
        );
      if (profile.verificationStatus === "PENDING")
        throw new ConflictException(
          "Your verification is already awaiting review",
        );
      if (profile.verificationStatus === "APPROVED")
        throw new ConflictException("Your account is already verified");
      const request = await this.prisma.$transaction(async (database) => {
        const created = await database.verificationRequest.create({
          data: {
            userId,
            schoolId: profile.schoolId,
            studentIdFilePath: file.filename,
          },
        });
        await database.studentProfile.update({
          where: { userId },
          data: { verificationStatus: "PENDING", verifiedAt: null },
        });
        return created;
      });
      return {
        data: {
          id: request.id,
          status: request.status,
          submittedAt: request.submittedAt,
        },
      };
    } catch (error) {
      await unlink(file.path).catch(() => undefined);
      throw error;
    }
  }

  async latest(userId: string) {
    const request = await this.prisma.verificationRequest.findFirst({
      where: { userId },
      orderBy: { submittedAt: "desc" },
      select: {
        id: true,
        status: true,
        submittedAt: true,
        reviewedAt: true,
        rejectionReason: true,
      },
    });
    return { data: request };
  }

  async listPending(reviewerId?: string, platformAdmin = true) {
    const schoolId = platformAdmin
      ? undefined
      : await this.requireAssignedSchool(reviewerId!);
    const requests = await this.prisma.verificationRequest.findMany({
      where: { status: "PENDING", ...(schoolId ? { schoolId } : {}) },
      include: { school: true },
      orderBy: { submittedAt: "asc" },
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: requests.map((item) => item.userId) } },
      include: { studentProfile: true },
    });
    const usersById = new Map(users.map((user) => [user.id, user]));
    return {
      data: requests.map((request) => {
        const user = usersById.get(request.userId);
        return {
          id: request.id,
          userId: request.userId,
          name: user?.displayName ?? "Student",
          email: user?.email,
          program: user?.studentProfile?.program,
          yearLevel: user?.studentProfile?.yearLevel,
          school: request.school.name,
          schoolShortName: request.school.shortName,
          submittedAt: request.submittedAt,
          documentName: "Student ID",
        };
      }),
    };
  }

  async review(
    id: string,
    reviewerId: string,
    approved: boolean,
    rejectionReason?: string,
    platformAdmin = true,
  ) {
    const request = await this.prisma.verificationRequest.findUnique({
      where: { id },
    });
    if (!request) throw new NotFoundException("Verification request not found");
    if (request.status !== "PENDING")
      throw new ConflictException("This request has already been reviewed");
    if (
      !platformAdmin &&
      request.schoolId !== (await this.requireAssignedSchool(reviewerId))
    )
      throw new ForbiddenException(
        "You can only review students from your assigned school",
      );
    if (!approved && !rejectionReason?.trim())
      throw new BadRequestException("A rejection reason is required");
    const status = approved ? "APPROVED" : "REJECTED";
    await this.prisma.$transaction(async (database) => {
      await database.verificationRequest.update({
        where: { id },
        data: {
          status,
          reviewedAt: new Date(),
          reviewedBy: reviewerId,
          rejectionReason: approved ? null : rejectionReason!.trim(),
        },
      });
      await database.studentProfile.update({
        where: { userId: request.userId },
        data: {
          verificationStatus: status,
          verifiedAt: approved ? new Date() : null,
        },
      });
      if (approved)
        await database.userRoleAssignment.upsert({
          where: { userId_role: { userId: request.userId, role: "PROVIDER" } },
          create: { userId: request.userId, role: "PROVIDER" },
          update: {},
        });
    });
    return { data: { id, status } };
  }

  async getDocument(id: string, reviewerId?: string, platformAdmin = true) {
    const request = await this.prisma.verificationRequest.findUnique({
      where: { id },
      select: { studentIdFilePath: true, schoolId: true },
    });
    if (!request) throw new NotFoundException("Verification request not found");
    if (
      !platformAdmin &&
      request.schoolId !== (await this.requireAssignedSchool(reviewerId!))
    )
      throw new ForbiddenException(
        "You can only view documents from your assigned school",
      );
    return request.studentIdFilePath;
  }

  private async requireAssignedSchool(userId: string) {
    const assignment = await this.prisma.schoolAdminAssignment.findUnique({
      where: { userId },
      select: { schoolId: true },
    });
    if (!assignment)
      throw new ForbiddenException(
        "No school is assigned to this administrator account",
      );
    return assignment.schoolId;
  }
}
