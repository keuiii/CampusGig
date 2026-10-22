import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  RawBodyRequest,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PaymentLedgerService } from "./payment-ledger.service";
import type { PaymongoWebhookPayload } from "./payment-ledger.service";
import { PaymongoClient } from "./paymongo.client";
import { CreateCheckoutDto } from "./dto/create-checkout.dto";
import { MetricsService } from "../../monitoring/metrics.service";
import { CreateExtraRevisionCheckoutDto } from "./dto/create-extra-revision-checkout.dto";
import { RequestRefundDto } from "./dto/request-refund.dto";
import { RefundsService } from "./refunds.service";

@ApiTags("payments")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("orders/:orderId/payments")
export class PaymentsController {
  constructor(
    private readonly payments: PaymentLedgerService,
    private readonly refunds: RefundsService,
  ) {}

  @Get()
  forOrder(
    @Req() request: AuthenticatedRequest,
    @Param("orderId", ParseUUIDPipe) orderId: string,
  ) {
    return this.payments.forOrder(request.auth.sub, orderId);
  }

  @Post("checkout")
  createCheckout(
    @Req() request: AuthenticatedRequest,
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Body() input: CreateCheckoutDto,
  ) {
    return this.payments.createCheckout(
      request.auth.sub,
      orderId,
      input.returnTarget ?? "WEB",
      requestOrigin(request),
    );
  }

  @Get("revision-quote")
  revisionQuote(
    @Req() request: AuthenticatedRequest,
    @Param("orderId", ParseUUIDPipe) orderId: string,
  ) {
    return this.payments.quoteExtraRevision(request.auth.sub, orderId);
  }

  @Post("revision-checkout")
  revisionCheckout(
    @Req() request: AuthenticatedRequest,
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Body() input: CreateExtraRevisionCheckoutDto,
  ) {
    return this.payments.createExtraRevisionCheckout(
      request.auth.sub,
      orderId,
      input.instructions,
      input.returnTarget ?? "WEB",
      requestOrigin(request),
    );
  }

  @Get("refund-eligibility")
  refundEligibility(
    @Req() request: AuthenticatedRequest,
    @Param("orderId", ParseUUIDPipe) orderId: string,
  ) {
    return this.refunds.eligibility(request.auth.sub, orderId);
  }

  @Post("refunds")
  requestRefund(
    @Req() request: AuthenticatedRequest,
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Body() input: RequestRefundDto,
  ) {
    return this.refunds.requestByClient(
      request.auth.sub,
      orderId,
      input.reason,
    );
  }
}

@ApiTags("payment-webhooks")
@Controller("payments")
export class PaymentWebhooksController {
  constructor(
    private readonly payments: PaymentLedgerService,
    private readonly paymongo: PaymongoClient,
    private readonly metrics: MetricsService,
  ) {}

  @Get("mobile-return")
  @Header("Content-Type", "text/html; charset=utf-8")
  @Header(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
  )
  mobileReturn(
    @Query("payment") payment: string | undefined,
    @Query("orderId", new ParseUUIDPipe({ version: "4" })) orderId: string,
    @Query(
      "revisionPurchaseId",
      new ParseUUIDPipe({ version: "4", optional: true }),
    )
    revisionPurchaseId?: string,
  ) {
    if (payment !== "success" && payment !== "cancelled")
      throw new BadRequestException("Invalid mobile payment return status");
    return mobilePaymentReturnPage(payment, orderId, revisionPurchaseId);
  }

  @Post("paymongo/webhook")
  async webhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers("paymongo-signature") signature: string | undefined,
  ) {
    if (!request.rawBody) {
      this.metrics.recordWebhookFailure("payload");
      throw new Error("Raw webhook body is unavailable");
    }
    try {
      this.paymongo.verifyWebhook(request.rawBody, signature);
    } catch (error) {
      this.metrics.recordWebhookFailure("signature");
      throw error;
    }
    try {
      return await this.payments.processWebhook(
        request.body as PaymongoWebhookPayload,
      );
    } catch (error) {
      this.metrics.recordWebhookFailure("processing");
      throw error;
    }
  }
}

function requestOrigin(request: Request) {
  const host = request.get("host");
  return host ? `${request.protocol}://${host}` : undefined;
}

export function mobilePaymentReturnPage(
  payment: "success" | "cancelled",
  orderId: string,
  revisionPurchaseId?: string,
) {
  const query = new URLSearchParams({ payment, orderId });
  if (revisionPurchaseId) query.set("revisionPurchaseId", revisionPurchaseId);
  const deepLink = `campusgig://payment-return?${query}`;
  const androidIntent = `intent://payment-return?${query}#Intent;scheme=campusgig;package=com.campusgig.app;end`;
  const escapedDeepLink = escapeHtml(deepLink);
  const escapedIntent = JSON.stringify(androidIntent).replaceAll(
    "<",
    "\\u003c",
  );
  const heading =
    payment === "success" ? "Payment submitted" : "Checkout cancelled";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Return to CampusGig</title><style>body{margin:0;background:#f4f8f5;color:#122019;font:16px system-ui,sans-serif;display:grid;min-height:100vh;place-items:center}.card{margin:24px;max-width:420px;padding:28px;border:1px solid #dce5df;border-radius:24px;background:#fff;text-align:center;box-shadow:0 14px 40px #1232}h1{font-size:26px;margin:0 0 10px}p{color:#52605a;line-height:1.5}a{display:block;margin-top:20px;padding:14px 18px;border-radius:14px;background:#0f6b4f;color:#fff;font-weight:700;text-decoration:none}</style></head>
<body><main class="card"><h1>${heading}</h1><p>Return to CampusGig to refresh your order securely.</p><a href="${escapedDeepLink}">Return to CampusGig</a></main><script>window.location.replace(${escapedIntent});</script></body></html>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
