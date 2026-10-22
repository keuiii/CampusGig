import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  PayoutDestinationType,
  Prisma,
  ProviderEarningStatus,
  ProviderPayoutStatus,
} from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { ACTIVE_DISPUTE_STATUSES } from "../disputes/dispute-status";
import { lockOrderReview } from "../orders/order-review-lock";
import { lockProviderPayout } from "./provider-payout-lock";
import { PayoutDestinationCipherService } from "./payout-destination-cipher.service";
import {
  assertEarningFinancialInvariant,
  isEarningWithdrawable,
  withdrawalHoldMilliseconds,
} from "./provider-payout.policy";

const activeRefundStatuses = [
  "REQUESTED",
  "PENDING",
  "PROCESSING",
  "RECONCILIATION_REQUIRED",
] as const;

const reviewedDestinationStatuses = [
  "ADMIN_REVIEWED",
  "PROVIDER_VERIFIED",
] as const;

@Injectable()
export class ProviderPayoutsService {
  private readonly logger = new Logger(ProviderPayoutsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly destinationCipher: PayoutDestinationCipherService,
  ) {}

  async createDestination(
    providerId: string,
    input: {
      type: PayoutDestinationType;
      displayLabel: string;
      accountIdentifier: string;
      accountHolderName: string;
    },
  ) {
    const normalizedIdentifier = input.accountIdentifier.replace(
      /[^A-Za-z0-9]/g,
      "",
    );
    if (normalizedIdentifier.length < 4)
      throw new BadRequestException(
        "The destination identifier must contain at least four letters or digits",
      );
    const maskedAccountIdentifier = `•••• ${normalizedIdentifier.slice(-4)}`;
    const destination = await this.prisma.providerPayoutDestination.create({
      data: {
        providerId,
        type: input.type,
        displayLabel: input.displayLabel.trim(),
        maskedAccountIdentifier,
        accountHolderName: input.accountHolderName.trim(),
        externalReferenceToken:
          this.destinationCipher.encrypt(normalizedIdentifier),
      },
      select: this.destinationSelect,
    });
    return { data: destination };
  }

  async destinations(providerId: string) {
    return {
      data: await this.prisma.providerPayoutDestination.findMany({
        where: { providerId },
        orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
        select: this.destinationSelect,
      }),
    };
  }

  async deactivateDestination(providerId: string, destinationId: string) {
    const changed = await this.prisma.providerPayoutDestination.updateMany({
      where: { id: destinationId, providerId, isActive: true },
      data: { isActive: false },
    });
    if (!changed.count)
      throw new NotFoundException("Active destination not found");
    return {
      data: await this.prisma.providerPayoutDestination.findUniqueOrThrow({
        where: { id: destinationId },
        select: this.destinationSelect,
      }),
    };
  }

