import { Module } from "@nestjs/common";
import { PaymentLedgerService } from "./payment-ledger.service";
import { PaymentsController } from "./payments.controller";
import { PaymentWebhooksController } from "./payments.controller";
import { PaymongoClient } from "./paymongo.client";

@Module({
  controllers: [PaymentsController, PaymentWebhooksController],
  providers: [PaymentLedgerService, PaymongoClient],
  exports: [PaymentLedgerService],
})
export class PaymentsModule {}
