import { Module } from "@nestjs/common";
import { OrderCreationRateLimitGuard } from "./order-creation-rate-limit.guard";
import { RequestRateLimitMiddleware } from "./request-rate-limit.middleware";
import { TokenBucketLimiter } from "./token-bucket-limiter";

@Module({
  providers: [
    TokenBucketLimiter,
    RequestRateLimitMiddleware,
    OrderCreationRateLimitGuard,
  ],
  exports: [
    TokenBucketLimiter,
    RequestRateLimitMiddleware,
    OrderCreationRateLimitGuard,
  ],
})
export class TrafficProtectionModule {}
