import { Module } from "@nestjs/common";
import { ServicesController } from "./services.controller";
import { ServicesService } from "./services.service";
import { MarketplacePricingModule } from "../marketplace-pricing/marketplace-pricing.module";

@Module({
  imports: [MarketplacePricingModule],
  controllers: [ServicesController],
  providers: [ServicesService],
})
export class ServicesModule {}
