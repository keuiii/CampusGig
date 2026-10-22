import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  DisputeReason,
  DisputeResponseParty,
  DisputeStatus,
  Prisma,
  ProviderEarningStatus,
} from "@prisma/client";
import {
  decodeDateCursor,
  encodeDateCursor,
} from "../../common/cursor-pagination";
import { StorageService } from "../../common/storage/storage.service";
import { PrismaService } from "../../prisma/prisma.service";
import { lockOrderReview } from "../orders/order-review-lock";
import {
  ACTIVE_DISPUTE_STATUSES,
  isActiveDisputeStatus,
} from "./dispute-status";
import {
  affectedEarningForTarget,
  canOpenAfterExplicitAcceptance,
  remainingReviewSeconds,
  responseDeadline,
  resumedReviewDeadline,
  waitingStatus,
} from "./dispute-policy";
const disputableOrderStatuses = new Set([
  "ACCEPTED",
  "IN_PROGRESS",
  "SUBMITTED",
  "REVISION_REQUESTED",
  "COMPLETED",
]);
const resolutionStatuses = new Set<DisputeStatus>([
  DisputeStatus.RESOLVED_CLIENT,
  DisputeStatus.RESOLVED_PROVIDER,
  DisputeStatus.CLOSED,
]);

type StoredEvidence = {
  storagePath: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
};

