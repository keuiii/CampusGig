import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  MarketplaceRefundReason,
  MarketplaceRefundSource,
  PaymentStatus,
  Prisma,
  ProviderEarningStatus,
  RefundRequestOrigin,
  RefundStatus,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { MessagesGateway } from "../messages/messages.gateway";
import { lockOrderReview } from "../orders/order-review-lock";
import {
  PaymongoClient,
  PaymongoRefund,
  PaymongoRefundError,
} from "./paymongo.client";
import { revisionPendingEarningCreditSourceKey } from "./provider-earnings.policy";

const activeRefundStatuses = [
  RefundStatus.REQUESTED,
  RefundStatus.PENDING,
  RefundStatus.PROCESSING,
  RefundStatus.RECONCILIATION_REQUIRED,
] as const;

type RefundTarget = {
  sourceType: MarketplaceRefundSource;
  sourceId: string;
  orderId: string;
  providerPaymentId: string;
  providerPrincipalCentavos: number;
  platformFeeCentavos: number;
  refundTotalCentavos: number;
  currency: string;
  providerEarningId: string;
  preRefundEarningStatus: ProviderEarningStatus;
  paymentId: string | null;
  revisionPurchaseId: string | null;
};

@Injectable()
export class RefundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymongo: PaymongoClient,
    private readonly realtime?: MessagesGateway,
  ) {}

  async eligibility(userId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        OR: [{ clientId: userId }, { providerId: userId }],
      },
      select: {
        id: true,
        clientId: true,
        status: true,
        startedAt: true,
        dueAt: true,
        pricingModel: true,
        deliveryOption: true,
        deliverySubmissions: { select: { id: true }, take: 1 },
        payments: {
          where: { status: { in: ["PAID", "REFUND_PENDING", "REFUNDED"] } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            amountCentavos: true,
            providerNetCentavos: true,
            platformFeeCentavos: true,
            currency: true,
            status: true,
            refunds: {
              where: {
                sourceKey: { not: null },
                status: { in: [...activeRefundStatuses, "SUCCEEDED"] },
              },
              select: { id: true, status: true, reasonCode: true },
            },
          },
        },
      },
    });
    if (!order) throw new NotFoundException("Order not found");
    const payment = order.payments[0] ?? null;
    const alreadyRequested = Boolean(payment?.refunds.length);
    const paidNotStarted =
      order.clientId === userId &&
      payment?.status === "PAID" &&
      order.status === "ACCEPTED" &&
      order.startedAt === null &&
      order.deliverySubmissions.length === 0 &&
      !alreadyRequested;
    const missedRushDeadline =
      order.clientId === userId &&
      payment?.status === "PAID" &&
      order.pricingModel === "SINGLE_PRICE_V2" &&
      order.deliveryOption !== null &&
      order.deliveryOption !== "NORMAL" &&
      order.dueAt !== null &&
      order.dueAt.getTime() < Date.now() &&
      (["ACCEPTED", "IN_PROGRESS"] as string[]).includes(order.status) &&
      order.deliverySubmissions.length === 0 &&
      !alreadyRequested;
    return {
      data: {
        canRequest: paidNotStarted || missedRushDeadline,
        eligibleReasons: [
          ...(paidNotStarted
            ? [MarketplaceRefundReason.PAID_NOT_STARTED]
            : []),
          ...(missedRushDeadline
            ? [MarketplaceRefundReason.MISSED_RUSH_DEADLINE]
            : []),
        ],
        sourceType: payment ? MarketplaceRefundSource.ORIGINAL_ORDER : null,
        payment: payment
          ? {
              id: payment.id,
              providerPrincipalCentavos: payment.providerNetCentavos,
              platformFeeCentavos: payment.platformFeeCentavos,
              refundTotalCentavos: payment.amountCentavos,
              currency: payment.currency,
              status: payment.status,
            }
          : null,
        refund: payment?.refunds[0] ?? null,
      },
    };
  }

  async requestByClient(
    clientId: string,
    orderId: string,
    reason: MarketplaceRefundReason,
  ) {
    if (
      reason !== MarketplaceRefundReason.PAID_NOT_STARTED &&
      reason !== MarketplaceRefundReason.MISSED_RUSH_DEADLINE
    )
      throw new BadRequestException("This refund reason is not client-requestable");
    const refund = await this.prepareRefund({
      actorId: clientId,
      orderId,
      origin: RefundRequestOrigin.CLIENT,
      reason,
    });
    return this.submitPreparedRefund(refund.id);
  }

  async requestFromDispute(adminId: string, disputeId: string) {
    const dispute = await this.prisma.orderDispute.findUnique({
      where: { id: disputeId },
      select: {
        id: true,
        orderId: true,
        status: true,
        targetRevisionPurchaseId: true,
      },
    });
    if (!dispute) throw new NotFoundException("Dispute not found");
    if (dispute.status !== "RESOLVED_CLIENT")
      throw new ConflictException(
        "A refund requires a final client-favoring dispute resolution",
      );
    const refund = await this.prepareRefund({
      actorId: adminId,
      orderId: dispute.orderId,
      origin: RefundRequestOrigin.ADMIN,
      reason: MarketplaceRefundReason.DISPUTE_CLIENT_WIN,
      disputeId,
      sourceType: dispute.targetRevisionPurchaseId
        ? MarketplaceRefundSource.PAID_EXTRA_REVISION
        : MarketplaceRefundSource.ORIGINAL_ORDER,
      sourceId: dispute.targetRevisionPurchaseId ?? undefined,
    });
    return this.submitPreparedRefund(refund.id);
  }

  async remediateStaleRevision(adminId: string, revisionPurchaseId: string) {
    const purchase = await this.prisma.orderRevisionPurchase.findUnique({
      where: { id: revisionPurchaseId },
      select: { orderId: true },
    });
    if (!purchase) throw new NotFoundException("Revision purchase not found");
    const refund = await this.prepareRefund({
      actorId: adminId,
      orderId: purchase.orderId,
      origin: RefundRequestOrigin.ADMIN,
      reason: MarketplaceRefundReason.STALE_REVISION_PAYMENT,
      sourceType: MarketplaceRefundSource.PAID_EXTRA_REVISION,
      sourceId: revisionPurchaseId,
    });
    return this.submitPreparedRefund(refund.id);
  }

  async requestAdminException(input: {
    adminId: string;
    sourceType: MarketplaceRefundSource;
    sourceId: string;
    policyNote: string;
  }) {
    const orderId =
      input.sourceType === MarketplaceRefundSource.ORIGINAL_ORDER
        ? (
            await this.prisma.payment.findUnique({
              where: { id: input.sourceId },
              select: { orderId: true },
            })
          )?.orderId
        : (
            await this.prisma.orderRevisionPurchase.findUnique({
              where: { id: input.sourceId },
              select: { orderId: true },
            })
          )?.orderId;
    if (!orderId) throw new NotFoundException("Refund source not found");
    const refund = await this.prepareRefund({
      actorId: input.adminId,
      orderId,
      origin: RefundRequestOrigin.ADMIN,
      reason: MarketplaceRefundReason.ADMIN_EXCEPTION,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      policyNote: input.policyNote.trim(),
    });
    return this.submitPreparedRefund(refund.id);
  }

  async reconcile(adminId: string, refundId: string) {
    void adminId;
    const refund = await this.prisma.paymentRefund.findUnique({
      where: { id: refundId },
      select: { id: true, providerRefundId: true, status: true },
    });
    if (!refund) throw new NotFoundException("Refund not found");
    if (refund.status === "SUCCEEDED" || refund.status === "FAILED")
      return { data: await this.detail(refund.id) };
    if (!refund.providerRefundId)
      throw new ConflictException(
        "The provider refund identifier is unknown. Do not retry creation; reconcile this attempt in PayMongo first.",
      );
    const providerRefund = await this.paymongo.retrieveRefund(
      refund.providerRefundId,
    );
    await this.applyProviderRefund(refund.id, providerRefund);
    return { data: await this.detail(refund.id) };
  }

  async adminList(status?: RefundStatus, limit = 25) {
    return {
      data: await this.prisma.paymentRefund.findMany({
        where: { sourceKey: { not: null }, status },
        take: limit,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        select: this.publicSelect,
      }),
    };
  }

  async staleRevisionList() {
    return {
      data: await this.prisma.orderRevisionPurchase.findMany({
        where: {
          paymentStatus: PaymentStatus.PAID,
          activationStatus: "RECONCILIATION_REQUIRED",
          refunds: {
            none: {
              sourceKey: { not: null },
              status: { in: [...activeRefundStatuses, RefundStatus.SUCCEEDED] },
            },
          },
        },
        take: 50,
        orderBy: [{ paidAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          orderId: true,
          providerSubtotalCentavos: true,
          platformFeeCentavos: true,
          totalCentavos: true,
          currency: true,
          paidAt: true,
          failureCode: true,
          order: { select: { orderNumber: true, titleSnapshot: true } },
        },
      }),
    };
  }

  async detail(id: string) {
    const refund = await this.prisma.paymentRefund.findUnique({
      where: { id },
      select: this.publicSelect,
    });
    if (!refund) throw new NotFoundException("Refund not found");
    return refund;
  }

  async applyWebhookRefund(input: {
    providerRefundId: string;
    paymentId: string;
    amountCentavos: number;
    currency?: string;
    reason?: string;
    status: "pending" | "processing" | "succeeded" | "failed";
    createdAt?: Date | null;
    updatedAt?: Date | null;
  }) {
    let refund = await this.prisma.paymentRefund.findUnique({
      where: { providerRefundId: input.providerRefundId },
      select: { id: true },
    });
    if (!refund) {
      const candidates = await this.prisma.paymentRefund.findMany({
        where: {
          providerRefundId: null,
          amountCentavos: input.amountCentavos,
          sourceKey: { not: null },
          status: {
            in: [
              RefundStatus.PROCESSING,
              RefundStatus.RECONCILIATION_REQUIRED,
            ],
          },
          OR: [
            { payment: { providerPaymentId: input.paymentId } },
            { revisionPurchase: { providerPaymentId: input.paymentId } },
          ],
        },
        select: { id: true },
        take: 2,
      });
      if (candidates.length !== 1)
        throw new Error(
          "Provider refund cannot be matched unambiguously to a CampusGig refund request",
        );
      refund = candidates[0];
    }
    await this.applyProviderRefund(refund.id, {
      id: input.providerRefundId,
      paymentId: input.paymentId,
      amountCentavos: input.amountCentavos,
      currency: input.currency?.toUpperCase() ?? "PHP",
      reason: input.reason ?? "others",
      status: input.status,
      createdAt: input.createdAt ?? null,
      updatedAt: input.updatedAt ?? null,
    });
  }

  private async prepareRefund(input: {
    actorId: string;
    orderId: string;
    origin: RefundRequestOrigin;
    reason: MarketplaceRefundReason;
    sourceType?: MarketplaceRefundSource;
    sourceId?: string;
    disputeId?: string;
    policyNote?: string;
  }) {
    return this.prisma.$transaction(async (database) => {
      await lockOrderReview(database, input.orderId);
      const order = await database.order.findUnique({
        where: { id: input.orderId },
        select: {
          id: true,
          clientId: true,
          providerId: true,
          titleSnapshot: true,
          status: true,
          startedAt: true,
          dueAt: true,
          pricingModel: true,
          deliveryOption: true,
          deliverySubmissions: { select: { id: true }, take: 1 },
        },
      });
      if (!order) throw new NotFoundException("Order not found");
      if (input.origin === RefundRequestOrigin.CLIENT && order.clientId !== input.actorId)
        throw new ForbiddenException("Only the client can request this refund");

      if (input.reason === MarketplaceRefundReason.PAID_NOT_STARTED) {
        if (
          order.status !== "ACCEPTED" ||
          order.startedAt !== null ||
          order.deliverySubmissions.length > 0
        )
          throw new ConflictException(
            "This order is no longer eligible for a paid-not-started refund",
          );
      } else if (input.reason === MarketplaceRefundReason.MISSED_RUSH_DEADLINE) {
        if (
          order.pricingModel !== "SINGLE_PRICE_V2" ||
          order.deliveryOption === null ||
          order.deliveryOption === "NORMAL" ||
          !order.dueAt ||
          order.dueAt.getTime() >= Date.now() ||
          !(["ACCEPTED", "IN_PROGRESS"] as string[]).includes(order.status) ||
          order.deliverySubmissions.length > 0
        )
          throw new ConflictException(
            "The rush deadline has not been missed or delivery has already occurred",
          );
      } else if (input.reason === MarketplaceRefundReason.ADMIN_EXCEPTION) {
        if (
          input.origin !== RefundRequestOrigin.ADMIN ||
          !input.policyNote ||
          input.policyNote.length < 20 ||
          order.status === "COMPLETED" ||
          order.deliverySubmissions.length > 0
        )
          throw new ConflictException(
            "Admin exceptions require a documented policy basis before delivery or completion",
          );
      }

      const sourceType =
        input.sourceType ?? MarketplaceRefundSource.ORIGINAL_ORDER;
      const existing = await database.paymentRefund.findFirst({
        where: {
          orderId: order.id,
          sourceType,
          reasonCode: input.reason,
          sourceKey: { not: null },
          ...(sourceType === MarketplaceRefundSource.ORIGINAL_ORDER
            ? input.sourceId
              ? { paymentId: input.sourceId }
              : { paymentId: { not: null } }
            : { revisionPurchaseId: input.sourceId }),
        },
        orderBy: { createdAt: "desc" },
      });
      if (existing) return existing;
      const target = await this.resolveTarget(database, {
        orderId: order.id,
        sourceType,
        sourceId: input.sourceId,
        reason: input.reason,
      });
      const sourceKey = `refund:${sourceType}:${target.sourceId}:${input.reason}`;
      const blocking = await database.paymentRefund.findFirst({
        where: {
          OR: [
            ...(target.paymentId ? [{ paymentId: target.paymentId }] : []),
            ...(target.revisionPurchaseId
              ? [{ revisionPurchaseId: target.revisionPurchaseId }]
              : []),
          ],
          sourceKey: { not: null },
          status: { in: [...activeRefundStatuses, RefundStatus.SUCCEEDED] },
        },
      });
      if (blocking)
        throw new ConflictException(
          "This economic purchase already has an active or completed full refund",
        );
      if (
        target.preRefundEarningStatus === ProviderEarningStatus.PAID_OUT ||
        target.preRefundEarningStatus === ProviderEarningStatus.PAYOUT_PROCESSING ||
        target.preRefundEarningStatus === ProviderEarningStatus.REFUNDED
      )
        throw new ConflictException(
          "This earning cannot be refunded without payout-aware recovery",
        );
      if (target.preRefundEarningStatus !== ProviderEarningStatus.FROZEN) {
        await database.providerEarning.update({
          where: { id: target.providerEarningId },
          data: { status: ProviderEarningStatus.FROZEN },
        });
        await database.providerEarningLedgerEntry.create({
          data: {
            providerEarningId: target.providerEarningId,
            providerId: order.providerId,
            orderId: order.id,
            type: "EARNING_FROZEN",
            amountCentavos: 0,
            currency: target.currency,
            sourceKey: `earning:${target.providerEarningId}:refund:${sourceKey}:frozen`,
          },
        });
      }
      if (target.paymentId)
        await database.payment.update({
          where: { id: target.paymentId },
          data: { status: PaymentStatus.REFUND_PENDING },
        });
      else
        await database.orderRevisionPurchase.update({
          where: { id: target.revisionPurchaseId! },
          data: { paymentStatus: PaymentStatus.REFUND_PENDING },
        });
      if (
        input.origin === RefundRequestOrigin.CLIENT &&
        (["ACCEPTED", "IN_PROGRESS"] as string[]).includes(order.status)
      ) {
        await database.order.update({
          where: { id: order.id },
          data: { status: "CANCELLED" },
        });
        await database.orderStatusHistory.create({
          data: {
            orderId: order.id,
            fromStatus: order.status,
            toStatus: "CANCELLED",
            changedBy: input.actorId,
            note: `Full refund requested: ${input.reason}`,
          },
        });
      }
      const created = await database.paymentRefund.create({
        data: {
          orderId: order.id,
          paymentId: target.paymentId,
          revisionPurchaseId: target.revisionPurchaseId,
          providerEarningId: target.providerEarningId,
          triggeringDisputeId: input.disputeId,
          requestedById: input.actorId,
          sourceType,
          reasonCode: input.reason,
          requestOrigin: input.origin,
          preRefundEarningStatus: target.preRefundEarningStatus,
          sourceKey,
          idempotencyKey: `refund:${randomUUID()}`,
          providerPrincipalCentavos: target.providerPrincipalCentavos,
          platformFeeCentavos: target.platformFeeCentavos,
          refundTotalCentavos: target.refundTotalCentavos,
          amountCentavos: target.refundTotalCentavos,
          currency: target.currency,
          reason: input.policyNote
            ? `${input.reason}: ${input.policyNote}`
            : input.reason,
        },
      });
      await database.notification.createMany({
        data: [
          {
            recipientId: order.clientId,
            orderId: order.id,
            type: "ORDER_REFUND_REQUESTED",
            title: "Full refund requested",
            body: `Your full refund request for ${order.titleSnapshot} is being processed.`,
          },
          {
            recipientId: order.providerId,
            orderId: order.id,
            type: "ORDER_REFUND_REQUESTED",
            title: "Earning frozen for refund",
            body: `The affected earning for ${order.titleSnapshot} is frozen while a full refund is processed.`,
          },
        ],
      });
      return created;
    });
  }

  private async resolveTarget(
    database: Prisma.TransactionClient,
    input: {
      orderId: string;
      sourceType: MarketplaceRefundSource;
      sourceId?: string;
      reason: MarketplaceRefundReason;
    },
  ): Promise<RefundTarget> {
    if (input.sourceType === MarketplaceRefundSource.ORIGINAL_ORDER) {
      const payment = await database.payment.findFirst({
        where: {
          orderId: input.orderId,
          ...(input.sourceId ? { id: input.sourceId } : {}),
          status: PaymentStatus.PAID,
        },
        orderBy: { paidAt: "desc" },
        include: { providerEarning: true },
      });
      if (!payment?.providerPaymentId || !payment.providerEarning)
        throw new ConflictException(
          "A confirmed payment with recognized provider earnings is required",
        );
      return {
        sourceType: input.sourceType,
        sourceId: payment.id,
        orderId: input.orderId,
        providerPaymentId: payment.providerPaymentId,
        providerPrincipalCentavos: payment.providerNetCentavos,
        platformFeeCentavos: payment.platformFeeCentavos,
        refundTotalCentavos: payment.amountCentavos,
        currency: payment.currency,
        providerEarningId: payment.providerEarning.id,
        preRefundEarningStatus: payment.providerEarning.status,
        paymentId: payment.id,
        revisionPurchaseId: null,
      };
    }
    if (!input.sourceId)
      throw new BadRequestException("A revision purchase is required");
    let purchase = await database.orderRevisionPurchase.findFirst({
      where: {
        id: input.sourceId,
        orderId: input.orderId,
        paymentStatus: PaymentStatus.PAID,
      },
      include: { providerEarning: true },
    });
    if (!purchase?.providerPaymentId)
      throw new ConflictException("A confirmed revision payment is required");
    const providerPaymentId = purchase.providerPaymentId;
    if (
      input.reason === MarketplaceRefundReason.STALE_REVISION_PAYMENT &&
      purchase.activationStatus !== "RECONCILIATION_REQUIRED"
    )
      throw new ConflictException(
        "Only a stale paid revision can use this remediation path",
      );
    let providerEarning = purchase.providerEarning;
    if (!providerEarning) {
      if (input.reason !== MarketplaceRefundReason.STALE_REVISION_PAYMENT)
        throw new ConflictException("Revision earning recognition is missing");
      const earning = await database.providerEarning.create({
        data: {
          providerId: purchase.providerId,
          orderId: purchase.orderId,
          revisionPurchaseId: purchase.id,
          sourceType: "PAID_EXTRA_REVISION",
          currency: purchase.currency,
          grossServiceAmountCentavos: purchase.providerSubtotalCentavos,
          status: "FROZEN",
          pendingAt: purchase.paidAt ?? new Date(),
          ledgerEntries: {
            create: {
              providerId: purchase.providerId,
              orderId: purchase.orderId,
              sourceRevisionPurchaseId: purchase.id,
              type: "EARNING_PENDING_CREDIT",
              amountCentavos: purchase.providerSubtotalCentavos,
              currency: purchase.currency,
              sourceKey: revisionPendingEarningCreditSourceKey(purchase.id),
              createdAt: purchase.paidAt ?? new Date(),
            },
          },
        },
      });
      providerEarning = earning;
    }
    return {
      sourceType: input.sourceType,
      sourceId: purchase.id,
      orderId: purchase.orderId,
      providerPaymentId,
      providerPrincipalCentavos: purchase.providerSubtotalCentavos,
      platformFeeCentavos: purchase.platformFeeCentavos,
      refundTotalCentavos: purchase.totalCentavos,
      currency: purchase.currency,
      providerEarningId: providerEarning.id,
      preRefundEarningStatus: providerEarning.status,
      paymentId: null,
      revisionPurchaseId: purchase.id,
    };
  }

  private async submitPreparedRefund(refundId: string) {
    const claimed = await this.prisma.paymentRefund.updateMany({
      where: { id: refundId, status: RefundStatus.REQUESTED },
      data: { status: RefundStatus.PROCESSING },
    });
    if (!claimed.count) return { data: await this.detail(refundId) };
    const refund = await this.prisma.paymentRefund.findUniqueOrThrow({
      where: { id: refundId },
      include: { payment: true, revisionPurchase: true },
    });
    const providerPaymentId =
      refund.payment?.providerPaymentId ??
      refund.revisionPurchase?.providerPaymentId;
    if (!providerPaymentId || !refund.refundTotalCentavos)
      throw new ConflictException("Refund source evidence is incomplete");
    try {
      const providerRefund = await this.paymongo.createRefund({
        amountCentavos: refund.refundTotalCentavos,
        paymentId: providerPaymentId,
        idempotencyKey: refund.idempotencyKey,
        notes: `CampusGig ${refund.reasonCode} ${refund.id}`,
      });
      await this.applyProviderRefund(refund.id, providerRefund);
    } catch (error) {
      const definitive =
        error instanceof PaymongoRefundError && error.outcome === "REJECTED";
      await this.markSubmissionFailure(
        refund.id,
        definitive ? RefundStatus.FAILED : RefundStatus.RECONCILIATION_REQUIRED,
        error instanceof PaymongoRefundError
          ? error.code ?? error.message
          : "refund_submission_unknown",
      );
      throw error;
    }
    return { data: await this.detail(refund.id) };
  }

  private async applyProviderRefund(
    refundId: string,
    providerRefund: PaymongoRefund,
  ) {
    const result = await this.prisma.$transaction(async (database) => {
      const locator = await database.paymentRefund.findUnique({
        where: { id: refundId },
        select: { orderId: true },
      });
      if (!locator?.orderId)
        throw new Error("Refund accounting evidence is incomplete");
      await lockOrderReview(database, locator.orderId);
      const snapshot = await database.paymentRefund.findUnique({
        where: { id: refundId },
        include: {
          payment: true,
          revisionPurchase: true,
          providerEarning: true,
          order: {
            select: {
              id: true,
              clientId: true,
              providerId: true,
              titleSnapshot: true,
            },
          },
        },
      });
      if (!snapshot?.order || !snapshot.providerEarning)
        throw new Error("Refund accounting evidence is incomplete");
      const expectedPaymentId =
        snapshot.payment?.providerPaymentId ??
        snapshot.revisionPurchase?.providerPaymentId;
      if (
        providerRefund.paymentId !== expectedPaymentId ||
        providerRefund.amountCentavos !== snapshot.refundTotalCentavos ||
        providerRefund.currency !== snapshot.currency
      ) {
        await database.paymentRefund.update({
          where: { id: snapshot.id },
          data: {
            providerRefundId: providerRefund.id,
            providerStatus: providerRefund.status,
            status: RefundStatus.RECONCILIATION_REQUIRED,
            reconciliationRequiredAt: new Date(),
            failureCode: "provider_refund_mismatch",
          },
        });
        return { order: snapshot.order, status: "RECONCILIATION_REQUIRED" };
      }
      const status = this.localStatus(providerRefund.status);
      if (snapshot.status === RefundStatus.SUCCEEDED) {
        if (status !== RefundStatus.SUCCEEDED)
          throw new Error("A succeeded refund cannot regress");
        return { order: snapshot.order, status: snapshot.status };
      }
      if (snapshot.status === RefundStatus.FAILED) {
        if (status !== RefundStatus.FAILED)
          throw new Error("A failed refund cannot change without a new request");
        return { order: snapshot.order, status: snapshot.status };
      }
      if (status === RefundStatus.SUCCEEDED) {
        await database.providerEarningLedgerEntry.create({
          data: {
            providerEarningId: snapshot.providerEarning.id,
            providerId: snapshot.order.providerId,
            orderId: snapshot.orderId!,
            type: "EARNING_REFUND_REVERSAL",
            amountCentavos: -snapshot.providerPrincipalCentavos!,
            currency: snapshot.currency!,
            sourceKey: `earning:${snapshot.providerEarning.id}:refund:${snapshot.id}:reversal`,
          },
        });
        await database.providerEarning.update({
          where: { id: snapshot.providerEarning.id },
          data: { status: ProviderEarningStatus.REFUNDED },
        });
        await database.platformFeeLedgerEntry.create({
          data: {
            orderId: snapshot.orderId!,
            refundId: snapshot.id,
            type: "REFUND_REVERSAL",
            amountCentavos: -snapshot.platformFeeCentavos!,
            currency: snapshot.currency!,
            sourceKey: `platform-fee:refund:${snapshot.id}:reversal`,
          },
        });
        if (snapshot.paymentId)
          await database.payment.update({
            where: { id: snapshot.paymentId },
            data: {
              status: PaymentStatus.REFUNDED,
              refundedCentavos: snapshot.refundTotalCentavos!,
            },
          });
        else
          await database.orderRevisionPurchase.update({
            where: { id: snapshot.revisionPurchaseId! },
            data: {
              paymentStatus: PaymentStatus.REFUNDED,
              activationStatus: "REFUNDED",
              refundedCentavos: snapshot.refundTotalCentavos!,
            },
          });
        await database.notification.createMany({
          data: [snapshot.order.clientId, snapshot.order.providerId].map(
            (recipientId) => ({
              recipientId,
              orderId: snapshot.orderId!,
              type: "ORDER_REFUND_SUCCEEDED",
              title: "Full refund completed",
              body: `PayMongo confirmed the full refund for ${snapshot.order!.titleSnapshot}.`,
            }),
          ),
        });
      } else if (status === RefundStatus.FAILED) {
        if (snapshot.paymentId)
          await database.payment.update({
            where: { id: snapshot.paymentId },
            data: { status: PaymentStatus.PAID },
          });
        else
          await database.orderRevisionPurchase.update({
            where: { id: snapshot.revisionPurchaseId! },
            data: { paymentStatus: PaymentStatus.PAID },
          });
        if (snapshot.preRefundEarningStatus !== ProviderEarningStatus.FROZEN) {
          await database.providerEarning.update({
            where: { id: snapshot.providerEarning.id },
            data: { status: snapshot.preRefundEarningStatus! },
          });
          await database.providerEarningLedgerEntry.create({
            data: {
              providerEarningId: snapshot.providerEarning.id,
              providerId: snapshot.order.providerId,
              orderId: snapshot.orderId!,
              type: "EARNING_UNFROZEN",
              amountCentavos: 0,
              currency: snapshot.currency!,
              sourceKey: `earning:${snapshot.providerEarning.id}:refund:${snapshot.id}:failed-unfreeze`,
            },
          });
        }
        await database.notification.create({
          data: {
            recipientId: snapshot.order.clientId,
            orderId: snapshot.orderId!,
            type: "ORDER_REFUND_FAILED",
            title: "Full refund needs attention",
            body: `PayMongo could not complete the full refund for ${snapshot.order.titleSnapshot}. CampusGig support can review the failed request.`,
          },
        });
      }
      await database.paymentRefund.update({
        where: { id: snapshot.id },
        data: {
          providerRefundId: providerRefund.id,
          providerStatus: providerRefund.status,
          status,
          submittedAt: snapshot.submittedAt ?? new Date(),
          processedAt: status === RefundStatus.SUCCEEDED ? new Date() : null,
          reconciliationRequiredAt: null,
          failureCode: status === RefundStatus.FAILED ? "provider_failed" : null,
          accountingReversedAt:
            status === RefundStatus.SUCCEEDED ? new Date() : null,
          providerPrincipalReversedCentavos:
            status === RefundStatus.SUCCEEDED
              ? snapshot.providerPrincipalCentavos!
              : 0,
          platformFeeReversedCentavos:
            status === RefundStatus.SUCCEEDED ? snapshot.platformFeeCentavos! : 0,
          providerCreatedAt: providerRefund.createdAt,
          providerUpdatedAt: providerRefund.updatedAt,
        },
      });
      return { order: snapshot.order, status };
    });
    this.realtime?.publishPaymentChanged?.(
      result.order.id,
      [result.order.clientId, result.order.providerId],
      result.status,
    );
  }

  private async markSubmissionFailure(
    refundId: string,
    status: RefundStatus,
    failureCode: string,
  ) {
    await this.prisma.$transaction(async (database) => {
      const locator = await database.paymentRefund.findUniqueOrThrow({
        where: { id: refundId },
        select: { orderId: true },
      });
      if (!locator.orderId)
        throw new Error("Refund accounting evidence is incomplete");
      await lockOrderReview(database, locator.orderId);
      const refund = await database.paymentRefund.findUniqueOrThrow({
        where: { id: refundId },
        include: {
          providerEarning: true,
          order: { select: { clientId: true, titleSnapshot: true } },
        },
      });
      await database.paymentRefund.update({
        where: { id: refund.id },
        data: {
          status,
          failureCode: failureCode.slice(0, 500),
          reconciliationRequiredAt:
            status === RefundStatus.RECONCILIATION_REQUIRED ? new Date() : null,
        },
      });
      if (status === RefundStatus.FAILED) {
        if (refund.paymentId)
          await database.payment.update({
            where: { id: refund.paymentId },
            data: { status: PaymentStatus.PAID },
          });
        else
          await database.orderRevisionPurchase.update({
            where: { id: refund.revisionPurchaseId! },
            data: { paymentStatus: PaymentStatus.PAID },
          });
        if (
          refund.providerEarning &&
          refund.preRefundEarningStatus !== ProviderEarningStatus.FROZEN
        ) {
          await database.providerEarning.update({
            where: { id: refund.providerEarning.id },
            data: { status: refund.preRefundEarningStatus! },
          });
          await database.providerEarningLedgerEntry.create({
            data: {
              providerEarningId: refund.providerEarning.id,
              providerId: refund.providerEarning.providerId,
              orderId: refund.providerEarning.orderId,
              type: "EARNING_UNFROZEN",
              amountCentavos: 0,
              currency: refund.providerEarning.currency,
              sourceKey: `earning:${refund.providerEarning.id}:refund:${refund.id}:failed-unfreeze`,
            },
          });
        }
        if (refund.order)
          await database.notification.create({
            data: {
              recipientId: refund.order.clientId,
              orderId: refund.orderId!,
              type: "ORDER_REFUND_FAILED",
              title: "Full refund needs attention",
              body: `PayMongo could not accept the full refund for ${refund.order.titleSnapshot}. CampusGig support can review the failed request.`,
            },
          });
      }
    });
  }

  private localStatus(status: PaymongoRefund["status"]): RefundStatus {
    if (status === "succeeded") return RefundStatus.SUCCEEDED;
    if (status === "failed") return RefundStatus.FAILED;
    if (status === "processing") return RefundStatus.PROCESSING;
    return RefundStatus.PENDING;
  }

  private readonly publicSelect = {
    id: true,
    orderId: true,
    paymentId: true,
    revisionPurchaseId: true,
    triggeringDisputeId: true,
    sourceType: true,
    reasonCode: true,
    requestOrigin: true,
    providerRefundId: true,
    providerPrincipalCentavos: true,
    platformFeeCentavos: true,
    refundTotalCentavos: true,
    currency: true,
    status: true,
    providerStatus: true,
    failureCode: true,
    requestedAt: true,
    submittedAt: true,
    processedAt: true,
    reconciliationRequiredAt: true,
    accountingReversedAt: true,
    providerPrincipalReversedCentavos: true,
    platformFeeReversedCentavos: true,
    createdAt: true,
    updatedAt: true,
    order: { select: { orderNumber: true, titleSnapshot: true } },
  } satisfies Prisma.PaymentRefundSelect;
}
