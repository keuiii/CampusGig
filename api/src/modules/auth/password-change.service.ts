import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { compare, hash } from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";
import type { ChangePasswordDto } from "./dto/change-password.dto";
import { EmailService } from "./email.service";
import { MfaService } from "./mfa.service";

@Injectable()
export class PasswordChangeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
    private readonly mfa: MfaService,
  ) {}

  async request(userId: string, input: ChangePasswordDto, origin: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, passwordHash: true, mfaEnabledAt: true },
    });
    if (!user || !(await compare(input.currentPassword, user.passwordHash)))
      throw new UnauthorizedException("Current password is incorrect");
    if (await compare(input.newPassword, user.passwordHash))
      throw new BadRequestException(
        "Choose a new password different from your current password",
      );
    if (user.mfaEnabledAt && !input.mfaCode)
      throw new UnauthorizedException(
        "Enter your authenticator code or a recovery code",
      );
    const newPasswordHash = await hash(input.newPassword, 12);

    if (user.mfaEnabledAt && input.mfaCode) {
      await this.mfa.verifyCurrentFactor(
        userId,
        input.mfaCode,
        input.recoveryCode,
      );
      const revokedTrustedDevices = await this.prisma.$transaction(
        async (database) => {
          await database.user.update({
            where: { id: userId },
            data: { passwordHash: newPasswordHash },
          });
          await database.passwordChangeRequest.updateMany({
            where: { userId, status: "PENDING" },
            data: { status: "CANCELLED", respondedAt: new Date() },
          });
          const revoked = await database.trustedDevice.updateMany({
            where: { userId, revokedAt: null },
            data: { revokedAt: new Date() },
          });
          return revoked.count;
        },
      );
      void this.email.sendPasswordChanged(user.email).catch(() => undefined);
      return {
        status: "CONFIRMED" as const,
        confirmationMethod: input.recoveryCode
          ? ("RECOVERY_CODE" as const)
          : ("AUTHENTICATOR" as const),
        revokedTrustedDevices,
        message:
          "Password changed successfully. Remembered devices must verify again.",
      };
    }

    await this.expireOldRequests(userId);
    const existing = await this.prisma.passwordChangeRequest.findFirst({
      where: { userId, status: "PENDING", expiresAt: { gt: new Date() } },
    });
    if (existing)
      throw new ConflictException(
        "A password change is already waiting for email confirmation",
      );

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const request = await this.prisma.passwordChangeRequest.create({
      data: {
        userId,
        newPasswordHash,
        tokenHash: this.sha256(token),
        expiresAt,
      },
    });
    const actionBase = (
      this.config.get<string>("EMAIL_ACTION_BASE_URL") || origin
    ).replace(/\/$/, "");
    const reviewUrl = `${actionBase}/api/v1/auth/password-change/review?token=${encodeURIComponent(token)}`;
    const delivered = await this.email
      .sendPasswordChangeReview(user.email, reviewUrl, expiresAt)
      .then((result) => result.delivered)
      .catch(() => false);
    if (!delivered) {
      await this.prisma.passwordChangeRequest.delete({
        where: { id: request.id },
      });
      throw new ServiceUnavailableException(
        "The confirmation email could not be sent. Your password was not changed.",
      );
    }
    return {
      id: request.id,
      status: request.status,
      expiresAt,
      message: "Check your email to approve or reject this password change.",
    };
  }

  async pending(userId: string) {
    await this.expireOldRequests(userId);
    const request = await this.prisma.passwordChangeRequest.findFirst({
      where: { userId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
    });
    return request ? this.toStatus(request) : null;
  }

  async status(userId: string, id: string) {
    await this.expireOldRequests(userId);
    const request = await this.prisma.passwordChangeRequest.findFirst({
      where: { id, userId },
    });
    if (!request) throw new BadRequestException("Password request not found");
    return this.toStatus(request);
  }

  async cancel(userId: string, id: string) {
    const result = await this.prisma.passwordChangeRequest.updateMany({
      where: { id, userId, status: "PENDING" },
      data: { status: "CANCELLED", respondedAt: new Date() },
    });
    if (!result.count)
      throw new BadRequestException(
        "This password request is no longer active",
      );
    return { id, status: "CANCELLED" };
  }

  async reviewPage(token: string, origin: string) {
    const request = await this.findActiveToken(token);
    if (!request)
      return this.resultPage(
        "This request is no longer valid",
        "It may have expired, been cancelled, or already been answered.",
      );
    const action = `${origin}/api/v1/auth/password-change/decision`;
    return `<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>CampusGig password change</title></head><body style="margin:0;background:#f4f7f5;font-family:Arial,sans-serif;color:#17211d"><main style="max-width:520px;margin:60px auto;padding:28px;border:1px solid #dce5e0;border-radius:18px;background:#fff"><h1 style="margin-top:0">Review password change</h1><p>Approve only if you requested this change from the CampusGig mobile app.</p><p style="color:#65736c">This request expires in 15 minutes. The mobile app will update automatically after your decision.</p><form method="post" action="${action}" style="display:flex;gap:12px;flex-wrap:wrap"><input type="hidden" name="token" value="${token}"><button name="decision" value="CONFIRMED" style="border:0;border-radius:10px;padding:13px 20px;background:#13795b;color:#fff;font-weight:700">Confirm password change</button><button name="decision" value="REJECTED" style="border:1px solid #b54747;border-radius:10px;padding:13px 20px;background:#fff;color:#b54747;font-weight:700">Reject request</button></form></main></body></html>`;
  }

  async decide(token: string, decision: "CONFIRMED" | "REJECTED") {
    const request = await this.findActiveToken(token);
    if (!request)
      return this.resultPage(
        "This request is no longer valid",
        "It may have expired, been cancelled, or already been answered.",
      );
    if (decision === "CONFIRMED") {
      await this.prisma.$transaction(async (database) => {
        const updated = await database.passwordChangeRequest.updateMany({
          where: {
            id: request.id,
            status: "PENDING",
            expiresAt: { gt: new Date() },
          },
          data: { status: "CONFIRMED", respondedAt: new Date() },
        });
        if (!updated.count)
          throw new ConflictException("Request already handled");
        await database.user.update({
          where: { id: request.userId },
          data: { passwordHash: request.newPasswordHash },
        });
      });
      const user = await this.prisma.user.findUnique({
        where: { id: request.userId },
        select: { email: true },
      });
      if (user)
        void this.email.sendPasswordChanged(user.email).catch(() => undefined);
      return this.resultPage(
        "Password changed successfully",
        "You can return to the CampusGig app. It will continue automatically.",
      );
    }
    await this.prisma.passwordChangeRequest.update({
      where: { id: request.id },
      data: { status: "REJECTED", respondedAt: new Date() },
    });
    return this.resultPage(
      "Password change rejected",
      "Your existing password is unchanged. You can return to the CampusGig app.",
    );
  }

  private async findActiveToken(token: string) {
    if (!token || token.length < 32) return null;
    return this.prisma.passwordChangeRequest.findFirst({
      where: {
        tokenHash: this.sha256(token),
        status: "PENDING",
        expiresAt: { gt: new Date() },
      },
    });
  }

  private async expireOldRequests(userId: string) {
    await this.prisma.passwordChangeRequest.updateMany({
      where: { userId, status: "PENDING", expiresAt: { lte: new Date() } },
      data: { status: "EXPIRED", respondedAt: new Date() },
    });
  }

  private toStatus(request: {
    id: string;
    status: string;
    expiresAt: Date;
    createdAt: Date;
  }) {
    return {
      id: request.id,
      status: request.status,
      expiresAt: request.expiresAt,
      createdAt: request.createdAt,
    };
  }

  private sha256(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }

  private resultPage(title: string, body: string) {
    return `<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>${title}</title></head><body style="margin:0;background:#0f1713;font-family:Arial,sans-serif;color:#f2f6f3"><main style="max-width:520px;margin:70px auto;padding:30px;border:1px solid #34423a;border-radius:18px;background:#1c2520"><div style="color:#70d0aa;font-weight:800">CAMPUSGIG SECURITY</div><h1>${title}</h1><p style="color:#b7c2bc;line-height:1.6">${body}</p></main></body></html>`;
  }
}
