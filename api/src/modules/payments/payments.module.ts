import { Module } from "@nestjs/common";
import { PaymentLedgerService } from "./payment-ledger.service";
import { PaymentsController } from "./payments.controller";

@Module({
  controllers: [PaymentsController],
  providers: [PaymentLedgerService],
  exports: [PaymentLedgerService],
})
export class PaymentsModule {}
