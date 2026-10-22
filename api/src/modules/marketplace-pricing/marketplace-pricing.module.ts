import { Module } from "@nestjs/common";
import { MarketplacePricingPolicy } from "./marketplace-pricing.policy";

@Module({
  providers: [MarketplacePricingPolicy],
  exports: [MarketplacePricingPolicy],
})
export class MarketplacePricingModule {}
