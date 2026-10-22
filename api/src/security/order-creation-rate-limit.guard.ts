import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import type { Response } from "express";
import type { AuthenticatedRequest } from "../modules/auth/jwt-auth.guard";
import { TokenBucketLimiter } from "./token-bucket-limiter";

@Injectable()
export class OrderCreationRateLimitGuard implements CanActivate {
  constructor(private readonly limiter: TokenBucketLimiter) {}

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const decision = this.limiter.consume(
      `order-create-user:${request.auth.sub}`,
      5,
      5,
    );
    response.setHeader("RateLimit-Limit", "5");
    response.setHeader("RateLimit-Remaining", decision.remaining.toString());
    if (decision.allowed) return true;
    response.setHeader("Retry-After", decision.retryAfterSeconds.toString());
    throw new HttpException(
      "Too many service requests. Please wait before sending another.",
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
