import { Module } from "@nestjs/common";
import { MessagesModule } from "../messages/messages.module";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";
import { TrafficProtectionModule } from "../../security/traffic-protection.module";
import { MarketplacePricingModule } from "../marketplace-pricing/marketplace-pricing.module";
import { OrderReviewReconciler } from "./order-review-reconciler.service";
@Module({
  imports: [MessagesModule, TrafficProtectionModule, MarketplacePricingModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrderReviewReconciler],
  exports: [OrdersService],
})
export class OrdersModule {}