  async request(
    providerId: string,
    input: { destinationId: string; clientRequestId: string; currency: string },
  ) {
    const currency = input.currency.trim().toUpperCase();
    const payoutId = await this.prisma.$transaction(async (database) => {
      await lockProviderPayout(database, providerId);
      const existing = await database.providerPayout.findUnique({
        where: {
          providerId_clientRequestId: {
            providerId,
            clientRequestId: input.clientRequestId,
          },
        },
        select: { id: true },
      });
      if (existing) return existing.id;
      const destination = await database.providerPayoutDestination.findFirst({
        where: {
          id: input.destinationId,
          providerId,
          isActive: true,
          verificationStatus: { in: [...reviewedDestinationStatuses] },
          externalReferenceToken: { not: null },
        },
        select: this.destinationSelect,
      });
      if (!destination)
        throw new ConflictException(
          "Choose an active destination that an administrator has reviewed",
        );
      const now = new Date();
      const earnings = await this.withdrawableEarnings(
        database,
        providerId,
        currency,
        now,
      );
      if (!earnings.length)
        throw new ConflictException(
          "No earnings in this currency are currently withdrawable",
        );
      const principal = earnings.reduce(
        (sum, earning) => sum + earning.grossServiceAmountCentavos,
        0,
      );
      if (!Number.isSafeInteger(principal) || principal <= 0)
        throw new ConflictException("Withdrawable principal is invalid");
      const sourceKey = `provider:${providerId}:payout-request:${input.clientRequestId}`;
      const payout = await database.providerPayout.create({
        data: {
          providerId,
          destinationId: destination.id,
          clientRequestId: input.clientRequestId,
          sourceKey,
          currency,
          requestedPrincipalCentavos: principal,
          eligiblePrincipalCentavos: principal,
          payoutFeeCentavos: 0,
          netDisbursementCentavos: principal,
          destinationSnapshot: {
            type: destination.type,
            displayLabel: destination.displayLabel,
            maskedAccountIdentifier: destination.maskedAccountIdentifier,
            accountHolderName: destination.accountHolderName,
            verificationStatus: destination.verificationStatus,
          },
          items: {
            create: earnings.map((earning) => ({
              providerEarningId: earning.id,
              principalCentavos: earning.grossServiceAmountCentavos,
              currency: earning.currency,
            })),
          },
          audits: {
            create: {
              actorId: providerId,
              action: "REQUESTED",
              context: {
                earningCount: earnings.length,
                principalCentavos: principal,
                payoutFeeCentavos: 0,
                netDisbursementCentavos: principal,
              },
            },
          },
        },
        select: { id: true },
      });
      for (const earning of earnings) {
        const changed = await database.providerEarning.updateMany({
          where: { id: earning.id, status: ProviderEarningStatus.AVAILABLE },
          data: { status: ProviderEarningStatus.PAYOUT_PROCESSING },
        });
        if (changed.count !== 1)
          throw new ConflictException(
            "An earning changed before payout reservation completed",
          );
        await database.providerEarningLedgerEntry.create({
          data: {
            providerEarningId: earning.id,
            providerId,
            orderId: earning.orderId,
            type: "EARNING_PAYOUT_RESERVED",
            amountCentavos: 0,
            currency,
            sourceKey: `earning:${earning.id}:payout:${payout.id}:reserved`,
          },
        });
      }
      await database.notification.create({
        data: {
          recipientId: providerId,
          type: "PROVIDER_PAYOUT_REQUESTED",
          title: "Payout requested",
          body: `Your ${currency} payout request is under administrator review. No money has been sent yet.`,
        },
      });
      return payout.id;
    });
    return { data: await this.detailForProvider(providerId, payoutId) };
  }

  async providerList(providerId: string, limit = 25) {
    return {
      data: await this.prisma.providerPayout.findMany({
        where: { providerId },
        take: limit,
        orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
        select: this.payoutSelect,
      }),
    };
  }

  async cancel(providerId: string, payoutId: string) {
    await this.releaseReservation({
      payoutId,
      actorId: providerId,
      providerId,
      expectedStatus: ProviderPayoutStatus.REQUESTED,
      finalStatus: ProviderPayoutStatus.CANCELLED,
      note: "Provider cancelled the payout before approval",
    });
    return { data: await this.detailForProvider(providerId, payoutId) };
  }

  async adminList(limit = 50) {
    return {
      data: await this.prisma.providerPayout.findMany({
        take: limit,
        orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
        select: this.adminPayoutSelect,
      }),
    };
  }

  async adminDestinations() {
    return {
      data: await this.prisma.providerPayoutDestination.findMany({
        take: 100,
        orderBy: [{ verificationStatus: "asc" }, { createdAt: "asc" }],
        select: {
          ...this.destinationSelect,
          provider: { select: { id: true, displayName: true, email: true } },
        },
      }),
    };
  }

  async reviewDestination(
    adminId: string,
    destinationId: string,
    note: string,
  ) {
    const existing = await this.prisma.providerPayoutDestination.findUnique({
      where: { id: destinationId },
      select: { externalReferenceToken: true },
    });
    if (!existing) throw new NotFoundException("Payout destination not found");
    if (!existing.externalReferenceToken)
      throw new ConflictException(
        "Recreate this payout destination before review because secure transfer details are unavailable",
      );
    const destination = await this.prisma.providerPayoutDestination.update({
      where: { id: destinationId },
      data: {
        verificationStatus: "ADMIN_REVIEWED",
        reviewedById: adminId,
        reviewedAt: new Date(),
        reviewNote: note.trim(),
      },
      select: this.destinationSelect,
    });
    return { data: destination };
  }

