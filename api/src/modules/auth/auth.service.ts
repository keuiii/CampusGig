import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { UserRole } from "@prisma/client";
import { compare, hash } from "bcryptjs";
import { randomInt } from "node:crypto";
import { randomBytes } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { PrismaService } from "../../prisma/prisma.service";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import type { AccessTokenPayload, AuthenticatedUser } from "./auth.types";
import { EmailService } from "./email.service";
import type { EmailCodeDto } from "./dto/email-code.dto";
import type { EmailOnlyDto } from "./dto/email-only.dto";
import type { ResetPasswordDto } from "./dto/reset-password.dto";
import type { ChangePasswordDto } from "./dto/change-password.dto";
import type { SocialLoginDto } from "./dto/social-login.dto";
import { MfaService } from "./mfa.service";
import { PasswordChangeService } from "./password-change.service";

@Injectable()
export class AuthService {
  private readonly googleClient = new OAuth2Client();
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly emailService: EmailService,
    private readonly mfa: MfaService,
    private readonly passwordChanges: PasswordChangeService,
  ) {}

  async register(input: RegisterDto) {
    const email = input.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing)
      throw new ConflictException("An account with this email already exists");

    const user = await this.prisma.user.create({
      data: {
        email,
        displayName: input.displayName.trim(),
        passwordHash: await hash(input.password, 12),
        roles: {
          create: input.isStudent
            ? [{ role: UserRole.CLIENT }, { role: UserRole.STUDENT }]
            : [{ role: UserRole.CLIENT }],
        },
      },
      include: { roles: true },
    });

    const code = await this.issueCode(user.id, user.email, "VERIFY_EMAIL");
    return {
      requiresVerification: true,
      email: user.email,
      ...(this.shouldExposeDevelopmentCode() ? { developmentCode: code } : {}),
    };
  }

  async login(input: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email.trim().toLowerCase() },
      include: { roles: true },
    });
    if (!user || !(await compare(input.password, user.passwordHash))) {
      throw new UnauthorizedException("Invalid email or password");
    }
    if (!user.emailVerifiedAt)
      throw new UnauthorizedException("Verify your email before signing in");
    if (user.status === "SUSPENDED" || user.status === "DEACTIVATED") {
      throw new UnauthorizedException("This account is not active");
    }
    return this.createLoginResult(user, input.trustedDeviceToken);
  }

  async socialLogin(input: SocialLoginDto) {
    const audiences = [
      this.config.get<string>("GOOGLE_WEB_CLIENT_ID"),
      this.config.get<string>("GOOGLE_ANDROID_CLIENT_ID"),
      this.config.get<string>("GOOGLE_IOS_CLIENT_ID"),
    ].filter((value): value is string => Boolean(value));
    if (!audiences.length)
      throw new HttpException(
        "Google sign-in is not configured yet",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    const ticket = await this.googleClient
      .verifyIdToken({ idToken: input.idToken, audience: audiences })
      .catch(() => null);
    const identity = ticket?.getPayload();
    if (!identity?.sub || !identity.email || !identity.email_verified)
      throw new UnauthorizedException("Google could not verify this account");
    const email = this.normalizeEmail(identity.email);
    const linked = await this.prisma.socialAccount.findUnique({
      where: {
        provider_providerUserId: {
          provider: "GOOGLE",
          providerUserId: identity.sub,
        },
      },
      include: { user: { include: { roles: true } } },
    });
    if (linked) {
      if (
        linked.user.status === "SUSPENDED" ||
        linked.user.status === "DEACTIVATED"
      )
        throw new UnauthorizedException("This account is not active");
      return this.createLoginResult(linked.user, input.trustedDeviceToken);
    }
    const user = await this.prisma.$transaction(async (database) => {
      const existing = await database.user.findUnique({
        where: { email },
        include: { roles: true },
      });
      if (existing && !email.endsWith("@gmail.com") && !identity.hd)
        throw new ConflictException(
          "For this email address, sign in with your password first. Automatic Google linking is only available for Gmail and Google Workspace accounts.",
        );
      const account =
        existing ??
        (await database.user.create({
          data: {
            email,
            displayName: identity.name?.trim() || email.split("@")[0],
            passwordHash: await hash(randomBytes(32).toString("hex"), 12),
            status: "ACTIVE",
            emailVerifiedAt: new Date(),
            roles: { create: [{ role: UserRole.CLIENT }] },
          },
          include: { roles: true },
        }));
      if (account.status === "SUSPENDED" || account.status === "DEACTIVATED")
        throw new UnauthorizedException("This account is not active");
      if (!account.emailVerifiedAt || account.status === "PENDING")
        await database.user.update({
          where: { id: account.id },
          data: {
            emailVerifiedAt: account.emailVerifiedAt ?? new Date(),
            status: "ACTIVE",
          },
        });
      await database.socialAccount.create({
        data: {
          userId: account.id,
          provider: "GOOGLE",
          providerUserId: identity.sub,
          providerEmail: email,
        },
      });
      return database.user.findUniqueOrThrow({
        where: { id: account.id },
        include: { roles: true },
      });
    });
    return this.createLoginResult(user, input.trustedDeviceToken);
  }

  async verifyEmail(input: EmailCodeDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: this.normalizeEmail(input.email) },
      include: { roles: true },
    });
    if (!user)
      throw new BadRequestException("Invalid or expired verification code");
    if (user.emailVerifiedAt)
      return this.createSession(this.toAuthenticatedUser(user));
    const code = await this.validateCode(user.id, "VERIFY_EMAIL", input.code);
    const verified = await this.prisma.$transaction(async (database) => {
      await database.accountCode.update({
        where: { id: code.id },
        data: { consumedAt: new Date() },
      });
      return database.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: new Date(), status: "ACTIVE" },
        include: { roles: true },
      });
    });
    return this.createSession(this.toAuthenticatedUser(verified));
  }

  async resendVerification(input: EmailOnlyDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: this.normalizeEmail(input.email) },
    });
    if (!user || user.emailVerifiedAt)
      return {
        message: "If the account needs verification, a new code has been sent.",
      };
    const code = await this.issueCode(user.id, user.email, "VERIFY_EMAIL");
    return {
      message: "A new verification code has been sent.",
      ...(this.shouldExposeDevelopmentCode() ? { developmentCode: code } : {}),
    };
  }

  async forgotPassword(input: EmailOnlyDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: this.normalizeEmail(input.email) },
    });
    if (!user || !user.emailVerifiedAt)
      return {
        message:
          "If an eligible account exists, a password-reset code has been sent.",
      };
    const code = await this.issueCode(user.id, user.email, "RESET_PASSWORD");
    return {
      message:
        "If an eligible account exists, a password-reset code has been sent.",
      ...(this.shouldExposeDevelopmentCode() ? { developmentCode: code } : {}),
    };
  }

  async resetPassword(input: ResetPasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: this.normalizeEmail(input.email) },
    });
    if (!user) throw new BadRequestException("Invalid or expired reset code");
    const code = await this.validateCode(user.id, "RESET_PASSWORD", input.code);
    if (user.mfaEnabledAt) {
      if (!input.mfaCode)
        throw new BadRequestException(
          "Enter your authenticator or recovery code to reset this protected account",
        );
      await this.mfa.verifyCurrentFactor(
        user.id,
        input.mfaCode,
        input.recoveryCode,
      );
    }
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hash(input.password, 12) },
      }),
      this.prisma.accountCode.update({
        where: { id: code.id },
        data: { consumedAt: new Date() },
      }),
    ]);
    const emailResult = await this.emailService
      .sendPasswordChanged(user.email)
      .catch(() => ({ delivered: false }));
    return {
      message: emailResult.delivered
        ? "Password updated. A confirmation email was sent. You can now sign in."
        : "Password updated. You can now sign in.",
      confirmationEmailSent: emailResult.delivered,
    };
  }

  changePassword(userId: string, input: ChangePasswordDto, origin: string) {
    return this.passwordChanges.request(userId, input, origin);
  }

  pendingPasswordChange(userId: string) {
    return this.passwordChanges.pending(userId);
  }

  passwordChangeStatus(userId: string, id: string) {
    return this.passwordChanges.status(userId, id);
  }

  cancelPasswordChange(userId: string, id: string) {
    return this.passwordChanges.cancel(userId, id);
  }

  passwordChangeReview(token: string, origin: string) {
    return this.passwordChanges.reviewPage(token, origin);
  }

  decidePasswordChange(token: string, decision: "CONFIRMED" | "REJECTED") {
    return this.passwordChanges.decide(token, decision);
  }

  async findAuthenticatedUser(userId: string): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roles: true },
    });
    if (!user) throw new UnauthorizedException("Account no longer exists");
    return this.toAuthenticatedUser(user);
  }

  async verifyMfaChallenge(
    challengeToken: string,
    code: string,
    recoveryCode = false,
    rememberDevice = false,
  ) {
    const result = await this.mfa.verifyChallenge(
      challengeToken,
      code,
      recoveryCode,
      rememberDevice,
    );
    return {
      ...(await this.createSession(result.user)),
      ...(result.trustedDeviceToken
        ? { trustedDeviceToken: result.trustedDeviceToken, trustedForDays: 30 }
        : {}),
    };
  }

  async mfaStatus(userId: string) {
    return {
      ...(await this.mfa.status(userId)),
      trustedDeviceCount: await this.mfa.trustedDeviceCount(userId),
    };
  }

  async revokeTrustedDevices(userId: string) {
    return this.mfa.revokeTrustedDevices(userId);
  }

  async beginMfaSetup(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true },
    });
    return this.mfa.beginSetup(userId, user.email);
  }

  async confirmMfaSetup(userId: string, code: string) {
    return this.mfa.confirmSetup(userId, code);
  }

  async disableMfa(userId: string, currentPassword: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true, roles: { select: { role: true } } },
    });
    if (!(await compare(currentPassword, user.passwordHash)))
      throw new UnauthorizedException("Current password is incorrect");
    if (
      user.roles.some(
        ({ role }) => role === UserRole.ADMIN || role === UserRole.SCHOOL_ADMIN,
      )
    )
      throw new BadRequestException(
        "Two-factor authentication is required for administrator accounts",
      );
    await this.mfa.verifyCurrentCode(userId, code);
    return this.mfa.disable(userId);
  }

  async regenerateRecoveryCodes(userId: string, code: string) {
    await this.mfa.verifyCurrentCode(userId, code);
    return this.mfa.regenerateRecoveryCodes(userId);
  }

  private async createSession(user: AuthenticatedUser) {
    const payload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      roles: user.roles,
    };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>("JWT_SECRET"),
      expiresIn: "7d",
    });
    return { accessToken, tokenType: "Bearer", expiresIn: 604800, user };
  }

  private async createLoginResult(
    user: {
      id: string;
      email: string;
      displayName: string;
      avatarPath: string | null;
      status: any;
      mfaEnabledAt: Date | null;
      roles: { role: UserRole }[];
    },
    trustedDeviceToken?: string,
  ) {
    if (
      user.mfaEnabledAt &&
      !(await this.mfa.isTrustedDevice(user.id, trustedDeviceToken))
    )
      return {
        requiresTwoFactor: true as const,
        challengeToken: await this.mfa.createChallenge(user.id),
        method: "AUTHENTICATOR" as const,
      };
    return this.createSession(this.toAuthenticatedUser(user));
  }

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }
  private shouldExposeDevelopmentCode() {
    if (this.config.get<string>("NODE_ENV") === "production") return false;
    const gmailConfigured = Boolean(
      this.config.get<string>("SMTP_USER") &&
        this.config.get<string>("SMTP_APP_PASSWORD"),
    );
    const resendConfigured = Boolean(
      this.config.get<string>("RESEND_API_KEY") &&
        this.config.get<string>("EMAIL_FROM"),
    );
    return !gmailConfigured && !resendConfigured;
  }

  private async issueCode(
    userId: string,
    email: string,
    purpose: "VERIFY_EMAIL" | "RESET_PASSWORD",
  ) {
    const latest = await this.prisma.accountCode.findFirst({
      where: { userId, purpose },
      orderBy: { createdAt: "desc" },
    });
    if (latest && Date.now() - latest.createdAt.getTime() < 60000)
      throw new HttpException(
        "Please wait one minute before requesting another code",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    const code = randomInt(100000, 1000000).toString();
    await this.prisma.accountCode.create({
      data: {
        userId,
        purpose,
        codeHash: await hash(code, 10),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });
    await this.emailService.sendCode(email, code, purpose);
    return code;
  }

  private async validateCode(
    userId: string,
    purpose: "VERIFY_EMAIL" | "RESET_PASSWORD",
    plainCode: string,
  ) {
    const code = await this.prisma.accountCode.findFirst({
      where: {
        userId,
        purpose,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });
    if (!code || code.attempts >= 5)
      throw new BadRequestException("Invalid or expired code");
    if (!(await compare(plainCode, code.codeHash))) {
      await this.prisma.accountCode.update({
        where: { id: code.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException("Invalid or expired code");
    }
    return code;
  }

  private toAuthenticatedUser(user: {
    id: string;
    email: string;
    displayName: string;
    avatarPath: string | null;
    status: any;
    roles: { role: UserRole }[];
  }): AuthenticatedUser {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      hasAvatar: Boolean(user.avatarPath),
      status: user.status,
      roles: user.roles.map(({ role }) => role),
    };
  }
}
