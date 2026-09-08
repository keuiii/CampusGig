import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { DisputeReason, DisputeStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

const disputableOrderStatuses = new Set([
  "ACCEPTED",
  "IN_PROGRESS",
  "SUBMITTED",
  "REVISION_REQUESTED",
  "COMPLETED",
]);
const activeDisputeStatuses = ["OPEN", "UNDER_REVIEW"] as const;
const resolutionStatuses = new Set<DisputeStatus>([
  "RESOLVED_CLIENT",
  "RESOLVED_PROVIDER",
  "CLOSED",
]);

@Injectable()
export class DisputesService {
  constructor(private readonly prisma: PrismaService) {}

  async forOrder(userId: string, orderId: string) {
    await this.requireParticipant(userId, orderId);
    return {
      data: await this.prisma.orderDispute.findUnique({
        where: { orderId },
        include: this.disputeInclude,
      }),
    };
  }

  async open(
    userId: string,
    orderId: string,
    reason: DisputeReason,
    detailsInput: string,
  ) {
    const order = await this.requireParticipant(userId, orderId);
    if (!disputableOrderStatuses.has(order.status))
      throw new ConflictException(
        "A dispute can only be opened after a request is accepted",
      );
    const details = detailsInput.trim();
    const recipientId =
      order.clientId === userId ? order.providerId : order.clientId;

    try {
      const dispute = await this.prisma.$transaction(async (database) => {
        const created = await database.orderDispute.create({
          data: { orderId, openedById: userId, reason, details },
          include: this.disputeInclude,
        });
        await database.notification.create({
          data: {
            orderId,
            recipientId,
            type: "ORDER_DISPUTE_OPENED",
            title: "A dispute was opened",
            body: `A dispute was opened for ${order.titleSnapshot}. CampusGig administrators will review it.`,
          },
        });
        return created;
      });
      return { data: dispute, message: "Dispute submitted for review." };
    } catch (error: unknown) {
      if ((error as { code?: string }).code === "P2002")
        throw new ConflictException("This order already has a dispute");
      throw error;
    }
  }

  async list(status?: DisputeStatus) {
    return {
      data: await this.prisma.orderDispute.findMany({
        where: status ? { status } : undefined,
        include: {
          ...this.disputeInclude,
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
        orderBy: { createdAt: "asc" },
      }),
    };
  }

  async beginReview(disputeId: string) {
    const changed = await this.prisma.orderDispute.updateMany({
      where: { id: disputeId, status: "OPEN" },
      data: { status: "UNDER_REVIEW" },
    });
    if (changed.count !== 1)
      throw new ConflictException("This dispute is no longer awaiting review");
    return this.findAdminDispute(disputeId);
  }

  async resolve(
    adminId: string,
    disputeId: string,
    status: DisputeStatus,
    resolutionInput: string,
  ) {
    if (!resolutionStatuses.has(status))
      throw new ConflictException("Select a final dispute resolution");
    const dispute = await this.prisma.orderDispute.findUnique({
      where: { id: disputeId },
      include: { order: { select: { clientId: true, providerId: true } } },
    });
    if (!dispute) throw new NotFoundException("Dispute not found");
    if (!(activeDisputeStatuses as readonly string[]).includes(dispute.status))
      throw new ConflictException("This dispute has already been resolved");
    const resolutionNote = resolutionInput.trim();

    const updated = await this.prisma.$transaction(async (database) => {
      const changed = await database.orderDispute.updateMany({
        where: { id: disputeId, status: { in: [...activeDisputeStatuses] } },
        data: {
          status,
          resolutionNote,
          resolvedById: adminId,
          resolvedAt: new Date(),
        },
      });
      if (changed.count !== 1)
        throw new ConflictException("This dispute has already been resolved");
      await database.notification.createMany({
        data: [dispute.order.clientId, dispute.order.providerId].map(
          (recipientId) => ({
            orderId: dispute.orderId,
            recipientId,
            type: "ORDER_DISPUTE_RESOLVED",
            title: "Dispute review completed",
            body: resolutionNote,
          }),
        ),
      });
      return database.orderDispute.findUniqueOrThrow({
        where: { id: disputeId },
        include: this.disputeInclude,
      });
    });
    return {
      data: updated,
      message: "Dispute resolved and both parties notified.",
    };
  }

  private async findAdminDispute(disputeId: string) {
    const dispute = await this.prisma.orderDispute.findUnique({
      where: { id: disputeId },
      include: this.disputeInclude,
    });
    if (!dispute) throw new NotFoundException("Dispute not found");
    return { data: dispute };
  }

  private async requireParticipant(userId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        OR: [{ clientId: userId }, { providerId: userId }],
      },
      select: {
        id: true,
        clientId: true,
        providerId: true,
        status: true,
        titleSnapshot: true,
      },
    });
    if (!order) throw new NotFoundException("Order not found");
    return order;
  }

  private readonly disputeInclude = {
    openedBy: { select: { id: true, displayName: true } },
    resolvedBy: { select: { id: true, displayName: true } },
  } as const;
}