@Injectable()
export class DisputesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async forOrder(userId: string, orderId: string) {
    await this.requireParticipant(userId, orderId);
    await this.reconcileExpiredResponsesForOrder(orderId);
    return {
      data: await this.prisma.orderDispute.findFirst({
        where: { orderId },
        include: this.participantInclude,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
    };
  }

  async open(
    userId: string,
    orderId: string,
    reason: DisputeReason,
    detailsInput: string,
    files: Express.Multer.File[] = [],
  ) {
    await this.requireParticipant(userId, orderId);
    const evidence = await this.persistEvidence(files);
    const now = new Date();
    try {
      const disputeId = await this.prisma.$transaction(async (database) => {
        await lockOrderReview(database, orderId);
        const order = await database.order.findFirst({
          where: {
            id: orderId,
            OR: [{ clientId: userId }, { providerId: userId }],
          },
          select: {
            id: true,
            clientId: true,
            providerId: true,
            status: true,
            completionSource: true,
            titleSnapshot: true,
            reviewDeadlineAt: true,
            disputes: {
              where: { status: { in: [...ACTIVE_DISPUTE_STATUSES] } },
              select: { id: true },
            },
            reviewDeliverySubmission: {
              select: {
                id: true,
                revisionRequest: {
                  select: {
                    id: true,
                    type: true,
                    purchase: { select: { id: true } },
                  },
                },
              },
            },
            deliverySubmissions: {
              orderBy: [{ version: "desc" }, { id: "desc" }],
              take: 1,
              select: {
                id: true,
                revisionRequest: {
                  select: {
                    id: true,
                    type: true,
                    purchase: { select: { id: true } },
                  },
                },
              },
            },
            revisions: {
              where: {
                status: { in: ["OPEN", "AWAITING_PROVIDER_ACKNOWLEDGEMENT"] },
              },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              take: 1,
              select: {
                id: true,
                type: true,
                sourceDeliverySubmissionId: true,
                purchase: { select: { id: true } },
              },
            },
            providerEarnings: {
              select: {
                id: true,
                providerId: true,
                orderId: true,
                sourceType: true,
                revisionPurchaseId: true,
                status: true,
                currency: true,
              },
            },
          },
        });
        if (!order) throw new NotFoundException("Order not found");
        if (!disputableOrderStatuses.has(order.status))
          throw new ConflictException(
            "A dispute can only be opened after a request is accepted",
          );
        if (order.disputes.length)
          throw new ConflictException(
            "This order already has an active dispute",
          );
        if (
          order.status === "COMPLETED" &&
          order.completionSource === "CLIENT_ACCEPTED" &&
          !canOpenAfterExplicitAcceptance(reason)
        )
          throw new ConflictException(
            "After explicit acceptance, only payment or conduct escalations can be reviewed",
          );

        const activeRevision =
          order.status === "REVISION_REQUESTED" ? order.revisions[0] : null;
        const targetDeliveryId = activeRevision
          ? activeRevision.sourceDeliverySubmissionId
          : (order.reviewDeliverySubmission?.id ??
            order.deliverySubmissions[0]?.id ??
            null);
        const targetRevision =
          activeRevision ??
          order.reviewDeliverySubmission?.revisionRequest ??
          order.deliverySubmissions[0]?.revisionRequest ??
          null;
        const targetRevisionPurchaseId = targetRevision?.purchase?.id ?? null;
        const affectedEarning = affectedEarningForTarget(
          order.providerEarnings,
          targetRevisionPurchaseId,
        );
        if (targetRevisionPurchaseId && !affectedEarning)
          throw new ConflictException(
            "The paid revision earning cannot be identified safely",
          );
        if (
          affectedEarning &&
          affectedEarning.status !== ProviderEarningStatus.PENDING &&
          affectedEarning.status !== ProviderEarningStatus.AVAILABLE
        )
          throw new ConflictException(
            "The affected earning cannot enter a dispute freeze from its current state",
          );

        const requestedFrom =
          order.clientId === userId
            ? DisputeResponseParty.PROVIDER
            : DisputeResponseParty.CLIENT;
        const responseDeadlineAt = responseDeadline(now);
        const reviewRemainingSeconds =
          order.status === "SUBMITTED" && order.reviewDeadlineAt
            ? remainingReviewSeconds(order.reviewDeadlineAt, now)
            : null;
        const created = await database.orderDispute.create({
          data: {
            orderId,
            openedById: userId,
            reason,
            details: detailsInput.trim(),
            status: waitingStatus(requestedFrom),
            targetDeliverySubmissionId: targetDeliveryId,
            targetRevisionRequestId: targetRevision?.id ?? null,
            targetRevisionPurchaseId,
            responseRequestedFrom: requestedFrom,
            responseRequestedAt: now,
            responseDeadlineAt,
            responseRequestSequence: 1,
            reviewPausedAt: reviewRemainingSeconds === null ? null : now,
            reviewRemainingSeconds,
          },
          select: { id: true },
        });

        if (affectedEarning) {
          const preFreezeStatus = affectedEarning.status;
          const changed = await database.providerEarning.updateMany({
            where: { id: affectedEarning.id, status: preFreezeStatus },
            data: { status: ProviderEarningStatus.FROZEN },
          });
          if (changed.count !== 1)
            throw new ConflictException(
              "The affected earning changed before it could be frozen",
            );
          await database.disputeAffectedEarning.create({
            data: {
              disputeId: created.id,
              providerEarningId: affectedEarning.id,
              preFreezeStatus,
              frozenAt: now,
            },
          });
          await database.providerEarningLedgerEntry.create({
            data: {
              providerEarningId: affectedEarning.id,
              providerId: affectedEarning.providerId,
              orderId: affectedEarning.orderId,
              type: "EARNING_FROZEN",
              amountCentavos: 0,
              currency: affectedEarning.currency,
              sourceKey: `earning:${affectedEarning.id}:dispute:${created.id}:frozen`,
            },
          });
        }
        await this.createEvidenceRecords(
          database,
          created.id,
          userId,
          evidence,
          null,
        );
        await database.disputeTimelineEvent.createMany({
          data: [
            {
              disputeId: created.id,
              actorId: userId,
              type: "OPENED",
              details: "Dispute opened and normal completion paused.",
              createdAt: now,
            },
            {
              disputeId: created.id,
              actorId: userId,
              type: "RESPONSE_REQUESTED",
              details: `${requestedFrom} response requested within 48 hours.`,
              createdAt: now,
            },
            ...(evidence.length
              ? [
                  {
                    disputeId: created.id,
                    actorId: userId,
                    type: "EVIDENCE_ADDED" as const,
                    details: `${evidence.length} evidence file(s) added.`,
                    createdAt: now,
                  },
                ]
              : []),
          ],
        });
        const recipientId =
          order.clientId === userId ? order.providerId : order.clientId;
        await database.notification.create({
          data: {
            orderId,
            recipientId,
            type: "ORDER_DISPUTE_OPENED",
            title: "A dispute was opened",
            body: `A dispute was opened for ${order.titleSnapshot}. Your response is requested within 48 hours.`,
          },
        });
        return created.id;
      });
      return {
        data: await this.findParticipantDispute(disputeId),
        message:
          "Dispute opened. Completion is paused and the affected earning is frozen where applicable.",
      };
    } catch (error: unknown) {
      await this.deleteEvidence(evidence);
      if ((error as { code?: string }).code === "P2002")
        throw new ConflictException("This order already has an active dispute");
      throw error;
    }
  }

  async submitResponse(
    userId: string,
    orderId: string,
    disputeId: string,
    detailsInput: string,
    files: Express.Multer.File[] = [],
  ) {
    await this.requireParticipant(userId, orderId);
    await this.reconcileExpiredResponse(disputeId);
    const evidence = await this.persistEvidence(files);
    const now = new Date();
    try {
      await this.prisma.$transaction(async (database) => {
        await lockOrderReview(database, orderId);
        const dispute = await database.orderDispute.findFirst({
          where: { id: disputeId, orderId },
          include: {
            order: {
              select: {
                clientId: true,
                providerId: true,
                titleSnapshot: true,
              },
            },
          },
        });
        if (!dispute) throw new NotFoundException("Dispute not found");
        if (
          dispute.status !== DisputeStatus.WAITING_FOR_CLIENT &&
          dispute.status !== DisputeStatus.WAITING_FOR_PROVIDER
        )
          throw new ConflictException(
            "This dispute is not awaiting a response",
          );
        const expectedUserId =
          dispute.responseRequestedFrom === DisputeResponseParty.CLIENT
            ? dispute.order.clientId
            : dispute.order.providerId;
        if (expectedUserId !== userId)
          throw new NotFoundException("Dispute not found");
        if (
          !dispute.responseRequestedFrom ||
          !dispute.responseRequestedAt ||
          !dispute.responseDeadlineAt ||
          dispute.responseRequestSequence < 1
        )
          throw new ConflictException("The response request is incomplete");
        if (dispute.responseDeadlineAt.getTime() <= now.getTime())
          throw new ConflictException(
            "The response deadline has passed; the dispute is ready for review",
          );
        const response = await database.disputeResponse.create({
          data: {
            disputeId,
            responderId: userId,
            requestedFrom: dispute.responseRequestedFrom,
            requestSequence: dispute.responseRequestSequence,
            details: detailsInput.trim(),
            responseRequestedAt: dispute.responseRequestedAt,
            responseDeadlineAt: dispute.responseDeadlineAt,
          },
          select: { id: true },
        });
        await this.createEvidenceRecords(
          database,
          disputeId,
          userId,
          evidence,
          response.id,
        );
        await database.orderDispute.update({
          where: { id: disputeId },
          data: { status: "READY_FOR_REVIEW", readyForReviewAt: now },
        });
        await database.disputeTimelineEvent.createMany({
          data: [
            {
              disputeId,
              actorId: userId,
              type: "RESPONSE_SUBMITTED",
              details: `Response submitted for request ${dispute.responseRequestSequence}.`,
              createdAt: now,
            },
            ...(evidence.length
              ? [
                  {
                    disputeId,
                    actorId: userId,
                    type: "EVIDENCE_ADDED" as const,
                    details: `${evidence.length} response evidence file(s) added.`,
                    createdAt: now,
                  },
                ]
              : []),
            {
              disputeId,
              actorId: userId,
              type: "READY_FOR_REVIEW",
              details: "Requested response received.",
              createdAt: now,
            },
          ],
        });
        const recipientId =
          userId === dispute.order.clientId
            ? dispute.order.providerId
            : dispute.order.clientId;
        await database.notification.create({
          data: {
            orderId,
            recipientId,
            type: "ORDER_DISPUTE_RESPONSE_RECEIVED",
            title: "Dispute response received",
            body: `A requested response was submitted for ${dispute.order.titleSnapshot}. The case is ready for admin review.`,
          },
        });
      });
      return {
        data: await this.findParticipantDispute(disputeId),
        message: "Response submitted. The dispute is ready for admin review.",
      };
    } catch (error) {
      await this.deleteEvidence(evidence);
      throw error;
    }
  }

  async appendEvidence(
    userId: string,
    orderId: string,
    disputeId: string,
    files: Express.Multer.File[],
  ) {
    await this.requireParticipant(userId, orderId);
    if (!files.length)
      throw new ConflictException("Attach at least one evidence file");
    const evidence = await this.persistEvidence(files);
    try {
      await this.prisma.$transaction(async (database) => {
        await lockOrderReview(database, orderId);
        const dispute = await database.orderDispute.findFirst({
          where: { id: disputeId, orderId },
          select: { status: true },
        });
        if (!dispute || !isActiveDisputeStatus(dispute.status))
          throw new NotFoundException("Active dispute not found");
        await this.createEvidenceRecords(
          database,
          disputeId,
          userId,
          evidence,
          null,
        );
        await database.disputeTimelineEvent.create({
          data: {
            disputeId,
            actorId: userId,
            type: "EVIDENCE_ADDED",
            details: `${evidence.length} evidence file(s) added.`,
          },
        });
      });
      return {
        data: await this.findParticipantDispute(disputeId),
        message: "Evidence added without replacing earlier evidence.",
      };
    } catch (error) {
      await this.deleteEvidence(evidence);
      throw error;
    }
  }

  async getEvidence(
    userId: string,
    orderId: string,
    disputeId: string,
    evidenceId: string,
  ) {
    const evidence = await this.prisma.disputeEvidence.findFirst({
      where: {
        id: evidenceId,
        disputeId,
        dispute: {
          orderId,
          order: { OR: [{ clientId: userId }, { providerId: userId }] },
        },
      },
      select: {
        storagePath: true,
        originalName: true,
        mimeType: true,
      },
    });
    if (!evidence) throw new NotFoundException("Evidence not found");
    return evidence;
  }

  async getAdminEvidence(disputeId: string, evidenceId: string) {
    const evidence = await this.prisma.disputeEvidence.findFirst({
      where: { id: evidenceId, disputeId },
      select: {
        storagePath: true,
        originalName: true,
        mimeType: true,
      },
    });
    if (!evidence) throw new NotFoundException("Evidence not found");
    return evidence;
  }

  async list(status?: DisputeStatus, cursor?: string, limit = 20) {
    await this.reconcileExpiredBatch(new Date(), 100);
    const decoded = cursor ? decodeDateCursor(cursor, "dispute") : null;
    const disputes = await this.prisma.orderDispute.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(decoded
          ? {
              OR: [
                { createdAt: { gt: decoded.date } },
                { createdAt: decoded.date, id: { gt: decoded.id } },
              ],
            }
          : {}),
      },
      include: {
        ...this.participantInclude,
        order: {
          select: {
            id: true,
            orderNumber: true,
            titleSnapshot: true,
            totalCentavos: true,
            currency: true,
            status: true,
          },
        },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit + 1,
    });
    const hasMore = disputes.length > limit;
    const data = hasMore ? disputes.slice(0, limit) : disputes;
    const last = data.at(-1);
    return {
      data,
      pagination: {
        hasMore,
        nextCursor:
          hasMore && last
            ? encodeDateCursor({ date: last.createdAt, id: last.id })
            : null,
      },
    };
  }

  async adminDetail(disputeId: string) {
    await this.reconcileExpiredResponse(disputeId);
    const dispute = await this.prisma.orderDispute.findUnique({
      where: { id: disputeId },
      include: this.adminDetailInclude,
    });
    if (!dispute) throw new NotFoundException("Dispute not found");
    return { data: dispute };
  }

  async requestResponse(
    adminId: string,
    disputeId: string,
    requestedFrom: DisputeResponseParty,
  ) {
    const orderId = await this.requireDisputeOrderId(disputeId);
    const now = new Date();
    await this.prisma.$transaction(async (database) => {
      await lockOrderReview(database, orderId);
      const dispute = await database.orderDispute.findUnique({
        where: { id: disputeId },
        include: {
          order: {
            select: {
              clientId: true,
              providerId: true,
              titleSnapshot: true,
            },
          },
        },
      });
      if (!dispute || !isActiveDisputeStatus(dispute.status))
        throw new ConflictException("This dispute has already been resolved");
      const responseDeadlineAt = responseDeadline(now);
      await database.orderDispute.update({
        where: { id: disputeId },
        data: {
          status: waitingStatus(requestedFrom),
          responseRequestedFrom: requestedFrom,
          responseRequestedAt: now,
          responseDeadlineAt,
          responseRequestSequence: dispute.responseRequestSequence + 1,
          readyForReviewAt: null,
        },
      });
      await database.disputeTimelineEvent.create({
        data: {
          disputeId,
          actorId: adminId,
          type: "RESPONSE_REQUESTED",
          details: `${requestedFrom} response requested within 48 hours.`,
        },
      });
      await database.notification.create({
        data: {
          orderId,
          recipientId:
            requestedFrom === DisputeResponseParty.CLIENT
              ? dispute.order.clientId
              : dispute.order.providerId,
          type: "ORDER_DISPUTE_RESPONSE_REQUESTED",
          title: "Your dispute response is requested",
          body: `Please respond within 48 hours for ${dispute.order.titleSnapshot}.`,
        },
      });
    });
    return {
      ...(await this.adminDetail(disputeId)),
      message: "A new 48-hour response window has started.",
    };
  }

  async markReady(adminId: string, disputeId: string) {
    const orderId = await this.requireDisputeOrderId(disputeId);
    await this.prisma.$transaction(async (database) => {
      await lockOrderReview(database, orderId);
      const dispute = await database.orderDispute.findUnique({
        where: { id: disputeId },
        select: { status: true },
      });
      if (!dispute || !isActiveDisputeStatus(dispute.status))
        throw new ConflictException("This dispute has already been resolved");
      if (dispute.status === DisputeStatus.UNDER_REVIEW) return;
      await database.orderDispute.update({
        where: { id: disputeId },
        data: { status: "READY_FOR_REVIEW", readyForReviewAt: new Date() },
      });
      await database.disputeTimelineEvent.create({
        data: {
          disputeId,
          actorId: adminId,
          type: "READY_FOR_REVIEW",
          details: "Administrator marked the case ready for review.",
        },
      });
    });
    return this.adminDetail(disputeId);
  }

  async beginReview(adminId: string, disputeId: string) {
    const orderId = await this.requireDisputeOrderId(disputeId);
    await this.reconcileExpiredResponse(disputeId);
    await this.prisma.$transaction(async (database) => {
      await lockOrderReview(database, orderId);
      const changed = await database.orderDispute.updateMany({
        where: {
          id: disputeId,
          status: { in: [DisputeStatus.READY_FOR_REVIEW, DisputeStatus.OPEN] },
        },
        data: { status: "UNDER_REVIEW", reviewStartedAt: new Date() },
      });
      if (changed.count !== 1)
        throw new ConflictException("This dispute is not ready for review");
      await database.disputeTimelineEvent.create({
        data: {
          disputeId,
          actorId: adminId,
          type: "REVIEW_STARTED",
          details: "Administrator began evidence review.",
        },
      });
    });
    return this.adminDetail(disputeId);
  }

  async resolve(
    adminId: string,
    disputeId: string,
    status: DisputeStatus,
    resolutionInput: string,
  ) {
    if (!resolutionStatuses.has(status))
      throw new ConflictException("Select a final dispute resolution");
    const orderId = await this.requireDisputeOrderId(disputeId);
    const resolvedAt = new Date();
    const transactionResult = await this.prisma.$transaction(
      async (database) => {
        await lockOrderReview(database, orderId);
        const dispute = await database.orderDispute.findUnique({
          where: { id: disputeId },
          include: {
            order: {
              select: {
                clientId: true,
                providerId: true,
                titleSnapshot: true,
                status: true,
                reviewDeliverySubmissionId: true,
              },
            },
            affectedEarnings: {
              include: {
                providerEarning: {
                  select: {
                    id: true,
                    providerId: true,
                    orderId: true,
                    status: true,
                    currency: true,
                  },
                },
              },
            },
          },
        });
        if (!dispute) throw new NotFoundException("Dispute not found");
        if (!isActiveDisputeStatus(dispute.status)) {
          if (dispute.status === status) return { transitioned: false };
          throw new ConflictException("This dispute has already been resolved");
        }
        if (
          status !== DisputeStatus.CLOSED &&
          dispute.status !== DisputeStatus.UNDER_REVIEW
        )
          throw new ConflictException(
            "Begin admin review before recording a decision",
          );

        if (
          status === DisputeStatus.RESOLVED_PROVIDER ||
          status === DisputeStatus.CLOSED
        ) {
          for (const affected of dispute.affectedEarnings) {
            if (affected.restoredAt) continue;
            const changed = await database.providerEarning.updateMany({
              where: {
                id: affected.providerEarningId,
                status: ProviderEarningStatus.FROZEN,
              },
              data: { status: affected.preFreezeStatus },
            });
            if (changed.count !== 1)
              throw new ConflictException(
                "A frozen earning changed before restoration",
              );
            await database.providerEarningLedgerEntry.create({
              data: {
                providerEarningId: affected.providerEarning.id,
                providerId: affected.providerEarning.providerId,
                orderId: affected.providerEarning.orderId,
                type: "EARNING_UNFROZEN",
                amountCentavos: 0,
                currency: affected.providerEarning.currency,
                sourceKey: `earning:${affected.providerEarning.id}:dispute:${dispute.id}:unfrozen`,
              },
            });
            await database.disputeAffectedEarning.update({
              where: { id: affected.id },
              data: { restoredAt: resolvedAt },
            });
          }
          if (
            dispute.reviewPausedAt &&
            dispute.reviewRemainingSeconds !== null &&
            dispute.order.status === "SUBMITTED" &&
            dispute.order.reviewDeliverySubmissionId ===
              dispute.targetDeliverySubmissionId
          ) {
            await database.order.update({
              where: { id: dispute.orderId },
              data: {
                reviewDeadlineAt: resumedReviewDeadline(
                  resolvedAt,
                  dispute.reviewRemainingSeconds,
                ),
              },
            });
          }
        }
        await database.orderDispute.update({
          where: { id: disputeId },
          data: {
            status,
            resolutionNote: resolutionInput.trim(),
            resolvedById: adminId,
            resolvedAt,
          },
        });
        await database.disputeTimelineEvent.create({
          data: {
            disputeId,
            actorId: adminId,
            type:
              status === DisputeStatus.RESOLVED_CLIENT
                ? "RESOLVED_CLIENT"
                : status === DisputeStatus.RESOLVED_PROVIDER
                  ? "RESOLVED_PROVIDER"
                  : "CLOSED",
            details: resolutionInput.trim(),
          },
        });
        await database.notification.createMany({
          data: [dispute.order.clientId, dispute.order.providerId].map(
            (recipientId) => ({
              orderId: dispute.orderId,
              recipientId,
              type: "ORDER_DISPUTE_RESOLVED",
              title: "Dispute review completed",
              body:
                status === DisputeStatus.RESOLVED_CLIENT
                  ? `${resolutionInput.trim()} The affected earning remains frozen; no refund has been issued yet.`
                  : resolutionInput.trim(),
            }),
          ),
        });
        return { transitioned: true };
      },
    );
    return {
      ...(await this.adminDetail(disputeId)),
      message: transactionResult.transitioned
        ? "Dispute resolved and both parties notified."
        : "This resolution was already recorded; no duplicate action was taken.",
    };
  }

  async expiredResponseDisputeIds(now = new Date(), limit = 25) {
    const rows = await this.prisma.orderDispute.findMany({
      where: {
        status: { in: ["WAITING_FOR_CLIENT", "WAITING_FOR_PROVIDER"] },
        responseDeadlineAt: { lte: now },
      },
      select: { id: true },
      orderBy: [{ responseDeadlineAt: "asc" }, { id: "asc" }],
      take: Math.min(Math.max(limit, 1), 100),
    });
    return rows.map(({ id }) => id);
  }

  async reconcileExpiredResponse(disputeId: string, now = new Date()) {
    const row = await this.prisma.orderDispute.findUnique({
      where: { id: disputeId },
      select: { orderId: true },
    });
    if (!row) return { transitioned: false };
    return this.prisma.$transaction(async (database) => {
      await lockOrderReview(database, row.orderId);
      const dispute = await database.orderDispute.findUnique({
        where: { id: disputeId },
        include: {
          order: {
            select: {
              clientId: true,
              providerId: true,
              titleSnapshot: true,
            },
          },
        },
      });
      if (
        !dispute ||
        (dispute.status !== DisputeStatus.WAITING_FOR_CLIENT &&
          dispute.status !== DisputeStatus.WAITING_FOR_PROVIDER) ||
        !dispute.responseDeadlineAt ||
        dispute.responseDeadlineAt.getTime() > now.getTime()
      )
        return { transitioned: false };
      const changed = await database.orderDispute.updateMany({
        where: {
          id: disputeId,
          status: { in: ["WAITING_FOR_CLIENT", "WAITING_FOR_PROVIDER"] },
          responseDeadlineAt: { lte: now },
        },
        data: { status: "READY_FOR_REVIEW", readyForReviewAt: now },
      });
      if (changed.count !== 1) return { transitioned: false };
      await database.disputeTimelineEvent.createMany({
        data: [
          {
            disputeId,
            type: "RESPONSE_DEADLINE_EXPIRED",
            details: "The response deadline expired without deciding a winner.",
            createdAt: now,
          },
          {
            disputeId,
            type: "READY_FOR_REVIEW",
            details:
              "The case is ready for admin review using available evidence.",
            createdAt: now,
          },
        ],
      });
      await database.notification.createMany({
        data: [dispute.order.clientId, dispute.order.providerId].map(
          (recipientId) => ({
            orderId: dispute.orderId,
            recipientId,
            type: "ORDER_DISPUTE_READY_FOR_REVIEW",
            title: "Dispute is ready for review",
            body: `The response window for ${dispute.order.titleSnapshot} ended. No winner was selected automatically.`,
          }),
        ),
      });
      return { transitioned: true };
    });
  }

  private async reconcileExpiredBatch(now: Date, limit: number) {
    const ids = await this.expiredResponseDisputeIds(now, limit);
    for (const id of ids) await this.reconcileExpiredResponse(id, now);
  }

  private async reconcileExpiredResponsesForOrder(orderId: string) {
    const rows = await this.prisma.orderDispute.findMany({
      where: {
        orderId,
        status: { in: ["WAITING_FOR_CLIENT", "WAITING_FOR_PROVIDER"] },
        responseDeadlineAt: { lte: new Date() },
      },
      select: { id: true },
      take: 5,
    });
    for (const row of rows) await this.reconcileExpiredResponse(row.id);
  }

  private async requireDisputeOrderId(disputeId: string) {
    const dispute = await this.prisma.orderDispute.findUnique({
      where: { id: disputeId },
      select: { orderId: true },
    });
    if (!dispute) throw new NotFoundException("Dispute not found");
    return dispute.orderId;
  }

  private async findParticipantDispute(disputeId: string) {
    return this.prisma.orderDispute.findUniqueOrThrow({
      where: { id: disputeId },
      include: this.participantInclude,
    });
  }

  private async requireParticipant(userId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        OR: [{ clientId: userId }, { providerId: userId }],
      },
      select: { id: true, clientId: true, providerId: true },
    });
    if (!order) throw new NotFoundException("Order not found");
    return order;
  }

  private async persistEvidence(files: Express.Multer.File[]) {
    if (!files.length) return [];
    const stored = await this.storage.persistEvidenceUploads(
      "dispute-evidence",
      files,
    );
    return files.map((file, index) => ({
      storagePath: stored[index].storagePath,
      originalName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      checksum: stored[index].checksum,
    }));
  }

  private async deleteEvidence(evidence: StoredEvidence[]) {
    await Promise.all(
      evidence.map((file) =>
        this.storage.delete("dispute-evidence", file.storagePath),
      ),
    );
  }

  private async createEvidenceRecords(
    database: Prisma.TransactionClient,
    disputeId: string,
    submittedById: string,
    evidence: StoredEvidence[],
    responseId: string | null,
  ) {
    if (!evidence.length) return;
    await database.disputeEvidence.createMany({
      data: evidence.map((file) => ({
        disputeId,
        responseId,
        submittedById,
        ...file,
      })),
    });
  }

  private readonly participantInclude = {
    openedBy: { select: { id: true, displayName: true } },
    resolvedBy: { select: { id: true, displayName: true } },
    targetDeliverySubmission: {
      select: { id: true, version: true, submittedAt: true },
    },
    targetRevisionRequest: {
      select: { id: true, sequenceNumber: true, type: true, createdAt: true },
    },
    targetRevisionPurchase: {
      select: {
        id: true,
        providerSubtotalCentavos: true,
        currency: true,
        paymentStatus: true,
      },
    },
    affectedEarnings: {
      select: {
        id: true,
        preFreezeStatus: true,
        frozenAt: true,
        restoredAt: true,
        providerEarning: {
          select: {
            id: true,
            sourceType: true,
            status: true,
            currency: true,
            grossServiceAmountCentavos: true,
          },
        },
      },
    },
    evidence: {
      select: {
        id: true,
        responseId: true,
        submittedById: true,
        originalName: true,
        mimeType: true,
        sizeBytes: true,
        checksum: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
    },
    responses: {
      include: { responder: { select: { id: true, displayName: true } } },
      orderBy: [{ requestSequence: "asc" as const }, { id: "asc" as const }],
    },
    timeline: {
      include: { actor: { select: { id: true, displayName: true } } },
      orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
    },
  } satisfies Prisma.OrderDisputeInclude;

  private readonly adminDetailInclude = {
    ...this.participantInclude,
    order: {
      select: {
        id: true,
        orderNumber: true,
        titleSnapshot: true,
        requirements: true,
        termsSnapshot: true,
        subtotalCentavos: true,
        platformFeeCentavos: true,
        totalCentavos: true,
        currency: true,
        status: true,
        completionSource: true,
        reviewStartedAt: true,
        reviewDeadlineAt: true,
        client: { select: { id: true, displayName: true } },
        provider: { select: { id: true, displayName: true } },
        deliverySubmissions: {
          orderBy: [{ version: "asc" as const }],
          select: {
            id: true,
            version: true,
            note: true,
            submittedAt: true,
            revisionRequestId: true,
            files: {
              select: {
                id: true,
                originalName: true,
                mimeType: true,
                sizeBytes: true,
                checksum: true,
                createdAt: true,
              },
            },
            fileAccesses: {
              select: {
                id: true,
                fileId: true,
                userId: true,
                accessType: true,
                accessedAt: true,
              },
              orderBy: [{ accessedAt: "asc" as const }],
            },
          },
        },
        revisions: {
          orderBy: [{ sequenceNumber: "asc" as const }],
          select: {
            id: true,
            sequenceNumber: true,
            type: true,
            instructions: true,
            status: true,
            sourceDeliverySubmissionId: true,
            revisionDeadlineAt: true,
            createdAt: true,
            purchase: {
              select: {
                id: true,
                providerSubtotalCentavos: true,
                platformFeeCentavos: true,
                totalCentavos: true,
                currency: true,
                paymentStatus: true,
                activationStatus: true,
              },
            },
          },
        },
      },
    },
  } satisfies Prisma.OrderDisputeInclude;
}
