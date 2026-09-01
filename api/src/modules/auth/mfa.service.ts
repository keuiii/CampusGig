import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { UserRole } from "@prisma/client";
import { compare, hash } from "bcryptjs";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { generateSecret, generateURI, verify } from "otplib";
import * as QRCode from "qrcode";
import { PrismaService } from "../../prisma/prisma.service";
import type { AuthenticatedUser } from "./auth.types";

@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async status(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        mfaEnabledAt: true,
        roles: { select: { role: true } },
        _count: {
          select: { mfaRecoveryCodes: { where: { usedAt: null } } },
        },
      },
    });
    return {
      enabled: Boolean(user.mfaEnabledAt),
      enabledAt: user.mfaEnabledAt,
      recoveryCodesRemaining: user._count.mfaRecoveryCodes,
      required: user.roles.some(
        ({ role }) => role === UserRole.ADMIN || role === UserRole.SCHOOL_ADMIN,
      ),
    };
  }

  async beginSetup(userId: string, email: string) {
    const secret = generateSecret({ length: 20 });
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaPendingSecretCipher: this.encrypt(secret) },
    });
    const uri = generateURI({
      issuer: "CampusGig",
      label: email,
      secret,
      algorithm: "sha1",
      digits: 6,
      period: 30,
    });
    return {
      secret,
      otpauthUri: uri,
      qrCodeDataUrl: await QRCode.toDataURL(uri, { margin: 1, width: 280 }),
    };
  }

  async confirmSetup(userId: string, token: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { mfaPendingSecretCipher: true },
    });
    if (!user.mfaPendingSecretCipher)
      throw new BadRequestException("Start authenticator setup first");
    const secret = this.decrypt(user.mfaPendingSecretCipher);
    await this.requireValidTotp(secret, token);
    const codes = this.createRecoveryCodes();
    await this.prisma.$transaction(async (database) => {
      await database.mfaRecoveryCode.deleteMany({ where: { userId } });
      await database.mfaRecoveryCode.createMany({
        data: await Promise.all(
          codes.map(async (code) => ({
            userId,
            codeHash: await hash(this.normalizeRecoveryCode(code), 10),
          })),
        ),
      });
      await database.user.update({
        where: { id: userId },
        data: {
          mfaEnabledAt: new Date(),
          mfaSecretCipher: this.encrypt(secret),
          mfaPendingSecretCipher: null,
          mfaLastUsedStep: BigInt(Math.floor(Date.now() / 30000)),
        },
      });
    });
    return { enabled: true, recoveryCodes: codes };
  }

  async createChallenge(userId: string) {
    const token = randomBytes(32).toString("base64url");
    await this.prisma.mfaChallenge.create({
      data: {
        userId,
        tokenHash: this.sha256(token),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });
    return token;
  }

  async verifyChallenge(
    challengeToken: string,
    code: string,
    recoveryCode = false,
    rememberDevice = false,
  ): Promise<{ user: AuthenticatedUser; trustedDeviceToken?: string }> {
    const challenge = await this.prisma.mfaChallenge.findUnique({
      where: { tokenHash: this.sha256(challengeToken) },
      include: { user: { include: { roles: true } } },
    });
    if (
      !challenge ||
      challenge.consumedAt ||
      challenge.expiresAt <= new Date() ||
      challenge.attempts >= 5
    )
      throw new UnauthorizedException("Invalid or expired sign-in challenge");

    try {
      if (recoveryCode) await this.consumeRecoveryCode(challenge.userId, code);
      else await this.verifyCurrentCode(challenge.userId, code);
    } catch (error) {
      await this.prisma.mfaChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      throw error;
    }
    await this.prisma.mfaChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    });
    return {
      user: this.toAuthenticatedUser(challenge.user),
      ...(rememberDevice
        ? {
            trustedDeviceToken: await this.issueTrustedDevice(challenge.userId),
          }
        : {}),
    };
  }

  async isTrustedDevice(userId: string, token?: string) {
    if (!token) return false;
    const device = await this.prisma.trustedDevice.findUnique({
      where: { tokenHash: this.sha256(token) },
    });
    if (
      !device ||
      device.userId !== userId ||
      device.revokedAt ||
      device.expiresAt <= new Date()
    )
      return false;
    await this.prisma.trustedDevice.update({
      where: { id: device.id },
      data: { lastUsedAt: new Date() },
    });
    return true;
  }

  async trustedDeviceCount(userId: string) {
    return this.prisma.trustedDevice.count({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    });
  }

  async revokeTrustedDevices(userId: string) {
    const result = await this.prisma.trustedDevice.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { revoked: result.count };
  }

  async verifyCurrentCode(userId: string, token: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        mfaSecretCipher: true,
        mfaEnabledAt: true,
        mfaLastUsedStep: true,
      },
    });
    if (!user.mfaEnabledAt || !user.mfaSecretCipher)
      throw new BadRequestException(
        "Authenticator verification is not enabled",
      );
    const currentStep = BigInt(Math.floor(Date.now() / 30000));
    if (user.mfaLastUsedStep && currentStep <= user.mfaLastUsedStep)
      throw new UnauthorizedException("Wait for a new authenticator code");
    await this.requireValidTotp(this.decrypt(user.mfaSecretCipher), token);
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaLastUsedStep: currentStep },
    });
  }

  async verifyCurrentFactor(
    userId: string,
    code: string,
    recoveryCode = false,
  ) {
    if (recoveryCode) return this.consumeRecoveryCode(userId, code);
    return this.verifyCurrentCode(userId, code);
  }

  async disable(userId: string) {
    await this.prisma.$transaction([
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.mfaChallenge.deleteMany({ where: { userId } }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          mfaEnabledAt: null,
          mfaSecretCipher: null,
          mfaPendingSecretCipher: null,
          mfaLastUsedStep: null,
        },
      }),
    ]);
    return { enabled: false };
  }

  async regenerateRecoveryCodes(userId: string) {
    const codes = this.createRecoveryCodes();
    await this.prisma.$transaction(async (database) => {
      await database.mfaRecoveryCode.deleteMany({ where: { userId } });
      await database.mfaRecoveryCode.createMany({
        data: await Promise.all(
          codes.map(async (code) => ({
            userId,
            codeHash: await hash(this.normalizeRecoveryCode(code), 10),
          })),
        ),
      });
    });
    return { recoveryCodes: codes };
  }

  private async consumeRecoveryCode(userId: string, plainCode: string) {
    const codes = await this.prisma.mfaRecoveryCode.findMany({
      where: { userId, usedAt: null },
    });
    const normalized = this.normalizeRecoveryCode(plainCode);
    const matched = await this.findMatchingCode(codes, normalized);
    if (!matched) throw new UnauthorizedException("Invalid recovery code");
    await this.prisma.mfaRecoveryCode.update({
      where: { id: matched.id },
      data: { usedAt: new Date() },
    });
  }

  private async issueTrustedDevice(userId: string) {
    const token = randomBytes(32).toString("base64url");
    await this.prisma.trustedDevice.create({
      data: {
        userId,
        tokenHash: this.sha256(token),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    return token;
  }

  private async findMatchingCode(
    codes: { id: string; codeHash: string }[],
    plainCode: string,
  ) {
    for (const code of codes)
      if (await compare(plainCode, code.codeHash)) return code;
    return null;
  }

  private async requireValidTotp(secret: string, token: string) {
    const result = await verify({
      secret,
      token,
      algorithm: "sha1",
      digits: 6,
      period: 30,
      epochTolerance: 30,
    });
    if (!result.valid)
      throw new UnauthorizedException("Invalid authenticator code");
  }

  private createRecoveryCodes() {
    return Array.from({ length: 10 }, () => {
      const value = randomBytes(5).toString("hex").toUpperCase();
      return `${value.slice(0, 5)}-${value.slice(5)}`;
    });
  }

  private normalizeRecoveryCode(code: string) {
    return code.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  }

  private encryptionKey() {
    const configured = this.config.get<string>("MFA_ENCRYPTION_KEY");
    if (!configured && this.config.get<string>("NODE_ENV") === "production")
      throw new Error("MFA_ENCRYPTION_KEY is required in production");
    return createHash("sha256")
      .update(configured || this.config.getOrThrow<string>("JWT_SECRET"))
      .digest();
  }

  private encrypt(value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey(), iv);
    const encrypted = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);
    return [iv, cipher.getAuthTag(), encrypted]
      .map((part) => part.toString("base64url"))
      .join(".");
  }

  private decrypt(value: string) {
    const [iv, tag, encrypted] = value
      .split(".")
      .map((part) => Buffer.from(part, "base64url"));
    if (!iv || !tag || !encrypted) throw new Error("Invalid MFA secret");
    const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8");
  }

  private sha256(value: string) {
    return createHash("sha256").update(value).digest("hex");
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
