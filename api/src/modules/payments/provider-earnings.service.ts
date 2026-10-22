import {
  Injectable,
  InternalServerErrorException,
  Optional,
} from "@nestjs/common";
import type { ProviderEarningStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import {
  decodeProviderEarningCursor,
  encodeProviderEarningCursor,
} from "./provider-earnings.cursor";
import { OrdersService } from "../orders/orders.service";
import { ACTIVE_DISPUTE_STATUSES } from "../disputes/dispute-status";
import {
  isEarningWithdrawable,
  withdrawalEligibleAt,
} from "./provider-payout.policy";

const activeRefundStatuses = [
  "REQUESTED",
  "PENDING",
  "PROCESSING",
  "RECONCILIATION_REQUIRED",
] as const;

const summaryStatuses = [
  "PENDING",
  "AVAILABLE",
  "FROZEN",
  "PAYOUT_PROCESSING",
  "PAID_OUT",
  "REFUNDED",
] as const satisfies readonly ProviderEarningStatus[];

type SummaryStatus = (typeof summaryStatuses)[number];

@Injectable()
export class ProviderEarningsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly orders?: OrdersService,
  ) {}

  async summary(providerId: string) {
    await this.orders?.reconcileExpiredReviewsForProvider(providerId);
    const now = new Date();
    const grouped = await Promise.all(
      summaryStatuses.map(async (status) => ({
        status,
        rows: await this.prisma.providerEarningLedgerEntry.groupBy({
          by: ["currency"],
          where: {
            providerId,
            type: "EARNING_PENDING_CREDIT",
            providerEarning: { status },
          },
          _sum: { amountCentavos: true },
        }),
      })),
    );
    const currencies = Array.from(
      new Set(grouped.flatMap(({ rows }) => rows.map((row) => row.currency))),
    ).sort();
    const availableEarnings = await this.prisma.providerEarning.findMany({
      where: { providerId, status: "AVAILABLE" },
      include: {
        ledgerEntries: {
          select: { type: true, amountCentavos: true, currency: true },
        },
        disputeAssociations: {
          where: { dispute: { status: { in: [...ACTIVE_DISPUTE_STATUSES] } } },
          select: { id: true },
        },
        refunds: {
          where: { status: { in: [...activeRefundStatuses] } },
          select: { id: true },
        },
        payoutItems: {
          where: { reservationActive: true },
          select: { id: true },
        },
      },
    });
    return {
      data: currencies.map((currency) => {
        const amount = (status: SummaryStatus) =>
          grouped
            .find((bucket) => bucket.status === status)
            ?.rows.find((row) => row.currency === currency)?._sum
            .amountCentavos ?? 0;
        return {
          currency,
          pendingCentavos: amount("PENDING"),
          availableCentavos: amount("AVAILABLE"),
          withdrawableCentavos: availableEarnings
            .filter(
              (earning) =>
                earning.currency === currency &&
                isEarningWithdrawable(
                  {
                    ...earning,
                    hasActiveDispute: earning.disputeAssociations.length > 0,
                    hasActiveRefund: earning.refunds.length > 0,
                    hasActivePayoutReservation: earning.payoutItems.length > 0,
                  },
                  now,
                ),
            )
            .reduce(
              (total, earning) => total + earning.grossServiceAmountCentavos,
              0,
            ),
          frozenCentavos: amount("FROZEN"),
          payoutProcessingCentavos: amount("PAYOUT_PROCESSING"),
          paidOutCentavos: amount("PAID_OUT"),
          refundedCentavos: amount("REFUNDED"),
        };
      }),
    };
  }

  async list(providerId: string, cursor?: string, limit = 20) {
    await this.orders?.reconcileExpiredReviewsForProvider(providerId);
    const decodedCursor = cursor ? decodeProviderEarningCursor(cursor) : null;
    const earnings = await this.prisma.providerEarning.findMany({
      where: decodedCursor
        ? {
            providerId,
            OR: [
              { pendingAt: { lt: decodedCursor.pendingAt } },
              {
                pendingAt: decodedCursor.pendingAt,
                id: { lt: decodedCursor.id },
              },
            ],
          }
        : { providerId },
      select: {
        id: true,
        providerId: true,
        orderId: true,
        currency: true,
        grossServiceAmountCentavos: true,
        sourceType: true,
        status: true,
        pendingAt: true,
        availableAt: true,
        createdAt: true,
        order: {
          select: {
            orderNumber: true,
            titleSnapshot: true,
          },
        },
        revisionPurchase: {
          select: {
            id: true,
            revisionRequest: {
              select: { sequenceNumber: true, type: true },
            },
          },
        },
        ledgerEntries: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            providerId: true,
            orderId: true,
            type: true,
            amountCentavos: true,
            currency: true,
            createdAt: true,
          },
        },
        disputeAssociations: {
          where: { dispute: { status: { in: [...ACTIVE_DISPUTE_STATUSES] } } },
          select: { id: true },
        },
        refunds: {
          where: { status: { in: [...activeRefundStatuses] } },
          select: { id: true },
        },
        payoutItems: {
          where: { reservationActive: true },
          select: { id: true },
        },
      },
      orderBy: [{ pendingAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const hasMore = earnings.length > limit;
    const page = hasMore ? earnings.slice(0, limit) : earnings;
    const data = page.map((earning) => {
      const pendingCredits = earning.ledgerEntries.filter(
        (entry) => entry.type === "EARNING_PENDING_CREDIT",
      );
      const ledgerTotal = pendingCredits.reduce(
        (sum, entry) => sum + entry.amountCentavos,
        0,
      );
      const releaseEvents = earning.ledgerEntries.filter(
        (entry) => entry.type === "EARNING_AVAILABLE_RELEASE",
      );
      const refundReversals = earning.ledgerEntries.filter(
        (entry) => entry.type === "EARNING_REFUND_REVERSAL",
      );
      const payoutReservations = earning.ledgerEntries.filter(
        (entry) => entry.type === "EARNING_PAYOUT_RESERVED",
      );
      const payoutReleases = earning.ledgerEntries.filter(
        (entry) => entry.type === "EARNING_PAYOUT_RELEASED",
      );
      const paidOutEvents = earning.ledgerEntries.filter(
        (entry) => entry.type === "EARNING_PAID_OUT",
      );
      const payoutEvents = [
        ...payoutReservations,
        ...payoutReleases,
        ...paidOutEvents,
      ];
      if (
        pendingCredits.length !== 1 ||
        ledgerTotal !== earning.grossServiceAmountCentavos ||
        pendingCredits.some(
          (entry) =>
            entry.providerId !== earning.providerId ||
            entry.orderId !== earning.orderId ||
            entry.currency !== earning.currency,
        ) ||
        (earning.status === "PENDING" &&
          (earning.availableAt !== null || releaseEvents.length !== 0)) ||
        (earning.status === "AVAILABLE" &&
          (!earning.availableAt ||
            releaseEvents.length !== 1 ||
            releaseEvents[0].amountCentavos !== 0 ||
            releaseEvents[0].currency !== earning.currency)) ||
        (earning.status === "REFUNDED" &&
          (refundReversals.length !== 1 ||
            refundReversals[0].amountCentavos !==
              -earning.grossServiceAmountCentavos ||
            refundReversals[0].currency !== earning.currency)) ||
        (earning.status !== "REFUNDED" && refundReversals.length !== 0) ||
        payoutEvents.some(
          (entry) =>
            entry.amountCentavos !== 0 || entry.currency !== earning.currency,
        ) ||
        (earning.status === "PAYOUT_PROCESSING" &&
          (!earning.availableAt ||
            releaseEvents.length !== 1 ||
            payoutReservations.length !== payoutReleases.length + 1 ||
            paidOutEvents.length !== 0)) ||
        (earning.status === "PAID_OUT" &&
          (!earning.availableAt ||
            releaseEvents.length !== 1 ||
            payoutReservations.length !== payoutReleases.length + 1 ||
            paidOutEvents.length !== 1)) ||
        ((["PENDING", "AVAILABLE", "FROZEN", "REFUNDED"] as string[]).includes(
          earning.status,
        ) &&
          payoutReservations.length !== payoutReleases.length)
      )
        throw new InternalServerErrorException(
          "Provider earnings accounting is inconsistent",
        );
      return {
        id: earning.id,
        orderId: earning.orderId,
        orderNumber: earning.order.orderNumber,
        serviceTitle: earning.order.titleSnapshot,
        sourceType: earning.sourceType,
        revisionSequence:
          earning.revisionPurchase?.revisionRequest?.sequenceNumber ?? null,
        amountCentavos: earning.grossServiceAmountCentavos,
        currency: earning.currency,
        status: earning.status,
        pendingAt: earning.pendingAt,
        availableAt: earning.availableAt,
        withdrawalEligibleAt: withdrawalEligibleAt(earning.availableAt),
        isWithdrawable: isEarningWithdrawable(
          {
            ...earning,
            hasActiveDispute: earning.disputeAssociations.length > 0,
            hasActiveRefund: earning.refunds.length > 0,
            hasActivePayoutReservation: earning.payoutItems.length > 0,
          },
          new Date(),
        ),
        createdAt: earning.createdAt,
        entries: earning.ledgerEntries.map((entry) => ({
          type: entry.type,
          amountCentavos: entry.amountCentavos,
          currency: entry.currency,
          createdAt: entry.createdAt,
        })),
      };
    });
    const last = page.at(-1);
    return {
      data,
      pagination: {
        hasMore,
        nextCursor:
          hasMore && last
            ? encodeProviderEarningCursor({
                pendingAt: last.pendingAt,
                id: last.id,
              })
            : null,
      },
    };
  }
}