  async sensitiveDestinationDetails(adminId: string, destinationId: string) {
    const destination = await this.prisma.providerPayoutDestination.findUnique({
      where: { id: destinationId },
      select: {
        id: true,
        type: true,
        displayLabel: true,
        accountHolderName: true,
        externalReferenceToken: true,
      },
    });
    if (!destination) throw new NotFoundException("Payout destination not found");
    if (!destination.externalReferenceToken)
      throw new ConflictException(
        "Secure transfer details are unavailable; ask the provider to recreate this destination",
      );
    let accountIdentifier: string;
    try {
      accountIdentifier = this.destinationCipher.decrypt(
        destination.externalReferenceToken,
      );
    } catch {
      this.logger.error(
        `Payout destination decryption failed admin=${adminId} destination=${destinationId}`,
      );
      throw new ConflictException(
        "Secure transfer details could not be read; do not process this payout",
      );
    }
    this.logger.warn(
      `Payout destination sensitive details revealed admin=${adminId} destination=${destinationId}`,
    );

    return {
      data: {
        id: destination.id,
        type: destination.type,
        displayLabel: destination.displayLabel,
        accountIdentifier,
        accountHolderName: destination.accountHolderName,
      },
    };
  }

  async approve(adminId: string, payoutId: string, note: string) {
    await this.transitionWithReservation(payoutId, async (database, payout) => {
      if (payout.status === ProviderPayoutStatus.APPROVED) return;
      if (payout.status !== ProviderPayoutStatus.REQUESTED)
        throw new ConflictException("Only a requested payout can be approved");
      if (
        !payout.destination.isActive ||
        !payout.destination.externalReferenceToken ||
        !reviewedDestinationStatuses.includes(
          payout.destination
            .verificationStatus as (typeof reviewedDestinationStatuses)[number],
        )
      )
        throw new ConflictException(
          "The payout destination is no longer eligible",
        );
      try {
        this.destinationCipher.decrypt(
          payout.destination.externalReferenceToken,
        );
      } catch {
        throw new ConflictException(
          "Secure transfer details could not be read; do not approve this payout",
        );
      }
      this.assertReservedPayout(payout);
      await database.providerPayout.update({
        where: { id: payout.id },
        data: {
          status: ProviderPayoutStatus.APPROVED,
          approvedById: adminId,
          approvedAt: new Date(),
        },
      });
      await database.providerPayoutAudit.create({
        data: {
          payoutId: payout.id,
          actorId: adminId,
          action: "APPROVED",
          context: { note: note.trim() },
        },
      });
      await database.notification.create({
        data: {
          recipientId: payout.providerId,
          type: "PROVIDER_PAYOUT_APPROVED",
          title: "Payout approved",
          body: "Your payout was approved. It has not been sent yet.",
        },
      });
    });
    return { data: await this.adminDetail(payoutId) };
  }

  async reject(adminId: string, payoutId: string, note: string) {
    await this.releaseReservation({
      payoutId,
      actorId: adminId,
      expectedStatus: ProviderPayoutStatus.REQUESTED,
      finalStatus: ProviderPayoutStatus.REJECTED,
      note: note.trim(),
    });
    return { data: await this.adminDetail(payoutId) };
  }

  async beginManual(adminId: string, payoutId: string, note: string) {
    await this.transitionWithReservation(payoutId, async (database, payout) => {
      if (
        payout.status === ProviderPayoutStatus.PROCESSING &&
        payout.settlementMethod === "MANUAL"
      )
        return;
      if (payout.status !== ProviderPayoutStatus.APPROVED)
        throw new ConflictException(
          "Only an approved payout can begin manual settlement",
        );
      this.assertReservedPayout(payout);
      const now = new Date();
      await database.providerPayout.update({
        where: { id: payout.id },
        data: {
          status: ProviderPayoutStatus.PROCESSING,
          settlementMethod: "MANUAL",
          processingAt: now,
        },
      });
      await database.providerPayoutAudit.create({
        data: {
          payoutId: payout.id,
          actorId: adminId,
          action: "PROCESSING",
          context: {
            method: "MANUAL",
            note: note.trim(),
            warning: "No automated bank or wallet transfer occurred",
          },
        },
      });
      await database.notification.create({
        data: {
          recipientId: payout.providerId,
          type: "PROVIDER_PAYOUT_PROCESSING",
          title: "Manual payout processing",
          body: "An administrator started manual settlement. This is not confirmation that money was received.",
        },
      });
    });
    return { data: await this.adminDetail(payoutId) };
  }

