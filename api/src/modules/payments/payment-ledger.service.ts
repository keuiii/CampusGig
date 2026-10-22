import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { ConflictException, ForbiddenException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { PaymongoCheckoutError, PaymongoClient } from "./paymongo.client";
import { paymongoTimestamp } from "./paymongo.client";
import { MessagesGateway } from "../messages/messages.gateway";
import {
  pendingEarningCreditSourceKey,
  providerEarningPrincipal,
  revisionPendingEarningCreditSourceKey,
} from "./provider-earnings.policy";
import { lockOrderReview } from "../orders/order-review-lock";
import { ACTIVE_DISPUTE_STATUSES } from "../disputes/dispute-status";
import { orderReviewPolicyVersion } from "../orders/order-review.policy";
import { legacyPackageTerms } from "../orders/legacy-order-terms";
import {
  paidExtraRevisionQuote,
  revisionDeadlineAt,
} from "../orders/revision-policy";
import { RefundsService } from "./refunds.service";
import { ConfigService } from "@nestjs/config";

export function calculateV2Deadline(
  paymentConfirmedAt: Date,
  deliveryDurationMinutes: number,
) {
  if (
    Number.isNaN(paymentConfirmedAt.getTime()) ||
    !Number.isSafeInteger(deliveryDurationMinutes) ||
    deliveryDurationMinutes <= 0
  )
    throw new Error("V2 order delivery duration is invalid");
  return new Date(
    paymentConfirmedAt.getTime() + deliveryDurationMinutes * 60_000,
  );
}

@Injectable()
export class PaymentLedgerService {
  private readonly reconciliationAttempts = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymongo: PaymongoClient,
    private readonly realtime?: MessagesGateway,
    @Optional() private readonly refunds?: RefundsService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  async forOrder(userId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        OR: [{ clientId: userId }, { providerId: userId }],
      },
      select: { id: true },
    });
    if (!order) throw new NotFoundException("Order not found");
    await Promise.all([
      this.reconcilePendingPayment(orderId),
      this.reconcilePendingRevisionPurchases(orderId),
    ]);
    return {
      data: await this.prisma.payment.findMany({
        where: { orderId },
        select: {
          id: true,
          provider: true,
          amountCentavos: true,
          platformFeeCentavos: true,
          providerNetCentavos: true,
          refundedCentavos: true,
          currency: true,
          status: true,
          paidAt: true,
          createdAt: true,
          refunds: {
            select: {
              id: true,
              amountCentavos: true,
              reason: true,
              status: true,
              processedAt: true,
              createdAt: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
    };
  }

  async createCheckout(
    userId: string,
    orderId: string,
    returnTarget: "WEB" | "MOBILE" = "WEB",
    requestOrigin?: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        clientId: true,
        status: true,
        orderNumber: true,
        titleSnapshot: true,
        client: { select: { displayName: true, email: true } },
      },
    });
    if (!order) throw new NotFoundException("Order not found");
    if (order.clientId !== userId)
      throw new ForbiddenException("Only the client can pay for this order");
    if (
      !(
        [
          "ACCEPTED",
          "IN_PROGRESS",
          "REVISION_REQUESTED",
          "SUBMITTED",
          "COMPLETED",
        ] as string[]
      ).includes(order.status)
    )
      throw new ConflictException(
        "Payment is available after the provider accepts the request",
      );

    const settled = await this.prisma.payment.findFirst({
      where: {
        orderId,
        status: {
          in: ["PAID", "REFUND_PENDING", "PARTIALLY_REFUNDED", "REFUNDED"],
        },
      },
      orderBy: { createdAt: "desc" },
    });
    if (settled?.status === "PAID")
      throw new ConflictException("This order has already been paid");
    if (settled?.status === "REFUND_PENDING")
      throw new ConflictException(
        "A full refund is already in progress for this payment",
      );
    if (
      settled &&
      (["PARTIALLY_REFUNDED", "REFUNDED"] as string[]).includes(settled.status)
    )
      throw new ConflictException(
        "This order has already been paid and refunded. A new checkout cannot be created automatically. Contact support if another payment is required.",
      );

    const existing = await this.prisma.payment.findFirst({
      where: {
        orderId,
        status: { in: ["PENDING", "REQUIRES_ACTION"] },
      },
      orderBy: { createdAt: "desc" },
    });
    if (existing?.checkoutUrl)
      return {
        data: this.publicPayment(existing),
        checkoutUrl: existing.checkoutUrl,
      };
    if (existing?.failureCode === "checkout_creation_unknown")
      throw new ConflictException(
        "The previous checkout attempt is still being verified. Do not start another payment. Refresh the order shortly or contact support.",
      );

    const payment =
      existing ??
      (await this.createPending(
        orderId,
        `checkout:${orderId}:${randomUUID()}`,
      ));
    const claimed = await this.prisma.payment.updateMany({
      where: { id: payment.id, status: "PENDING", checkoutUrl: null },
      data: { status: "REQUIRES_ACTION", failureCode: null },
    });

    if (!claimed.count) return this.waitForCheckout(payment.id);

    try {
      const checkout = await this.paymongo.createCheckout({
        amountCentavos: payment.amountCentavos,
        orderId: order.id,
        orderNumber: order.orderNumber,
        title: order.titleSnapshot,
        customerName: order.client.displayName,
        customerEmail: order.client.email,
        currency: payment.currency,
        returnTarget,
        requestOrigin,
      });
      const updated = await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          providerCheckoutId: checkout.id,
          checkoutUrl: checkout.attributes.checkout_url,
        },
      });
      return {
        data: this.publicPayment(updated),
        checkoutUrl: checkout.attributes.checkout_url,
      };
    } catch (error) {
      const rejected =
        error instanceof PaymongoCheckoutError && error.outcome === "REJECTED";
      await this.prisma.payment.updateMany({
        where: { id: payment.id, status: "REQUIRES_ACTION", checkoutUrl: null },
        data: rejected
          ? { status: "FAILED", failureCode: "checkout_rejected" }
          : { failureCode: "checkout_creation_unknown" },
      });
      throw error;
    }
  }

  async quoteExtraRevision(userId: string, orderId: string) {
    return this.prisma.$transaction(async (database) => {
      await lockOrderReview(database, orderId);
      const context = await this.extraRevisionContext(
        database,
        userId,
        orderId,
        new Date(),
      );
      return {
        data: {
          ...context.quote,
          sourceOrderId: context.order.id,
          currentDeliverySubmissionId: context.order.reviewDeliverySubmissionId,
        },
      };
    });
  }

  async createExtraRevisionCheckout(
    userId: string,
    orderId: string,
    instructions: string,
    returnTarget: "WEB" | "MOBILE" = "WEB",
    requestOrigin?: string,
  ) {
    const revisionInstructions = instructions.trim();
    const prepared = await this.prisma.$transaction(async (database) => {
      await lockOrderReview(database, orderId);
      const context = await this.extraRevisionContext(
        database,
        userId,
        orderId,
        new Date(),
      );
      const sourceDeliverySubmissionId =
        context.order.reviewDeliverySubmissionId!;
      const existing = await database.orderRevisionPurchase.findFirst({
        where: {
          sourceDeliverySubmissionId,
          paymentStatus: { notIn: ["FAILED", "CANCELLED"] },
        },
        orderBy: { createdAt: "desc" },
      });
      if (existing) {
        if (existing.instructions !== revisionInstructions)
          throw new ConflictException(
            "An extra-revision checkout already exists for this delivery with different instructions",
          );
        return { purchase: existing, order: context.order, created: false };
      }
      const purchase = await database.orderRevisionPurchase.create({
        data: {
          orderId,
          sourceDeliverySubmissionId,
          clientId: userId,
          providerId: context.order.providerId,
          instructions: revisionInstructions,
          providerSubtotalCentavos: context.quote.providerSubtotalCentavos,
          platformFeeCentavos: context.quote.platformFeeCentavos,
          totalCentavos: context.quote.clientTotalCentavos,
          currency: context.quote.currency,
          turnaroundMinutes: context.quote.turnaroundMinutes,
          pricingPolicyVersion: context.quote.pricingPolicyVersion,
          pricingBasisCentavos: context.quote.pricingBasisCentavos,
          deliveryDurationBasisMinutes:
            context.quote.deliveryDurationBasisMinutes,
          idempotencyKey: `revision-checkout:${orderId}:${sourceDeliverySubmissionId}:${randomUUID()}`,
        },
      });
      return { purchase, order: context.order, created: true };
    });

    if (prepared.purchase.checkoutUrl)
      return {
        data: this.publicRevisionPurchase(prepared.purchase),
        checkoutUrl: prepared.purchase.checkoutUrl,
      };
    if (
      !prepared.created &&
      prepared.purchase.failureCode === "checkout_creation_unknown"
    )
      throw new ConflictException(
        "The previous extra-revision checkout is still being verified. Refresh shortly or contact support.",
      );
    const claimed = await this.prisma.orderRevisionPurchase.updateMany({
      where: {
        id: prepared.purchase.id,
        paymentStatus: "PENDING",
        checkoutUrl: null,
      },
      data: { paymentStatus: "REQUIRES_ACTION", failureCode: null },
    });
    if (!claimed.count)
      return this.waitForRevisionCheckout(prepared.purchase.id);

    try {
      const checkout = await this.paymongo.createCheckout({
        amountCentavos: prepared.purchase.totalCentavos,
        orderId: prepared.order.id,
        orderNumber: prepared.order.orderNumber,
        title: `Extra revision for ${prepared.order.titleSnapshot}`,
        customerName: prepared.order.client.displayName,
        customerEmail: prepared.order.client.email,
        currency: prepared.purchase.currency,
        returnTarget,
        requestOrigin,
        revisionPurchaseId: prepared.purchase.id,
      });
      const updated = await this.prisma.orderRevisionPurchase.update({
        where: { id: prepared.purchase.id },
        data: {
          providerCheckoutId: checkout.id,
          checkoutUrl: checkout.attributes.checkout_url,
        },
      });
      return {
        data: this.publicRevisionPurchase(updated),
        checkoutUrl: updated.checkoutUrl!,
      };
    } catch (error) {
      const rejected =
        error instanceof PaymongoCheckoutError && error.outcome === "REJECTED";
      await this.prisma.orderRevisionPurchase.updateMany({
        where: {
          id: prepared.purchase.id,
          paymentStatus: "REQUIRES_ACTION",
          checkoutUrl: null,
        },
        data: rejected
          ? { paymentStatus: "FAILED", failureCode: "checkout_rejected" }
          : { failureCode: "checkout_creation_unknown" },
      });
      throw error;
    }
  }

  async processWebhook(payload: PaymongoWebhookPayload) {
    if (
      !payload?.data?.id ||
      payload.data.type !== "event" ||
      !payload.data.attributes?.type
    )
      throw new BadRequestException("Invalid PayMongo webhook payload");
    const expectedLiveMode =
      this.config?.get<string>("PAYMONGO_MODE")?.trim().toLowerCase() ===
      "live";
    if (payload.data.attributes.livemode !== expectedLiveMode)
      throw new BadRequestException(
        `PayMongo ${payload.data.attributes.livemode ? "live" : "test"} event does not match the configured payment mode`,
      );
    const eventType = payload.data.attributes.type;
    const recorded = await this.recordWebhookOnce(
      payload.data.id,
      eventType,
      payload as unknown as Prisma.InputJsonValue,
    );
    if (recorded.duplicate && recorded.event.processedAt)
      return { received: true, duplicate: true };
    try {
      if (eventType === "checkout_session.payment.paid") {
        const resource = payload.data.attributes.data;
        if (!resource?.id)
          throw new Error("PayMongo checkout resource is missing");
        const providerPayment = resource.attributes.payments?.[0];
        const providerPaymentId = providerPayment?.id;
        const providerAmount = providerPayment?.attributes?.amount;
        const providerCurrency = providerPayment?.attributes?.currency
          ?.trim()
          .toUpperCase();
        const providerPaidAt = paymongoTimestamp(
          providerPayment?.attributes?.paid_at,
        );
        if (!providerPaymentId)
          throw new Error("PayMongo paid checkout is missing its payment ID");
        if (!Number.isInteger(providerAmount) || providerAmount! <= 0)
          throw new Error(
            "PayMongo paid checkout has an invalid payment amount",
          );
        const [payment, revisionPurchase] = await Promise.all([
          this.prisma.payment.findUnique({
            where: { providerCheckoutId: resource.id },
          }),
          this.prisma.orderRevisionPurchase.findUnique({
            where: { providerCheckoutId: resource.id },
          }),
        ]);
        if (!payment && !revisionPurchase)
          throw new Error(
            "Checkout session is not linked to a CampusGig payment",
          );
        if (payment && revisionPurchase)
          throw new Error("Checkout session has ambiguous CampusGig ownership");
        const expectedAmount =
          payment?.amountCentavos ?? revisionPurchase!.totalCentavos;
        const expectedCurrency =
          payment?.currency ?? revisionPurchase!.currency;
        if (providerAmount !== expectedAmount)
          throw new Error(
            "PayMongo payment amount does not match the order ledger",
          );
        if (!providerCurrency || providerCurrency !== expectedCurrency)
          throw new Error(
            "PayMongo payment currency does not match the CampusGig ledger",
          );
        if (payment)
          await this.markPaid(
            payment,
            providerPaymentId,
            recorded.event.id,
            providerPaidAt,
          );
        else
          await this.markRevisionPaid(
            revisionPurchase!,
            providerPaymentId,
            recorded.event.id,
            providerPaidAt,
          );
      } else if (eventType === "checkout_session.payment.failed") {
        const checkoutId = payload.data.attributes.data?.id;
        if (!checkoutId)
          throw new Error("PayMongo checkout resource is missing");
        const [failedPayment, failedRevisionPurchase] = await Promise.all([
          this.prisma.payment.findUnique({
            where: { providerCheckoutId: checkoutId },
            select: {
              orderId: true,
              order: { select: { clientId: true, providerId: true } },
            },
          }),
          this.prisma.orderRevisionPurchase.findUnique({
            where: { providerCheckoutId: checkoutId },
            select: { orderId: true, clientId: true, providerId: true },
          }),
        ]);
        await this.prisma.$transaction(async (database) => {
          await database.payment.updateMany({
            where: {
              providerCheckoutId: checkoutId,
              status: { in: ["PENDING", "REQUIRES_ACTION"] },
            },
            data: { status: "FAILED", failureCode: "checkout_failed" },
          });
          await database.orderRevisionPurchase.updateMany({
            where: {
              providerCheckoutId: checkoutId,
              paymentStatus: { in: ["PENDING", "REQUIRES_ACTION"] },
            },
            data: {
              paymentStatus: "FAILED",
              failureCode: "checkout_failed",
            },
          });
          await database.paymentWebhookEvent.update({
            where: { id: recorded.event.id },
            data: { processedAt: new Date(), processingError: null },
          });
        });
        if (failedPayment)
          this.realtime?.publishPaymentChanged?.(
            failedPayment.orderId,
            [failedPayment.order.clientId, failedPayment.order.providerId],
            "FAILED",
          );
        else if (failedRevisionPurchase)
          this.realtime?.publishPaymentChanged?.(
            failedRevisionPurchase.orderId,
            [
              failedRevisionPurchase.clientId,
              failedRevisionPurchase.providerId,
            ],
            "FAILED",
          );
      } else if (eventType === "payment.refunded") {
        const resource = payload.data.attributes.data;
        if (!resource?.id)
          throw new Error(
            "PayMongo refunded payment is missing its payment ID",
          );
        const refunds = resource.attributes.refunds ?? [];
        if (!this.refunds || refunds.length === 0)
          throw new Error(
            "Refund workflow is unavailable or provider evidence is missing",
          );
        for (const refund of refunds) {
          if (
            !Number.isSafeInteger(refund.attributes.amount) ||
            refund.attributes.amount <= 0
          )
            throw new Error("PayMongo refund contains an invalid amount");
          await this.refunds.applyWebhookRefund({
            providerRefundId: refund.id,
            paymentId: resource.id,
            amountCentavos: refund.attributes.amount,
            currency: resource.attributes.currency,
            reason: refund.attributes.reason,
            status: refund.attributes.status,
            createdAt: paymongoTimestamp(refund.attributes.created_at),
            updatedAt: paymongoTimestamp(refund.attributes.updated_at),
          });
        }
        await this.prisma.paymentWebhookEvent.update({
          where: { id: recorded.event.id },
          data: { processedAt: new Date(), processingError: null },
        });
      } else if (eventType === "payment.refund.updated") {
        const refund = payload.data.attributes.data;
        if (
          !this.refunds ||
          !refund?.id ||
          !refund.attributes.payment_id ||
          !Number.isSafeInteger(refund.attributes.amount) ||
          refund.attributes.amount! <= 0 ||
          !refund.attributes.status
        )
          throw new Error("PayMongo refund update is incomplete");
        await this.refunds.applyWebhookRefund({
          providerRefundId: refund.id,
          paymentId: refund.attributes.payment_id,
          amountCentavos: refund.attributes.amount!,
          currency: refund.attributes.currency,
          reason: refund.attributes.reason,
          status: refund.attributes.status,
          createdAt: paymongoTimestamp(refund.attributes.created_at),
          updatedAt: paymongoTimestamp(refund.attributes.updated_at),
        });
        await this.prisma.paymentWebhookEvent.update({
          where: { id: recorded.event.id },
          data: { processedAt: new Date(), processingError: null },
        });
      } else {
        await this.prisma.paymentWebhookEvent.update({
          where: { id: recorded.event.id },
          data: { processedAt: new Date(), processingError: null },
        });
      }
      return { received: true, duplicate: false };
    } catch (error) {
      await this.prisma.paymentWebhookEvent.update({
        where: { id: recorded.event.id },
        data: {
          processingError:
            error instanceof Error
              ? error.message.slice(0, 1000)
              : "Unknown processing error",
        },
      });
      throw error;
    }
  }

  async createPending(orderId: string, idempotencyKey: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        subtotalCentavos: true,
        totalCentavos: true,
        platformFeeCentavos: true,
        currency: true,
      },
    });
    if (!order) throw new NotFoundException("Order not found");
    if (order.totalCentavos <= 0)
      throw new BadRequestException("Payment amount must be positive");
    if (
      order.totalCentavos !==
      order.subtotalCentavos + order.platformFeeCentavos
    )
      throw new BadRequestException("Order payment totals are inconsistent");
    const providerNetCentavos = order.subtotalCentavos;

    try {
      return await this.prisma.payment.upsert({
        where: { idempotencyKey },
        create: {
          orderId,
          idempotencyKey,
          amountCentavos: order.totalCentavos,
          platformFeeCentavos: order.platformFeeCentavos,
          providerNetCentavos,
          currency: order.currency,
        },
        update: {},
      });
    } catch (error: unknown) {
      if ((error as { code?: string }).code !== "P2002") throw error;
      const active = await this.prisma.payment.findFirst({
        where: {
          orderId,
          status: { in: ["PENDING", "REQUIRES_ACTION", "PAID"] },
        },
        orderBy: { createdAt: "desc" },
      });
      if (!active) throw error;
      return active;
    }
  }

  private async reconcilePendingPayment(orderId: string) {
    const lastAttempt = this.reconciliationAttempts.get(orderId) ?? 0;
    if (Date.now() - lastAttempt < 5_000) return;
    this.reconciliationAttempts.set(orderId, Date.now());
    try {
      const payment = await this.prisma.payment.findFirst({
        where: {
          orderId,
          status: { in: ["PENDING", "REQUIRES_ACTION"] },
          providerCheckoutId: { not: null },
        },
        orderBy: { createdAt: "desc" },
      });
      if (!payment?.providerCheckoutId) return;
      const paid = await this.paymongo.paidCheckout(payment.providerCheckoutId);
      if (!paid) return;
      if (
        paid.amountCentavos !== payment.amountCentavos ||
        paid.currency.toUpperCase() !== payment.currency.toUpperCase()
      )
        throw new Error("PayMongo payment does not match the order ledger");
      await this.markPaid(payment, paid.id, undefined, paid.paidAt);
    } catch {
      // Webhooks remain authoritative; a later refresh retries safe reconciliation.
    } finally {
      if (this.reconciliationAttempts.size > 1_000) {
        const cutoff = Date.now() - 60_000;
        for (const [key, attemptedAt] of this.reconciliationAttempts)
          if (attemptedAt < cutoff) this.reconciliationAttempts.delete(key);
      }
    }
  }

  private async reconcilePendingRevisionPurchases(orderId: string) {
    const key = `revision:${orderId}`;
    const lastAttempt = this.reconciliationAttempts.get(key) ?? 0;
    if (Date.now() - lastAttempt < 5_000) return;
    this.reconciliationAttempts.set(key, Date.now());
    try {
      const purchases = await this.prisma.orderRevisionPurchase.findMany({
        where: {
          orderId,
          paymentStatus: { in: ["PENDING", "REQUIRES_ACTION"] },
          providerCheckoutId: { not: null },
        },
        orderBy: { createdAt: "asc" },
        take: 5,
      });
      for (const purchase of purchases) {
        const paid = await this.paymongo.paidCheckout(
          purchase.providerCheckoutId!,
        );
        if (!paid) continue;
        if (
          paid.amountCentavos !== purchase.totalCentavos ||
          paid.currency.toUpperCase() !== purchase.currency
        )
          throw new Error(
            "PayMongo payment does not match the revision ledger",
          );
        await this.markRevisionPaid(purchase, paid.id, undefined, paid.paidAt);
      }
    } catch {
      // Signed webhooks remain authoritative; later reads retry reconciliation.
    }
  }

  private async extraRevisionContext(
    database: Prisma.TransactionClient,
    userId: string,
    orderId: string,
    now: Date,
  ) {
    const order = await database.order.findFirst({
      where: { id: orderId, clientId: userId },
      select: {
        id: true,
        clientId: true,
        providerId: true,
        orderNumber: true,
        titleSnapshot: true,
        status: true,
        pricingModel: true,
        subtotalCentavos: true,
        platformFeeCentavos: true,
        totalCentavos: true,
        currency: true,
        deliveryDurationMinutes: true,
        termsSnapshot: true,
        revisionsUsed: true,
        revisionLimit: true,
        reviewPolicyVersion: true,
        reviewDeadlineAt: true,
        reviewDeliverySubmissionId: true,
        client: { select: { displayName: true, email: true } },
        deliverySubmissions: {
          orderBy: { version: "desc" },
          take: 1,
          select: { id: true },
        },
        payments: {
          where: { status: "PAID" },
          take: 2,
          select: {
            id: true,
            amountCentavos: true,
            platformFeeCentavos: true,
            providerNetCentavos: true,
            refundedCentavos: true,
            currency: true,
            refunds: {
              where: { status: "SUCCEEDED" },
              select: { id: true },
            },
          },
        },
        revisions: {
          where: {
            status: { in: ["OPEN", "AWAITING_PROVIDER_ACKNOWLEDGEMENT"] },
          },
          select: { id: true },
        },
        disputes: {
          where: { status: { in: [...ACTIVE_DISPUTE_STATUSES] } },
          select: { id: true },
        },
      },
    });
    if (!order) throw new NotFoundException("Order not found");
    if (order.status !== "SUBMITTED")
      throw new ConflictException(
        "An extra revision is available only while reviewing submitted work",
      );
    if (order.revisionsUsed < order.revisionLimit)
      throw new ConflictException(
        "Use the remaining included revision before purchasing an extra revision",
      );
    const latestDelivery = order.deliverySubmissions[0];
    if (
      order.reviewPolicyVersion !== orderReviewPolicyVersion ||
      !order.reviewDeadlineAt ||
      order.reviewDeadlineAt.getTime() <= now.getTime() ||
      !order.reviewDeliverySubmissionId ||
      latestDelivery?.id !== order.reviewDeliverySubmissionId
    )
      throw new ConflictException(
        "The current delivery does not have an actionable review window",
      );
    if (order.revisions.length)
      throw new ConflictException("Another revision request is already active");
    if (order.disputes.length)
      throw new ConflictException("An active dispute blocks revision checkout");
    const payment = order.payments[0];
    if (
      order.payments.length !== 1 ||
      !payment ||
      payment.refundedCentavos !== 0 ||
      payment.refunds.length
    )
      throw new ConflictException(
        "A confirmed, unreimbursed order payment is required",
      );
    const principal = providerEarningPrincipal(order, payment);
    const duration =
      order.pricingModel === "SINGLE_PRICE_V2"
        ? order.deliveryDurationMinutes
        : (() => {
            const terms = legacyPackageTerms(order.termsSnapshot);
            return terms ? terms.deliveryDays * 24 * 60 : null;
          })();
    if (!Number.isSafeInteger(duration) || (duration ?? 0) <= 0)
      throw new ConflictException(
        "Paid extra revisions are unavailable because immutable delivery-duration evidence is missing",
      );
    return {
      order,
      quote: paidExtraRevisionQuote(
        principal.amountCentavos,
        principal.currency,
        duration!,
      ),
    };
  }

  private async markRevisionPaid(
    purchase: { id: string; orderId: string },
    providerPaymentId: string,
    webhookEventId?: string,
    providerPaidAt?: Date | null,
  ) {
    if (!providerPaidAt || Number.isNaN(providerPaidAt.getTime()))
      throw new Error(
        "PayMongo paid checkout is missing its authoritative payment timestamp",
      );
    const confirmedAt = providerPaidAt;
    const result = await this.prisma.$transaction(async (database) => {
      await lockOrderReview(database, purchase.orderId);
      const current = await database.orderRevisionPurchase.findUniqueOrThrow({
        where: { id: purchase.id },
        include: {
          order: {
            select: {
              id: true,
              clientId: true,
              providerId: true,
              titleSnapshot: true,
              status: true,
              revisionsUsed: true,
              revisionLimit: true,
              reviewPolicyVersion: true,
              reviewDeadlineAt: true,
              reviewDeliverySubmissionId: true,
              deliverySubmissions: {
                orderBy: { version: "desc" },
                take: 1,
                select: { id: true },
              },
              revisions: {
                where: {
                  status: {
                    in: ["OPEN", "AWAITING_PROVIDER_ACKNOWLEDGEMENT"],
                  },
                },
                select: { id: true },
              },
              disputes: {
                where: { status: { in: [...ACTIVE_DISPUTE_STATUSES] } },
                select: { id: true },
              },
            },
          },
        },
      });
      if (current.paymentStatus === "PAID") {
        if (webhookEventId)
          await database.paymentWebhookEvent.update({
            where: { id: webhookEventId },
            data: { processedAt: new Date(), processingError: null },
          });
        return {
          transitioned: false,
          order: current.order,
          activated: current.activationStatus === "ACTIVATED",
        };
      }
      const paid = await database.orderRevisionPurchase.updateMany({
        where: {
          id: current.id,
          paymentStatus: { in: ["PENDING", "REQUIRES_ACTION"] },
        },
        data: {
          paymentStatus: "PAID",
          providerPaymentId,
          paidAt: confirmedAt,
        },
      });
      if (paid.count !== 1)
        throw new ConflictException(
          "The extra-revision payment changed before confirmation",
        );

      const order = current.order;
      const latestDelivery = order.deliverySubmissions[0];
      const canActivate =
        order.status === "SUBMITTED" &&
        order.revisionsUsed >= order.revisionLimit &&
        order.reviewPolicyVersion === orderReviewPolicyVersion &&
        order.reviewDeadlineAt !== null &&
        order.reviewDeadlineAt.getTime() > confirmedAt.getTime() &&
        order.reviewDeliverySubmissionId ===
          current.sourceDeliverySubmissionId &&
        latestDelivery?.id === current.sourceDeliverySubmissionId &&
        order.revisions.length === 0 &&
        order.disputes.length === 0;
      if (!canActivate) {
        await database.orderRevisionPurchase.update({
          where: { id: current.id },
          data: {
            activationStatus: "RECONCILIATION_REQUIRED",
            failureCode: "stale_order_state_after_payment",
          },
        });
        if (webhookEventId)
          await database.paymentWebhookEvent.update({
            where: { id: webhookEventId },
            data: { processedAt: new Date(), processingError: null },
          });
        return { transitioned: true, order, activated: false };
      }

      const latestSequence = await database.revisionRequest.findFirst({
        where: { orderId: order.id },
        orderBy: { sequenceNumber: "desc" },
        select: { sequenceNumber: true },
      });
      const deadline = revisionDeadlineAt(
        confirmedAt,
        current.turnaroundMinutes,
      );
      const revision = await database.revisionRequest.create({
        data: {
          orderId: order.id,
          requestedBy: order.clientId,
          sequenceNumber: (latestSequence?.sequenceNumber ?? 0) + 1,
          type: "PAID_EXTRA",
          instructions: current.instructions,
          sourceDeliverySubmissionId: current.sourceDeliverySubmissionId,
          revisionDeadlineAt: deadline,
          turnaroundMinutes: current.turnaroundMinutes,
          createdAt: confirmedAt,
        },
      });
      const changed = await database.order.updateMany({
        where: {
          id: order.id,
          status: "SUBMITTED",
          reviewDeliverySubmissionId: current.sourceDeliverySubmissionId,
        },
        data: {
          status: "REVISION_REQUESTED",
          reviewPolicyVersion: null,
          reviewStartedAt: null,
          reviewDeadlineAt: null,
          reviewDeliverySubmissionId: null,
        },
      });
      if (changed.count !== 1)
        throw new ConflictException(
          "The order changed before the paid revision could activate",
        );
      await database.orderRevisionPurchase.update({
        where: { id: current.id },
        data: {
          revisionRequestId: revision.id,
          activationStatus: "ACTIVATED",
          activatedAt: confirmedAt,
          failureCode: null,
        },
      });
      await database.providerEarning.create({
        data: {
          providerId: order.providerId,
          orderId: order.id,
          paymentId: null,
          revisionPurchaseId: current.id,
          sourceType: "PAID_EXTRA_REVISION",
          currency: current.currency,
          grossServiceAmountCentavos: current.providerSubtotalCentavos,
          status: "PENDING",
          pendingAt: confirmedAt,
          ledgerEntries: {
            create: {
              providerId: order.providerId,
              orderId: order.id,
              sourcePaymentId: null,
              sourceRevisionPurchaseId: current.id,
              type: "EARNING_PENDING_CREDIT",
              amountCentavos: current.providerSubtotalCentavos,
              currency: current.currency,
              sourceKey: revisionPendingEarningCreditSourceKey(current.id),
              createdAt: confirmedAt,
            },
          },
        },
      });
      await database.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: "SUBMITTED",
          toStatus: "REVISION_REQUESTED",
          changedBy: order.clientId,
          note: `Paid extra revision ${revision.sequenceNumber} activated`,
        },
      });
      await database.notification.createMany({
        data: [
          {
            orderId: order.id,
            recipientId: order.providerId,
            type: "PAID_EXTRA_REVISION_ACTIVATED",
            title: "Paid extra revision activated",
            body: `An extra revision for ${order.titleSnapshot} was paid and is ready for your work.`,
          },
          {
            orderId: order.id,
            recipientId: order.clientId,
            type: "PAID_EXTRA_REVISION_ACTIVATED",
            title: "Extra revision payment confirmed",
            body: `Your extra revision for ${order.titleSnapshot} is now active.`,
          },
        ],
      });
      if (webhookEventId)
        await database.paymentWebhookEvent.update({
          where: { id: webhookEventId },
          data: { processedAt: new Date(), processingError: null },
        });
      return { transitioned: true, order, activated: true };
    });
    if (result.transitioned)
      this.realtime?.publishPaymentChanged?.(
        result.order.id,
        [result.order.clientId, result.order.providerId],
        result.activated ? "PAID" : "RECONCILIATION_REQUIRED",
      );
    return result;
  }

  private async markPaid(
    payment: {
      id: string;
      orderId: string;
    },
    providerPaymentId: string,
    webhookEventId?: string,
    providerPaidAt?: Date | null,
  ) {
    if (!providerPaidAt || Number.isNaN(providerPaidAt.getTime()))
      throw new Error(
        "PayMongo paid checkout is missing its authoritative payment timestamp",
      );
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: payment.orderId },
      select: {
        clientId: true,
        providerId: true,
        titleSnapshot: true,
        pricingModel: true,
        deliveryDurationMinutes: true,
      },
    });
    const confirmedAt = providerPaidAt;
    if (
      order.pricingModel === "SINGLE_PRICE_V2" &&
      (!Number.isSafeInteger(order.deliveryDurationMinutes) ||
        order.deliveryDurationMinutes! <= 0)
    )
      throw new Error("V2 order delivery duration is invalid");
    const transitioned = await this.prisma.$transaction(async (database) => {
      await lockOrderReview(database, payment.orderId);
      const activeDispute = await database.orderDispute.findFirst({
        where: {
          orderId: payment.orderId,
          status: { in: [...ACTIVE_DISPUTE_STATUSES] },
        },
        select: { id: true, targetRevisionPurchaseId: true },
      });
      const changed = await database.payment.updateMany({
        where: {
          id: payment.id,
          status: { in: ["PENDING", "REQUIRES_ACTION"] },
        },
        data: { status: "PAID", providerPaymentId, paidAt: confirmedAt },
      });
      if (changed.count) {
        const recognizedPayment = await database.payment.findUniqueOrThrow({
          where: { id: payment.id },
          select: {
            id: true,
            amountCentavos: true,
            platformFeeCentavos: true,
            providerNetCentavos: true,
            currency: true,
            paidAt: true,
            order: {
              select: {
                id: true,
                providerId: true,
                pricingModel: true,
                subtotalCentavos: true,
                platformFeeCentavos: true,
                totalCentavos: true,
                currency: true,
              },
            },
          },
        });
        if (!recognizedPayment.paidAt)
          throw new Error("Paid payment is missing its confirmation time");
        const principal = providerEarningPrincipal(
          recognizedPayment.order,
          recognizedPayment,
        );
        const freezeForDispute =
          activeDispute !== null &&
          activeDispute.targetRevisionPurchaseId === null;
        const earning = await database.providerEarning.create({
          data: {
            providerId: recognizedPayment.order.providerId,
            orderId: recognizedPayment.order.id,
            paymentId: recognizedPayment.id,
            currency: principal.currency,
            grossServiceAmountCentavos: principal.amountCentavos,
            status: freezeForDispute ? "FROZEN" : "PENDING",
            pendingAt: recognizedPayment.paidAt,
            ledgerEntries: {
              create: {
                providerId: recognizedPayment.order.providerId,
                orderId: recognizedPayment.order.id,
                sourcePaymentId: recognizedPayment.id,
                type: "EARNING_PENDING_CREDIT",
                amountCentavos: principal.amountCentavos,
                currency: principal.currency,
                sourceKey: pendingEarningCreditSourceKey(recognizedPayment.id),
                createdAt: recognizedPayment.paidAt,
              },
            },
          },
          select: { id: true },
        });
        if (freezeForDispute) {
          await database.disputeAffectedEarning.create({
            data: {
              disputeId: activeDispute.id,
              providerEarningId: earning.id,
              preFreezeStatus: "PENDING",
              frozenAt: recognizedPayment.paidAt,
            },
          });
          await database.providerEarningLedgerEntry.create({
            data: {
              providerEarningId: earning.id,
              providerId: recognizedPayment.order.providerId,
              orderId: recognizedPayment.order.id,
              type: "EARNING_FROZEN",
              amountCentavos: 0,
              currency: principal.currency,
              sourceKey: `earning:${earning.id}:dispute:${activeDispute.id}:frozen`,
              createdAt: recognizedPayment.paidAt,
            },
          });
        }
        if (order.pricingModel === "SINGLE_PRICE_V2") {
          const dueAt = calculateV2Deadline(
            confirmedAt,
            order.deliveryDurationMinutes!,
          );
          const deadline = await database.order.updateMany({
            where: {
              id: payment.orderId,
              pricingModel: "SINGLE_PRICE_V2",
              dueAt: null,
            },
            data: { dueAt },
          });
          if (deadline.count !== 1)
            throw new Error("V2 order deadline was already established");
        }
        await database.notification.createMany({
          data: [order.clientId, order.providerId].map((recipientId) => ({
            recipientId,
            orderId: payment.orderId,
            type: "ORDER_PAYMENT_RECEIVED",
            title: "Order payment confirmed",
            body: `Payment for ${order.titleSnapshot} was confirmed by PayMongo.`,
          })),
        });
      }
      if (webhookEventId)
        await database.paymentWebhookEvent.update({
          where: { id: webhookEventId },
          data: { processedAt: new Date(), processingError: null },
        });
      return changed.count === 1;
    });
    if (transitioned)
      this.realtime?.publishPaymentChanged?.(
        payment.orderId,
        [order.clientId, order.providerId],
        "PAID",
      );
    return transitioned;
  }

  async recordWebhookOnce(
    providerEventId: string,
    eventType: string,
    payload: Prisma.InputJsonValue,
  ) {
    try {
      const event = await this.prisma.paymentWebhookEvent.create({
        data: { providerEventId, eventType, payload },
      });
      return { event, duplicate: false };
    } catch (error: unknown) {
      if ((error as { code?: string }).code !== "P2002") throw error;
      const event = await this.prisma.paymentWebhookEvent.findUniqueOrThrow({
        where: {
          provider_providerEventId: {
            provider: "PAYMONGO",
            providerEventId,
          },
        },
      });
      return { event, duplicate: true };
    }
  }

  private async waitForCheckout(paymentId: string) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const payment = await this.prisma.payment.findUnique({
        where: { id: paymentId },
      });
      if (!payment) throw new NotFoundException("Payment not found");
      if (payment.checkoutUrl)
        return {
          data: this.publicPayment(payment),
          checkoutUrl: payment.checkoutUrl,
        };
      if (payment.status === "FAILED")
        throw new ConflictException(
          "Checkout creation failed. Please try again",
        );
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new ConflictException(
      "Checkout is still being prepared. Please try again shortly",
    );
  }

  private async waitForRevisionCheckout(purchaseId: string) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const purchase = await this.prisma.orderRevisionPurchase.findUnique({
        where: { id: purchaseId },
      });
      if (!purchase) throw new NotFoundException("Revision purchase not found");
      if (purchase.checkoutUrl)
        return {
          data: this.publicRevisionPurchase(purchase),
          checkoutUrl: purchase.checkoutUrl,
        };
      if (purchase.paymentStatus === "FAILED")
        throw new ConflictException(
          "Extra-revision checkout creation failed. Please try again",
        );
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new ConflictException(
      "Extra-revision checkout is still being prepared. Please try again shortly",
    );
  }

  private publicRevisionPurchase(purchase: {
    id: string;
    sourceDeliverySubmissionId: string;
    providerSubtotalCentavos: number;
    platformFeeCentavos: number;
    totalCentavos: number;
    currency: string;
    turnaroundMinutes: number;
    pricingPolicyVersion: number;
    paymentStatus: string;
    activationStatus: string;
    paidAt: Date | null;
    activatedAt: Date | null;
    createdAt: Date;
  }) {
    return {
      id: purchase.id,
      sourceDeliverySubmissionId: purchase.sourceDeliverySubmissionId,
      providerSubtotalCentavos: purchase.providerSubtotalCentavos,
      platformFeeCentavos: purchase.platformFeeCentavos,
      totalCentavos: purchase.totalCentavos,
      currency: purchase.currency,
      turnaroundMinutes: purchase.turnaroundMinutes,
      pricingPolicyVersion: purchase.pricingPolicyVersion,
      paymentStatus: purchase.paymentStatus,
      activationStatus: purchase.activationStatus,
      paidAt: purchase.paidAt,
      activatedAt: purchase.activatedAt,
      createdAt: purchase.createdAt,
    };
  }

  private publicPayment(payment: {
    id: string;
    amountCentavos: number;
    currency: string;
    status: string;
    createdAt: Date;
  }) {
    return {
      id: payment.id,
      amountCentavos: payment.amountCentavos,
      currency: payment.currency,
      status: payment.status,
      createdAt: payment.createdAt,
    };
  }
}

export type PaymongoWebhookPayload = {
  data: {
    id: string;
    type: "event";
    attributes: {
      type: string;
      livemode: boolean;
      data: {
        id: string;
        type: string;
        attributes: {
          amount?: number;
          currency?: string;
          payment_id?: string;
          status?: "pending" | "processing" | "succeeded" | "failed";
          reason?: string;
          created_at?: number;
          updated_at?: number;
          payments?: {
            id: string;
            attributes?: {
              amount?: number;
              currency?: string;
              paid_at?: number;
            };
          }[];
          refunds?: {
            id: string;
            attributes: {
              amount: number;
              reason?: string;
              status: "pending" | "processing" | "succeeded" | "failed";
              created_at?: number;
              updated_at?: number;
            };
          }[];
        };
      };
    };
  };
};
