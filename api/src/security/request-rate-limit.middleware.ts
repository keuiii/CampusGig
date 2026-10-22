import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { TokenBucketLimiter } from "./token-bucket-limiter";

type Policy = { name: string; capacity: number; refillPerMinute: number };

const GLOBAL_POLICY: Policy = {
  name: "global",
  capacity: 180,
  refillPerMinute: 600,
};
const AUTH_POLICY: Policy = {
  name: "authentication",
  capacity: 12,
  refillPerMinute: 12,
};
const ORDER_POLICY: Policy = {
  name: "order-create-ip",
  capacity: 20,
  refillPerMinute: 20,
};

@Injectable()
export class RequestRateLimitMiddleware implements NestMiddleware {
  constructor(private readonly limiter: TokenBucketLimiter) {}

  use(request: Request, response: Response, next: NextFunction) {
    const path = this.requestPath(request);
    const identity = request.ip || request.socket.remoteAddress || "unknown";
    if (
      request.method === "GET" &&
      (path.endsWith("/health") ||
        path.endsWith("/health/ready") ||
        path.endsWith("/metrics")) &&
      this.isInternalAddress(identity)
    ) {
      next();
      return;
    }
    const policies = [GLOBAL_POLICY, ...this.endpointPolicies(request, path)];
    for (const policy of policies) {
      const decision = this.limiter.consume(
        `${policy.name}:${identity}`,
        policy.capacity,
        policy.refillPerMinute,
      );
      response.setHeader("RateLimit-Limit", policy.capacity.toString());
      response.setHeader("RateLimit-Remaining", decision.remaining.toString());
      if (!decision.allowed) {
        response.setHeader(
          "Retry-After",
          decision.retryAfterSeconds.toString(),
        );
        response.status(429).json({
          statusCode: 429,
          error: "Too Many Requests",
          message: "Too many requests. Please wait before trying again.",
        });
        return;
      }
    }
    next();
  }

  private endpointPolicies(request: Request, path: string): Policy[] {
    if (
      request.method === "POST" &&
      /^\/api\/v1\/auth\/(login|register|forgot-password|resend-verification)$/.test(
        path,
      )
    )
      return [AUTH_POLICY];
    if (request.method === "POST" && path === "/api/v1/orders")
      return [ORDER_POLICY];
    return [];
  }

  private requestPath(request: Request) {
    return (request.originalUrl || request.path).split("?", 1)[0];
  }

  private isInternalAddress(address: string) {
    const normalized = address.replace(/^::ffff:/, "");
    return (
      normalized === "::1" ||
      normalized.startsWith("127.") ||
      normalized.startsWith("10.") ||
      normalized.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(normalized)
    );
  }
}
