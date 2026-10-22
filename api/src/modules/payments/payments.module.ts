import { Module } from "@nestjs/common";
import { PaymentLedgerService } from "./payment-ledger.service";
import { PaymentsController } from "./payments.controller";
import { PaymentWebhooksController } from "./payments.controller";
import { PaymongoClient } from "./paymongo.client";
import { MessagesModule } from "../messages/messages.module";
import { ProviderEarningsController } from "./provider-earnings.controller";
import { ProviderEarningsService } from "./provider-earnings.service";
import { OrdersModule } from "../orders/orders.module";
import { RefundsService } from "./refunds.service";
import { AdminRefundsController } from "./admin-refunds.controller";
import { ProviderPayoutsController } from "./provider-payouts.controller";
import { AdminPayoutsController } from "./admin-payouts.controller";
import { ProviderPayoutsService } from "./provider-payouts.service";
import { DisabledPayoutDisbursementAdapter } from "./payout-disbursement.adapter";
import { PayoutDestinationCipherService } from "./payout-destination-cipher.service";

@Module({
  imports: [MessagesModule, OrdersModule],
  controllers: [
    PaymentsController,
    PaymentWebhooksController,
    ProviderEarningsController,
    AdminRefundsController,
    ProviderPayoutsController,
    AdminPayoutsController,
  ],
  providers: [
    PaymentLedgerService,
    PaymongoClient,
    ProviderEarningsService,
    RefundsService,
    ProviderPayoutsService,
    PayoutDestinationCipherService,
    DisabledPayoutDisbursementAdapter,
  ],
  exports: [PaymentLedgerService, RefundsService],
})
export class PaymentsModule {}
