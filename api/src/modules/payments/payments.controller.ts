import { Controller, Get, Headers, Param, Post, RawBodyRequest, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PaymentLedgerService } from "./payment-ledger.service";
import type { PaymongoWebhookPayload } from "./payment-ledger.service";
import { PaymongoClient } from "./paymongo.client";

@ApiTags("payments")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("orders/:orderId/payments")
export class PaymentsController {
  constructor(private readonly payments: PaymentLedgerService) {}

  @Get()
  forOrder(
    @Req() request: AuthenticatedRequest,
    @Param("orderId") orderId: string,
  ) {
    return this.payments.forOrder(request.auth.sub, orderId);
  }

  @Post("checkout")
  createCheckout(@Req() request: AuthenticatedRequest, @Param("orderId") orderId: string) {
    return this.payments.createCheckout(request.auth.sub, orderId);
  }
}

@ApiTags("payment-webhooks")
@Controller("payments")
export class PaymentWebhooksController {
  constructor(
    private readonly payments: PaymentLedgerService,
    private readonly paymongo: PaymongoClient,
  ) {}

  @Post("paymongo/webhook")
  webhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers("paymongo-signature") signature: string | undefined,
  ) {
    if (!request.rawBody) throw new Error("Raw webhook body is unavailable");
    this.paymongo.verifyWebhook(request.rawBody, signature);
    return this.payments.processWebhook(request.body as PaymongoWebhookPayload);
  }
}
