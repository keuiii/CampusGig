import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";
import type { CreateOrderDto } from "./dto/create-order.dto";
import type { CreateReviewDto } from "./dto/create-review.dto";

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(clientId: string, input: CreateOrderDto) {
    const service = await this.prisma.service.findFirst({
      where: { id: input.serviceId, status: "PUBLISHED", deletedAt: null },
      include: {
        provider: { select: { displayName: true } },
        packages: { where: { id: input.servicePackageId, isActive: true } },
      },
    });
    if (!service) throw new NotFoundException("Service is no longer available");
    const selectedPackage = service.packages[0];
    if (!selectedPackage)
      throw new BadRequestException("Selected package is no longer available");
    if (service.providerId === clientId)
      throw new BadRequestException("You cannot order your own service");
    const requirements = input.requirements.trim();
    const dueAt = new Date(
      Date.now() + selectedPackage.deliveryDays * 24 * 60 * 60 * 1000,
    );
    const orderNumber = `CG-${new Date().getFullYear()}-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
    const order = await this.prisma.$transaction(async (database) =>
      database.order.create({
        data: {
          orderNumber,
          clientId,
          providerId: service.providerId,
          serviceId: service.id,
          servicePackageId: selectedPackage.id,
          titleSnapshot: service.title,
          packageSnapshot: {
            tier: selectedPackage.tier,
            name: selectedPackage.name,
            description: selectedPackage.description,
            priceCentavos: selectedPackage.priceCentavos,
            deliveryDays: selectedPackage.deliveryDays,
            revisionLimit: selectedPackage.revisionLimit,
          },
          subtotalCentavos: selectedPackage.priceCentavos,
          totalCentavos: selectedPackage.priceCentavos,
          requirements,
          dueAt,
          revisionLimit: selectedPackage.revisionLimit,
          history: {
            create: {
              toStatus: "REQUESTED",
              changedBy: clientId,
              note: "Client submitted a service request",
            },
          },
          conversation: {
            create: {
              participants: {
                create: [{ userId: clientId }, { userId: service.providerId }],
              },
            },
          },
          notifications: {
            create: {
              recipientId: service.providerId,
              type: "NEW_ORDER",
              title: "New service request",
              body: `A client requested ${service.title}.`,
            },
          },
        },
        include: this.orderInclude,
      }),
    );
    return {
      data: this.toResponse(order),
      message: `${service.provider.displayName} has been notified.`,
    };
  }

  async list(userId: string, scope: "client" | "provider") {
    const orders = await this.prisma.order.findMany({
      where:
        scope === "provider" ? { providerId: userId } : { clientId: userId },
      include: this.orderInclude,
      orderBy: { createdAt: "desc" },
    });
    return { data: orders.map((order) => this.toResponse(order)) };
  }

  async findOne(userId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        OR: [{ clientId: userId }, { providerId: userId }],
      },
      include: {
        ...this.orderInclude,
        history: {
          include: { actor: { select: { id: true, displayName: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!order) throw new NotFoundException("Order not found");
    return {
      data: {
        ...this.toResponse(order),
        history: order.history.map((item) => ({
          id: item.id,
          fromStatus: item.fromStatus,
          toStatus: item.toStatus,
          note: item.note,
          createdAt: item.createdAt,
          actor: item.actor,
        })),
      },
    };
  }

  async accept(providerId: string, orderId: string) {
    const order = await this.requireProviderOrder(providerId, orderId);
    if (order.status !== "REQUESTED")
      throw new ConflictException("Only a requested order can be accepted");
    const updated = await this.prisma.$transaction(async (database) => {
      const changed = await database.order.updateMany({
        where: { id: order.id, providerId, status: "REQUESTED" },
        data: { status: "ACCEPTED", acceptedAt: new Date() },
      });
      if (changed.count !== 1)
        throw new ConflictException("This request has already been decided");
      await database.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: "REQUESTED",
          toStatus: "ACCEPTED",
          changedBy: providerId,
          note: "Provider accepted the service request",
        },
      });
      await database.notification.create({
        data: {
          orderId: order.id,
          recipientId: order.clientId,
          type: "ORDER_ACCEPTED",
          title: "Service request accepted",
          body: `${order.provider.displayName} accepted your request for ${order.titleSnapshot}.`,
        },
      });
      return database.order.findUniqueOrThrow({
        where: { id: order.id },
        include: this.orderInclude,
      });
    });
    return {
      data: this.toResponse(updated),
      message: "Request accepted and the client has been notified.",
    };
  }

  async reject(providerId: string, orderId: string, reason: string) {
    const order = await this.requireProviderOrder(providerId, orderId);
    if (order.status !== "REQUESTED")
      throw new ConflictException("Only a requested order can be rejected");
    const note = reason.trim();
    const updated = await this.prisma.$transaction(async (database) => {
      const changed = await database.order.updateMany({
        where: { id: order.id, providerId, status: "REQUESTED" },
        data: { status: "REJECTED" },
      });
      if (changed.count !== 1)
        throw new ConflictException("This request has already been decided");
      await database.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: "REQUESTED",
          toStatus: "REJECTED",
          changedBy: providerId,
          note,
        },
      });
      await database.notification.create({
        data: {
          orderId: order.id,
          recipientId: order.clientId,
          type: "ORDER_REJECTED",
          title: "Service request declined",
          body: `${order.provider.displayName} declined your request for ${order.titleSnapshot}. Reason: ${note}`,
        },
      });
      return database.order.findUniqueOrThrow({
        where: { id: order.id },
        include: this.orderInclude,
      });
    });
    return {
      data: this.toResponse(updated),
      message: "Request declined and the client has been notified.",
    };
  }

  async start(providerId: string, orderId: string) {
    const order = await this.requireProviderOrder(providerId, orderId);
    if (order.status !== "ACCEPTED")
      throw new ConflictException("Only an accepted order can be started");
    const updated = await this.prisma.$transaction(async (database) => {
      const changed = await database.order.updateMany({
        where: { id: order.id, providerId, status: "ACCEPTED" },
        data: { status: "IN_PROGRESS", startedAt: new Date() },
      });
      if (changed.count !== 1)
        throw new ConflictException(
          "This order has already been started or updated",
        );
      await database.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: "ACCEPTED",
          toStatus: "IN_PROGRESS",
          changedBy: providerId,
          note: "Provider started working on the order",
        },
      });
      await database.notification.create({
        data: {
          orderId: order.id,
          recipientId: order.clientId,
          type: "ORDER_STARTED",
          title: "Work has started",
          body: `${order.provider.displayName} started working on ${order.titleSnapshot}.`,
        },
      });
      return database.order.findUniqueOrThrow({
        where: { id: order.id },
        include: this.orderInclude,
      });
    });
    return {
      data: this.toResponse(updated),
      message: "Order started and the client has been notified.",
    };
  }

  async deliver(
    providerId: string,
    orderId: string,
    note: string,
    files: Express.Multer.File[],
  ) {
    const order = await this.requireProviderOrder(providerId, orderId);
    if (
      !(["IN_PROGRESS", "REVISION_REQUESTED"] as string[]).includes(
        order.status,
      )
    )
      throw new ConflictException(
        "Only active work or a requested revision can be submitted",
      );
    if (!files.length)
      throw new BadRequestException("Attach at least one deliverable file");
    const fromStatus = order.status;
    const purpose =
      fromStatus === "REVISION_REQUESTED" ? "REVISION" : "DELIVERABLE";
    const submittedNote = note.trim();
    const updated = await this.prisma.$transaction(async (database) => {
      const changed = await database.order.updateMany({
        where: { id: order.id, providerId, status: fromStatus },
        data: { status: "SUBMITTED", submittedAt: new Date() },
      });
      if (changed.count !== 1)
        throw new ConflictException(
          "This order changed before the delivery was submitted",
        );
      await database.orderFile.createMany({
        data: files.map((file) => ({
          orderId,
          uploadedBy: providerId,
          purpose,
          storagePath: file.filename,
          originalName: file.originalname,
          mimeType: file.mimetype,
          sizeBytes: file.size,
        })),
      });
      if (fromStatus === "REVISION_REQUESTED")
        await database.revisionRequest.updateMany({
          where: { orderId, status: "OPEN" },
          data: { status: "RESOLVED", resolvedAt: new Date() },
        });
      await database.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus,
          toStatus: "SUBMITTED",
          changedBy: providerId,
          note: submittedNote,
        },
      });
      await database.notification.create({
        data: {
          orderId,
          recipientId: order.clientId,
          type: "DELIVERY_SUBMITTED",
          title:
            fromStatus === "REVISION_REQUESTED"
              ? "Revised work submitted"
              : "Your delivery is ready",
          body: `${order.provider.displayName} submitted files for ${order.titleSnapshot}.`,
        },
      });
      return database.order.findUniqueOrThrow({
        where: { id: orderId },
        include: this.orderInclude,
      });
    });
    return {
      data: this.toResponse(updated),
      message: "Delivery submitted and the client has been notified.",
    };
  }

  async requestRevision(
    clientId: string,
    orderId: string,
    instructions: string,
  ) {
    const order = await this.requireClientOrder(clientId, orderId);
    if (order.status !== "SUBMITTED")
      throw new ConflictException(
        "A revision can only be requested for submitted work",
      );
    if (order.revisionsUsed >= order.revisionLimit)
      throw new ConflictException("This order has reached its revision limit");
    const note = instructions.trim();
    const sequenceNumber = order.revisionsUsed + 1;
    const updated = await this.prisma.$transaction(async (database) => {
      const changed = await database.order.updateMany({
        where: {
          id: orderId,
          clientId,
          status: "SUBMITTED",
          revisionsUsed: order.revisionsUsed,
        },
        data: { status: "REVISION_REQUESTED", revisionsUsed: { increment: 1 } },
      });
      if (changed.count !== 1)
        throw new ConflictException("This delivery has already been reviewed");
      await database.revisionRequest.create({
        data: {
          orderId,
          requestedBy: clientId,
          sequenceNumber,
          instructions: note,
        },
      });
      await database.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: "SUBMITTED",
          toStatus: "REVISION_REQUESTED",
          changedBy: clientId,
          note,
        },
      });
      await database.notification.create({
        data: {
          orderId,
          recipientId: order.providerId,
          type: "REVISION_REQUESTED",
          title: "Client requested a revision",
          body: `Revision ${sequenceNumber} was requested for ${order.titleSnapshot}.`,
        },
      });
      return database.order.findUniqueOrThrow({
        where: { id: orderId },
        include: this.orderInclude,
      });
    });
    return {
      data: this.toResponse(updated),
      message: "Revision requested and the provider has been notified.",
    };
  }

  async complete(clientId: string, orderId: string) {
    const order = await this.requireClientOrder(clientId, orderId);
    if (order.status !== "SUBMITTED")
      throw new ConflictException("Only submitted work can be accepted");
    const updated = await this.prisma.$transaction(async (database) => {
      const changed = await database.order.updateMany({
        where: { id: orderId, clientId, status: "SUBMITTED" },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
      if (changed.count !== 1)
        throw new ConflictException("This delivery has already been reviewed");
      await database.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: "SUBMITTED",
          toStatus: "COMPLETED",
          changedBy: clientId,
          note: "Client accepted the delivery",
        },
      });
      await database.notification.create({
        data: {
          orderId,
          recipientId: order.providerId,
          type: "ORDER_COMPLETED",
          title: "Delivery accepted",
          body: `The client accepted your delivery for ${order.titleSnapshot}.`,
        },
      });
      return database.order.findUniqueOrThrow({
        where: { id: orderId },
        include: this.orderInclude,
      });
    });
    return {
      data: this.toResponse(updated),
      message: "Delivery accepted. You can now review the provider.",
    };
  }

  async review(clientId: string, orderId: string, input: CreateReviewDto) {
    const order = await this.requireClientOrder(clientId, orderId);
    if (order.status !== "COMPLETED")
      throw new ConflictException("Complete the order before leaving a review");
    const review = await this.prisma.review
      .create({
        data: {
          orderId,
          reviewerId: clientId,
          revieweeId: order.providerId,
          overallRating: input.overallRating,
          qualityRating: input.qualityRating,
          communicationRating: input.communicationRating,
          timelinessRating: input.timelinessRating,
          comment: input.comment?.trim() || null,
        },
      })
      .catch((error: { code?: string }) => {
        if (error.code === "P2002")
          throw new ConflictException("This order has already been reviewed");
        throw error;
      });
    await this.prisma.notification.create({
      data: {
        orderId,
        recipientId: order.providerId,
        type: "NEW_REVIEW",
        title: "You received a review",
        body: `The client rated ${order.titleSnapshot} ${input.overallRating} out of 5.`,
      },
    });
    return { data: review, message: "Thank you for reviewing the provider." };
  }

  async getFile(userId: string, orderId: string, fileId: string) {
    const file = await this.prisma.orderFile.findFirst({
      where: {
        id: fileId,
        orderId,
        order: { OR: [{ clientId: userId }, { providerId: userId }] },
      },
      select: { storagePath: true, originalName: true },
    });
    if (!file) throw new NotFoundException("Order file not found");
    return file;
  }

  private async requireProviderOrder(providerId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, providerId },
      include: { provider: { select: { displayName: true } } },
    });
    if (!order) throw new NotFoundException("Order request not found");
    return order;
  }

  private async requireClientOrder(clientId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, clientId },
      include: { provider: { select: { displayName: true } } },
    });
    if (!order) throw new NotFoundException("Order not found");
    return order;
  }

  private readonly orderInclude = {
    client: { select: { id: true, displayName: true } },
    provider: { select: { id: true, displayName: true } },
    servicePackage: {
      select: {
        id: true,
        tier: true,
        name: true,
        deliveryDays: true,
        revisionLimit: true,
      },
    },
    files: {
      orderBy: { createdAt: "asc" as const },
      select: {
        id: true,
        purpose: true,
        originalName: true,
        mimeType: true,
        sizeBytes: true,
        createdAt: true,
      },
    },
    revisions: {
      orderBy: { sequenceNumber: "asc" as const },
      select: {
        id: true,
        sequenceNumber: true,
        instructions: true,
        status: true,
        createdAt: true,
        resolvedAt: true,
      },
    },
    review: {
      select: {
        id: true,
        overallRating: true,
        qualityRating: true,
        communicationRating: true,
        timelinessRating: true,
        comment: true,
        createdAt: true,
      },
    },
  } as const;

  private toResponse(order: any) {
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      title: order.titleSnapshot,
      status: order.status,
      requirements: order.requirements,
      subtotalCentavos: order.subtotalCentavos,
      platformFeeCentavos: order.platformFeeCentavos,
      totalCentavos: order.totalCentavos,
      currency: order.currency,
      dueAt: order.dueAt,
      createdAt: order.createdAt,
      revisionsUsed: order.revisionsUsed,
      revisionLimit: order.revisionLimit,
      files: order.files ?? [],
      revisions: order.revisions ?? [],
      review: order.review ?? null,
      client: order.client,
      provider: order.provider,
      package: order.servicePackage,
    };
  }
}