  async settleManual(
    adminId: string,
    payoutId: string,
    input: {
      amountCentavos: number;
      manualReference: string;
      settledAt: string;
      note: string;
    },
  ) {
    const settlementAt = new Date(input.settledAt);
    const now = new Date();
    if (settlementAt.getTime() > now.getTime() + 5 * 60 * 1000)
      throw new BadRequestException(
        "Settlement timestamp cannot be in the future",
      );
    await this.transitionWithReservation(payoutId, async (database, payout) => {
      if (payout.status === ProviderPayoutStatus.PAID) {
        if (
          payout.manualSettlementReference === input.manualReference.trim() &&
          payout.netDisbursementCentavos === input.amountCentavos
        )
          return;
        throw new ConflictException(
          "This payout was already settled differently",
        );
      }
      if (
        payout.status !== ProviderPayoutStatus.PROCESSING ||
        payout.settlementMethod !== "MANUAL"
      )
        throw new ConflictException(
          "Begin manual settlement before recording payment evidence",
        );
      if (
        input.amountCentavos !== payout.netDisbursementCentavos ||
        settlementAt < payout.requestedAt
      )
        throw new ConflictException(
          "Settlement evidence does not match the immutable payout",
        );
      this.assertReservedPayout(payout);
      for (const item of payout.items) {
        const changed = await database.providerEarning.updateMany({
          where: {
            id: item.providerEarningId,
            status: ProviderEarningStatus.PAYOUT_PROCESSING,
          },
          data: { status: ProviderEarningStatus.PAID_OUT },
        });
        if (changed.count !== 1)
          throw new ConflictException(
            "A reserved earning changed before settlement completed",
          );
        await database.providerEarningLedgerEntry.create({
          data: {
            providerEarningId: item.providerEarningId,
            providerId: payout.providerId,
            orderId: item.providerEarning.orderId,
            type: "EARNING_PAID_OUT",
            amountCentavos: 0,
            currency: payout.currency,
            sourceKey: `earning:${item.providerEarningId}:payout:${payout.id}:paid-out`,
            createdAt: settlementAt,
          },
        });
      }
      await database.providerPayout.update({
        where: { id: payout.id },
        data: {
          status: ProviderPayoutStatus.PAID,
          settledById: adminId,
          manualSettlementReference: input.manualReference.trim(),
          settlementNote: input.note.trim(),
          settlementAt,
          paidAt: settlementAt,
          externalStatus: "manual_settlement_confirmed",
        },
      });
      await database.providerPayoutAudit.create({
        data: {
          payoutId: payout.id,
          actorId: adminId,
          action: "MANUAL_SETTLED",
          context: {
            amountCentavos: input.amountCentavos,
            manualReference: input.manualReference.trim(),
            settlementAt: settlementAt.toISOString(),
            note: input.note.trim(),
          },
          createdAt: settlementAt,
        },
      });
      await database.notification.create({
        data: {
          recipientId: payout.providerId,
          type: "PROVIDER_PAYOUT_PAID",
          title: "Manual payout recorded",
          body: "An administrator recorded evidence of manual settlement for your payout.",
        },
      });
    });
    return { data: await this.adminDetail(payoutId) };
  }

  async adminDetail(payoutId: string) {
    const payout = await this.prisma.providerPayout.findUnique({
      where: { id: payoutId },
      select: this.adminPayoutSelect,
    });
    if (!payout) throw new NotFoundException("Payout not found");
    return payout;
  }

  private async detailForProvider(providerId: string, payoutId: string) {
    const payout = await this.prisma.providerPayout.findFirst({
      where: { id: payoutId, providerId },
      select: this.payoutSelect,
    });
    if (!payout) throw new NotFoundException("Payout not found");
    return payout;
  }

