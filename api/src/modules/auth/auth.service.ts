import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { UserRole } from "@prisma/client";
import { compare, hash } from "bcryptjs";
import { randomInt } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import type { AccessTokenPayload, AuthenticatedUser } from "./auth.types";
import { EmailService } from "./email.service";
import type { EmailCodeDto } from "./dto/email-code.dto";
import type { EmailOnlyDto } from "./dto/email-only.dto";
import type { ResetPasswordDto } from "./dto/reset-password.dto";
import type { ChangePasswordDto } from "./dto/change-password.dto";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly emailService: EmailService,
  ) {}

  async register(input: RegisterDto) {
    const email = input.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw new ConflictException("An account with this email already exists");

    const user = await this.prisma.user.create({
      data: {
        email,
        displayName: input.displayName.trim(),
        passwordHash: await hash(input.password, 12),
        roles: { create: input.isStudent ? [{ role: UserRole.CLIENT }, { role: UserRole.STUDENT }] : [{ role: UserRole.CLIENT }] },
      },
      include: { roles: true },
    });

    const code = await this.issueCode(user.id, user.email, "VERIFY_EMAIL");
    return { requiresVerification: true, email: user.email, ...(this.isDevelopment() ? { developmentCode: code } : {}) };
  }

  async login(input: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email.trim().toLowerCase() },
      include: { roles: true },
    });
    if (!user || !(await compare(input.password, user.passwordHash))) {
      throw new UnauthorizedException("Invalid email or password");
    }
    if (!user.emailVerifiedAt) throw new UnauthorizedException("Verify your email before signing in");
    if (user.status === "SUSPENDED" || user.status === "DEACTIVATED") {
      throw new UnauthorizedException("This account is not active");
    }
    return this.createSession(this.toAuthenticatedUser(user));
  }

  async verifyEmail(input: EmailCodeDto) {
    const user = await this.prisma.user.findUnique({ where: { email: this.normalizeEmail(input.email) }, include: { roles: true } });
    if (!user) throw new BadRequestException("Invalid or expired verification code");
    if (user.emailVerifiedAt) return this.createSession(this.toAuthenticatedUser(user));
    const code = await this.validateCode(user.id, "VERIFY_EMAIL", input.code);
    const verified = await this.prisma.$transaction(async (database) => {
      await database.accountCode.update({ where: { id: code.id }, data: { consumedAt: new Date() } });
      return database.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date(), status: "ACTIVE" }, include: { roles: true } });
    });
    return this.createSession(this.toAuthenticatedUser(verified));
  }

  async resendVerification(input: EmailOnlyDto) {
    const user = await this.prisma.user.findUnique({ where: { email: this.normalizeEmail(input.email) } });
    if (!user || user.emailVerifiedAt) return { message: "If the account needs verification, a new code has been sent." };
    const code = await this.issueCode(user.id, user.email, "VERIFY_EMAIL");
    return { message: "A new verification code has been sent.", ...(this.isDevelopment() ? { developmentCode: code } : {}) };
  }

  async forgotPassword(input: EmailOnlyDto) {
    const user = await this.prisma.user.findUnique({ where: { email: this.normalizeEmail(input.email) } });
    if (!user || !user.emailVerifiedAt) return { message: "If an eligible account exists, a password-reset code has been sent." };
    const code = await this.issueCode(user.id, user.email, "RESET_PASSWORD");
    return { message: "If an eligible account exists, a password-reset code has been sent.", ...(this.isDevelopment() ? { developmentCode: code } : {}) };
  }

  async resetPassword(input: ResetPasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { email: this.normalizeEmail(input.email) } });
    if (!user) throw new BadRequestException("Invalid or expired reset code");
    const code = await this.validateCode(user.id, "RESET_PASSWORD", input.code);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hash(input.password, 12) } }),
      this.prisma.accountCode.update({ where: { id: code.id }, data: { consumedAt: new Date() } }),
    ]);
    return { message: "Password updated. You can now sign in." };
  }

  async changePassword(userId: string, input: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    if (!user || !(await compare(input.currentPassword, user.passwordHash))) throw new UnauthorizedException("Current password is incorrect");
    if (await compare(input.newPassword, user.passwordHash)) throw new BadRequestException("Choose a new password different from your current password");
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await hash(input.newPassword, 12) } });
    return { message: "Password updated successfully" };
  }

  async findAuthenticatedUser(userId: string): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { roles: true } });
    if (!user) throw new UnauthorizedException("Account no longer exists");
    return this.toAuthenticatedUser(user);
  }

  private async createSession(user: AuthenticatedUser) {
    const payload: AccessTokenPayload = { sub: user.id, email: user.email, roles: user.roles };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>("JWT_SECRET"),
      expiresIn: "7d",
    });
    return { accessToken, tokenType: "Bearer", expiresIn: 604800, user };
  }

  private normalizeEmail(email: string) { return email.trim().toLowerCase(); }
  private isDevelopment() { return this.config.get<string>("NODE_ENV") !== "production"; }

  private async issueCode(userId: string, email: string, purpose: "VERIFY_EMAIL" | "RESET_PASSWORD") {
    const latest = await this.prisma.accountCode.findFirst({ where: { userId, purpose }, orderBy: { createdAt: "desc" } });
    if (latest && Date.now() - latest.createdAt.getTime() < 60000) throw new HttpException("Please wait one minute before requesting another code", HttpStatus.TOO_MANY_REQUESTS);
    const code = randomInt(100000, 1000000).toString();
    await this.prisma.accountCode.create({ data: { userId, purpose, codeHash: await hash(code, 10), expiresAt: new Date(Date.now() + 10 * 60 * 1000) } });
    await this.emailService.sendCode(email, code, purpose);
    return code;
  }

  private async validateCode(userId: string, purpose: "VERIFY_EMAIL" | "RESET_PASSWORD", plainCode: string) {
    const code = await this.prisma.accountCode.findFirst({ where: { userId, purpose, consumedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
    if (!code || code.attempts >= 5) throw new BadRequestException("Invalid or expired code");
    if (!(await compare(plainCode, code.codeHash))) {
      await this.prisma.accountCode.update({ where: { id: code.id }, data: { attempts: { increment: 1 } } });
      throw new BadRequestException("Invalid or expired code");
    }
    return code;
  }

  private toAuthenticatedUser(user: { id: string; email: string; displayName: string; avatarPath: string | null; status: any; roles: { role: UserRole }[] }): AuthenticatedUser {
    return { id: user.id, email: user.email, displayName: user.displayName, hasAvatar: Boolean(user.avatarPath), status: user.status, roles: user.roles.map(({ role }) => role) };
  }
}
