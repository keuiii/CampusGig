import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import type { AccessTokenPayload } from "./auth.types";
import { PrismaService } from "../../prisma/prisma.service";

export type AuthenticatedRequest = Request & { auth: AccessTokenPayload };

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = request.headers.authorization?.split(" ") ?? [];
    if (scheme !== "Bearer" || !token)
      throw new UnauthorizedException("Bearer token required");
    try {
      const auth = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.getOrThrow<string>("JWT_SECRET"),
      });
      const user = await this.prisma.user.findUnique({
        where: { id: auth.sub },
        select: {
          status: true,
          sessionVersion: true,
          roles: { select: { role: true } },
        },
      });
      if (
        !user ||
        user.status !== "ACTIVE" ||
        user.sessionVersion !== auth.sessionVersion
      )
        throw new UnauthorizedException("Session is no longer active");
      if (auth.sid) {
        const session = await this.prisma.authSession.findFirst({
          where: {
            id: auth.sid,
            userId: auth.sub,
            sessionVersion: auth.sessionVersion,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
          select: { id: true },
        });
        if (!session)
          throw new UnauthorizedException("Session is no longer active");
      }
      request.auth = {
        ...auth,
        roles: user.roles.map(({ role }) => role),
      };
      return true;
    } catch {
      throw new UnauthorizedException("Invalid or expired access token");
    }
  }
}