  private async withdrawableEarnings(
    database: Prisma.TransactionClient,
    providerId: string,
    currency: string,
    now: Date,
  ) {
    const cutoff = new Date(now.getTime() - withdrawalHoldMilliseconds);
    const candidateOrders = await database.providerEarning.findMany({
      where: {
        providerId,
        currency,
        status: ProviderEarningStatus.AVAILABLE,
        availableAt: { lte: cutoff },
      },
      select: { orderId: true },
    });
    for (const orderId of Array.from(
      new Set(candidateOrders.map((row) => row.orderId)),
    ).sort())
      await lockOrderReview(database, orderId);
    const rows = await database.providerEarning.findMany({
      where: {
        providerId,
        currency,
        status: ProviderEarningStatus.AVAILABLE,
        availableAt: { lte: cutoff },
        disputeAssociations: {
          none: { dispute: { status: { in: [...ACTIVE_DISPUTE_STATUSES] } } },
        },
        refunds: {
          none: { status: { in: [...activeRefundStatuses] } },
        },
        payoutItems: { none: { reservationActive: true } },
      },
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
      orderBy: [{ availableAt: "asc" }, { id: "asc" }],
    });
    return rows.filter((earning) =>
      isEarningWithdrawable(
        {
          ...earning,
          hasActiveDispute: earning.disputeAssociations.length > 0,
          hasActiveRefund: earning.refunds.length > 0,
          hasActivePayoutReservation: earning.payoutItems.length > 0,
        },
        now,
        currency,
      ),
    );
  }

  private async transitionWithReservation(
    payoutId: string,
    action: (
      database: Prisma.TransactionClient,
      payout: Awaited<ReturnType<ProviderPayoutsService["lockedPayout"]>>,
    ) => Promise<void>,
  ) {
    await this.prisma.$transaction(async (database) => {
      const locator = await database.providerPayout.findUnique({
        where: { id: payoutId },
        select: { providerId: true },
      });
      if (!locator) throw new NotFoundException("Payout not found");
      await lockProviderPayout(database, locator.providerId);
      const orderIds = await database.providerPayoutItem.findMany({
        where: { payoutId },
        select: { providerEarning: { select: { orderId: true } } },
      });
      for (const orderId of Array.from(
        new Set(orderIds.map((item) => item.providerEarning.orderId)),
      ).sort())
        await lockOrderReview(database, orderId);
      const payout = await this.lockedPayout(database, payoutId);
      await action(database, payout);
    });
  }

  private async lockedPayout(
    database: Prisma.TransactionClient,
    payoutId: string,
  ) {
    const payout = await database.providerPayout.findUnique({
      where: { id: payoutId },
      include: {
        destination: true,
        items: {
          include: {
            providerEarning: {
              include: {
                ledgerEntries: {
                  select: { type: true, amountCentavos: true, currency: true },
                },
              },
            },
          },
        },
      },
    });
    if (!payout) throw new NotFoundException("Payout not found");
    return payout;
  }

  private assertReservedPayout(
    payout: Awaited<ReturnType<ProviderPayoutsService["lockedPayout"]>>,
  ) {
    const total = payout.items.reduce(
      (sum, item) => sum + item.principalCentavos,
      0,
    );
    if (
      payout.items.length === 0 ||
      total !== payout.requestedPrincipalCentavos ||
      payout.eligiblePrincipalCentavos !== total ||
      payout.payoutFeeCentavos !== 0 ||
      payout.netDisbursementCentavos !== total ||
      payout.items.some(
        (item) =>
          !item.reservationActive ||
          item.currency !== payout.currency ||
          item.providerEarning.providerId !== payout.providerId ||
          item.providerEarning.status !==
            ProviderEarningStatus.PAYOUT_PROCESSING ||
          item.providerEarning.grossServiceAmountCentavos !==
            item.principalCentavos,
      )
    )
      throw new ConflictException("Payout reservation does not reconcile");
    for (const item of payout.items)
      assertEarningFinancialInvariant({
        ...item.providerEarning,
        hasActiveDispute: false,
        hasActiveRefund: false,
        hasActivePayoutReservation: true,
      });
  }

