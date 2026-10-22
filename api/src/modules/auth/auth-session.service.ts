import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Prisma, UserRole, UserStatus } from "@prisma/client";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";
import type {
  AccessTokenPayload,
  AuthenticatedUser,
  SessionContext,
} from "./auth.types";
import { SocketSessionRegistry } from "./socket-session-registry.service";

const invalidRefresh = () =>
  new UnauthorizedException("Refresh session is invalid or expired");

@Injectable()
export class AuthSessionService {
  private readonly accessTokenTtlSeconds: number;
  private readonly refreshTokenIdleDays: number;
  private readonly refreshTokenAbsoluteDays: number;
  private readonly refreshTokenReplayGraceSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly socketSessions?: SocketSessionRegistry,
  ) {
    this.accessTokenTtlSeconds = this.readInteger(
      "ACCESS_TOKEN_TTL_SECONDS",
      900,
      300,
      3600,
    );
    this.refreshTokenIdleDays = this.readInteger(
      "REFRESH_TOKEN_IDLE_DAYS",
      7,
      1,
      30,
    );
    this.refreshTokenAbsoluteDays = this.readInteger(
      "REFRESH_TOKEN_ABSOLUTE_DAYS",
      30,
      this.refreshTokenIdleDays,
      90,
    );
    this.refreshTokenReplayGraceSeconds = this.readInteger(
      "REFRESH_TOKEN_REPLAY_GRACE_SECONDS",
      15,
      5,
      60,
    );
  }

  async create(user: AuthenticatedUser, context: SessionContext) {
    const security = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { sessionVersion: true },
    });
    const refreshToken = this.newRefreshToken();
    const now = new Date();
    const absoluteExpiry = this.addDays(now, this.refreshTokenAbsoluteDays);
    const refreshExpiry = this.minimumDate(
      this.addDays(now, this.refreshTokenIdleDays),
      absoluteExpiry,
    );
    const session = await this.prisma.authSession.create({
      data: {
        userId: user.id,
        clientType: context.clientType,
        deviceName: this.normalizeDeviceName(context.deviceName),
        sessionVersion: security.sessionVersion,
        expiresAt: absoluteExpiry,
        refreshTokens: {
          create: {
            tokenHash: this.hashToken(refreshToken),
            expiresAt: refreshExpiry,
          },
        },
      },
      select: { id: true },
    });
    return this.issueResult(
      user,
      security.sessionVersion,
      session.id,
      refreshToken,
      refreshExpiry,
    );
  }

  async refresh(refreshToken: string) {
    const now = new Date();
    const outcome = await this.prisma.$transaction(async (database) => {
      const current = await database.refreshToken.findUnique({
        where: { tokenHash: this.hashToken(refreshToken) },
        include: {
          session: {
            include: { user: { include: { roles: true } } },
          },
        },
      });
      if (!current) return { status: "invalid" as const };
      const session = current.session;
      if (current.revokedAt) {
        await this.revokeFamily(database, session.id, "TOKEN_REUSE");
        return { status: "reused" as const, sessionId: session.id };
      }
      if (
        current.expiresAt <= now ||
        session.expiresAt <= now ||
        session.revokedAt ||
        session.user.status !== "ACTIVE" ||
        session.user.sessionVersion !== session.sessionVersion
      ) {
        await this.revokeFamily(database, session.id, "EXPIRED_OR_INVALID");
        return { status: "invalid" as const, sessionId: session.id };
      }
      const nextToken = this.deriveNextRefreshToken(refreshToken, session.id);
      const replayRecentRotation = async (usedAt: Date) => {
        const ageMilliseconds = now.getTime() - usedAt.getTime();
        if (
          ageMilliseconds < 0 ||
          ageMilliseconds > this.refreshTokenReplayGraceSeconds * 1000
        )
          return null;
        const successor = await database.refreshToken.findUnique({
          where: { tokenHash: this.hashToken(nextToken) },
          select: {
            sessionId: true,
            expiresAt: true,
            revokedAt: true,
          },
        });
        if (
          !successor ||
          successor.sessionId !== session.id ||
          successor.revokedAt ||
          successor.expiresAt <= now
        )
          return null;
        return {
          status: "rotated" as const,
          sessionId: session.id,
          sessionVersion: session.sessionVersion,
          refreshToken: nextToken,
          refreshExpiry: successor.expiresAt,
          user: this.toAuthenticatedUser(session.user),
        };
      };
      if (current.usedAt) {
        const replay = await replayRecentRotation(current.usedAt);
        if (replay) return replay;
        await this.revokeFamily(database, session.id, "TOKEN_REUSE");
        return { status: "reused" as const, sessionId: session.id };
      }
      const consumed = await database.refreshToken.updateMany({
        where: {
          id: current.id,
          usedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });
      if (consumed.count !== 1) {
        const consumedByConcurrentRequest =
          await database.refreshToken.findUnique({
            where: { id: current.id },
            select: { usedAt: true, revokedAt: true },
          });
        if (
          consumedByConcurrentRequest?.usedAt &&
          !consumedByConcurrentRequest.revokedAt
        ) {
          const replay = await replayRecentRotation(
            consumedByConcurrentRequest.usedAt,
          );
          if (replay) return replay;
        }
        await this.revokeFamily(database, session.id, "TOKEN_REUSE");
        return { status: "reused" as const, sessionId: session.id };
      }
      const nextExpiry = this.minimumDate(
        this.addDays(now, this.refreshTokenIdleDays),
        session.expiresAt,
      );
      await database.refreshToken.create({
        data: {
          sessionId: session.id,
          tokenHash: this.hashToken(nextToken),
          expiresAt: nextExpiry,
        },
      });
      await database.authSession.update({
        where: { id: session.id },
        data: { lastUsedAt: now },
      });
      return {
        status: "rotated" as const,
        sessionId: session.id,
        sessionVersion: session.sessionVersion,
        refreshToken: nextToken,
        refreshExpiry: nextExpiry,
        user: this.toAuthenticatedUser(session.user),
      };
    });
    if (outcome.status !== "rotated") {
      if ("sessionId" in outcome && outcome.sessionId)
        this.socketSessions?.disconnectSession(
          outcome.sessionId,
          outcome.status === "reused" ? "token_reuse" : "session_invalid",
        );
      throw invalidRefresh();
    }
    return this.issueResult(
      outcome.user,
      outcome.sessionVersion,
      outcome.sessionId,
      outcome.refreshToken,
      outcome.refreshExpiry,
    );
  }

  async list(userId: string, currentSessionId?: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { sessionVersion: true },
    });
    const sessions = await this.prisma.authSession.findMany({
      where: {
        userId,
        sessionVersion: user.sessionVersion,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { lastUsedAt: "desc" },
      select: {
        id: true,
        clientType: true,
        deviceName: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
      },
    });
    return {
      data: sessions.map((session) => ({
        ...session,
        current: session.id === currentSessionId,
      })),
    };
  }

  async revoke(userId: string, sessionId: string, reason = "USER_LOGOUT") {
    const changed = await this.prisma.$transaction(async (database) => {
      const updated = await database.authSession.updateMany({
        where: { id: sessionId, userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: reason },
      });
      if (updated.count)
        await database.refreshToken.updateMany({
          where: { sessionId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      return updated.count;
    });
    if (changed) this.socketSessions?.disconnectSession(sessionId, reason);
    return { revoked: changed };
  }

  async revokeByToken(refreshToken?: string) {
    if (!refreshToken) return { revoked: 0 };
    const token = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hashToken(refreshToken) },
      select: { session: { select: { id: true, userId: true } } },
    });
    if (!token) return { revoked: 0 };
    return this.revoke(token.session.userId, token.session.id);
  }

  async revokeAll(userId: string) {
    const now = new Date();
    const result = await this.prisma.$transaction(async (database) => {
      await database.user.update({
        where: { id: userId },
        data: { sessionVersion: { increment: 1 } },
      });
      const sessions = await database.authSession.findMany({
        where: { userId, revokedAt: null },
        select: { id: true },
      });
      await database.authSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now, revokedReason: "LOGOUT_ALL" },
      });
      await database.refreshToken.updateMany({
        where: {
          sessionId: { in: sessions.map(({ id }) => id) },
          revokedAt: null,
        },
        data: { revokedAt: now },
      });
      return sessions.length;
    });
    this.socketSessions?.disconnectUser(userId, "logout_all");
    return { revoked: result };
  }

  invalidateUserSockets(userId: string, reason: string) {
    this.socketSessions?.disconnectUser(userId, reason);
  }

  private async issueResult(
    user: AuthenticatedUser,
    sessionVersion: number,
    sessionId: string,
    refreshToken: string,
    refreshExpiry: Date,
  ) {
    const payload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      roles: user.roles,
      sessionVersion,
      sid: sessionId,
    };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>("JWT_SECRET"),
      expiresIn: this.accessTokenTtlSeconds,
    });
    return {
      accessToken,
      tokenType: "Bearer",
      expiresIn: this.accessTokenTtlSeconds,
      refreshToken,
      refreshExpiresIn: Math.max(
        0,
        Math.floor((refreshExpiry.getTime() - Date.now()) / 1000),
      ),
      user,
    };
  }

  private async revokeFamily(
    database: Prisma.TransactionClient,
    sessionId: string,
    reason: string,
  ) {
    const now = new Date();
    await database.authSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: now, revokedReason: reason },
    });
    await database.refreshToken.updateMany({
      where: { sessionId, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  private newRefreshToken() {
    return randomBytes(48).toString("base64url");
  }

  private deriveNextRefreshToken(refreshToken: string, sessionId: string) {
    return createHmac("sha384", this.config.getOrThrow<string>("JWT_SECRET"))
      .update(`refresh:${sessionId}:${refreshToken}`)
      .digest("base64url");
  }

  private hashToken(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }

  private normalizeDeviceName(value: string) {
    const normalized = value
      .trim()
      .replace(/[\r\n]/g, " ")
      .slice(0, 100);
    return normalized || "Unknown device";
  }

  private addDays(value: Date, days: number) {
    return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
  }

  private minimumDate(first: Date, second: Date) {
    return first < second ? first : second;
  }

  private readInteger(
    name: string,
    fallback: number,
    minimum: number,
    maximum: number,
  ) {
    const value = Number(this.config.get<string>(name) ?? fallback);
    if (!Number.isInteger(value) || value < minimum || value > maximum)
      throw new Error(`${name} must be between ${minimum} and ${maximum}`);
    return value;
  }

  private toAuthenticatedUser(user: {
    id: string;
    email: string;
    displayName: string;
    avatarPath: string | null;
    status: UserStatus;
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
