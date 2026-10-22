import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Request } from "express";

function internalAddress(address: string) {
  const normalized = address.replace(/^::ffff:/, "");
  return (
    normalized === "::1" ||
    normalized.startsWith("127.") ||
    normalized.startsWith("10.") ||
    normalized.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(normalized)
  );
}

@Injectable()
export class MetricsAccessGuard implements CanActivate {
  private readonly token?: string;

  constructor(config: ConfigService) {
    const tokenFile = config.get<string>("METRICS_TOKEN_FILE")?.trim();
    if (tokenFile && config.get<string>("METRICS_TOKEN")?.trim())
      throw new Error(
        "Configure only one of METRICS_TOKEN or METRICS_TOKEN_FILE",
      );
    const token = tokenFile
      ? readFileSync(tokenFile, "utf8").trim()
      : config.get<string>("METRICS_TOKEN")?.trim();
    const production =
      (config.get<string>("NODE_ENV") ?? process.env.NODE_ENV) === "production";
    if (production && (!token || token.length < 32))
      throw new Error(
        "Production requires METRICS_TOKEN with at least 32 characters",
      );
    if (token && token.length < 32)
      throw new Error("METRICS_TOKEN must contain at least 32 characters");
    this.token = token;
  }

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    if (!this.token) {
      const address = request.ip || request.socket.remoteAddress || "unknown";
      if (internalAddress(address)) return true;
      throw new UnauthorizedException();
    }
    const authorization = request.headers.authorization;
    const supplied =
      typeof authorization === "string" && authorization.startsWith("Bearer ")
        ? authorization.slice(7)
        : "";
    const expectedBytes = Buffer.from(this.token);
    const suppliedBytes = Buffer.from(supplied);
    if (
      suppliedBytes.length !== expectedBytes.length ||
      !timingSafeEqual(suppliedBytes, expectedBytes)
    )
      throw new UnauthorizedException();
    return true;
  }
}