  private async releaseReservation(input: {
    payoutId: string;
    actorId: string;
    providerId?: string;
    expectedStatus: ProviderPayoutStatus;
    finalStatus: "CANCELLED" | "REJECTED";
    note: string;
  }) {
    await this.transitionWithReservation(
      input.payoutId,
      async (database, payout) => {
        if (input.providerId && payout.providerId !== input.providerId)
          throw new NotFoundException("Payout not found");
        if (payout.status === input.finalStatus) return;
        if (payout.status !== input.expectedStatus)
          throw new ConflictException(
            "This payout can no longer release its reservation",
          );
        this.assertReservedPayout(payout);
        for (const item of payout.items) {
          await database.providerEarning.update({
            where: { id: item.providerEarningId },
            data: { status: ProviderEarningStatus.AVAILABLE },
          });
          await database.providerPayoutItem.update({
            where: { id: item.id },
            data: { reservationActive: false },
          });
          await database.providerEarningLedgerEntry.create({
            data: {
              providerEarningId: item.providerEarningId,
              providerId: payout.providerId,
              orderId: item.providerEarning.orderId,
              type: "EARNING_PAYOUT_RELEASED",
              amountCentavos: 0,
              currency: payout.currency,
              sourceKey: `earning:${item.providerEarningId}:payout:${payout.id}:released`,
            },
          });
        }
        const timestamp = new Date();
        await database.providerPayout.update({
          where: { id: payout.id },
          data:
            input.finalStatus === ProviderPayoutStatus.CANCELLED
              ? { status: input.finalStatus, cancelledAt: timestamp }
              : { status: input.finalStatus, rejectedAt: timestamp },
        });
        await database.providerPayoutAudit.create({
          data: {
            payoutId: payout.id,
            actorId: input.actorId,
            action:
              input.finalStatus === ProviderPayoutStatus.CANCELLED
                ? "CANCELLED"
                : "REJECTED",
            context: { note: input.note },
          },
        });
        await database.notification.create({
          data: {
            recipientId: payout.providerId,
            type:
              input.finalStatus === ProviderPayoutStatus.CANCELLED
                ? "PROVIDER_PAYOUT_CANCELLED"
                : "PROVIDER_PAYOUT_REJECTED",
            title:
              input.finalStatus === ProviderPayoutStatus.CANCELLED
                ? "Payout cancelled"
                : "Payout rejected",
            body: `${input.note}. Reserved earnings are available again with their original eligibility timestamps.`,
          },
        });
      },
    );
  }

  private readonly destinationSelect = {
    id: true,
    type: true,
    displayLabel: true,
    maskedAccountIdentifier: true,
    accountHolderName: true,
    verificationStatus: true,
    reviewedAt: true,
    isActive: true,
    createdAt: true,
    updatedAt: true,
  } satisfies Prisma.ProviderPayoutDestinationSelect;

  private readonly payoutSelect = {
    id: true,
    providerId: true,
    destinationId: true,
    currency: true,
    requestedPrincipalCentavos: true,
    payoutFeeCentavos: true,
    netDisbursementCentavos: true,
    status: true,
    destinationSnapshot: true,
    settlementMethod: true,
    externalStatus: true,
    failureCode: true,
    requestedAt: true,
    approvedAt: true,
    processingAt: true,
    paidAt: true,
    failedAt: true,
    rejectedAt: true,
    cancelledAt: true,
    reconciliationRequiredAt: true,
    items: {
      select: {
        id: true,
        providerEarningId: true,
        principalCentavos: true,
        currency: true,
        reservationActive: true,
      },
    },
  } satisfies Prisma.ProviderPayoutSelect;

  private readonly adminPayoutSelect = {
    ...this.payoutSelect,
    manualSettlementReference: true,
    settlementNote: true,
    settlementAt: true,
    provider: { select: { id: true, displayName: true, email: true } },
    destination: { select: this.destinationSelect },
    audits: {
      orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
      select: {
        id: true,
        action: true,
        context: true,
        createdAt: true,
        actor: { select: { id: true, displayName: true } },
      },
    },
  } satisfies Prisma.ProviderPayoutSelect;
}
