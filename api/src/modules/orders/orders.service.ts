import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import { DeliveryOption, OrderCompletionSource, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { StorageService } from "../../common/storage/storage.service";
import { MessagesGateway } from "../messages/messages.gateway";
import type { CreateOrderDto } from "./dto/create-order.dto";
import type { CreateReviewDto } from "./dto/create-review.dto";
import { resolveRequestedDeliveryDate } from "./delivery-date";
import { deliveryRequestFingerprint } from "./delivery-evidence";
import { orderRequestFingerprint } from "./order-idempotency";
import { decodeOrderCursor, encodeOrderCursor } from "./order-cursor";
import {
  buildLegacyOrderTermsSnapshot,
  legacyOrderPricingModel,
  legacyOrderTermsSnapshotVersion,
  legacyPackageTerms,
  termsSnapshotVersion,
} from "./legacy-order-terms";
import { MarketplacePricingPolicy } from "../marketplace-pricing/marketplace-pricing.policy";
import {
  earningAvailableReleaseSourceKey,
  isOrderReviewExpired,
  orderReviewPolicyVersion,
  orderReviewWindow,
} from "./order-review.policy";
import { lockOrderReview } from "./order-review-lock";
import {
  ACTIVE_DISPUTE_STATUSES,
  isActiveDisputeStatus,
} from "../disputes/dispute-status";
import { providerEarningPrincipal } from "../payments/provider-earnings.policy";
import {
  revisionDeadlineAt,
  revisionTurnaroundMinutes,
} from "./revision-policy";

const activeOrderStatuses = [
  "ACCEPTED",
  "IN_PROGRESS",
  "SUBMITTED",
  "REVISION_REQUESTED",
] as const;

type RevisionActionOrder = {
  status: string;
  pricingModel?: string;
  deliveryDurationMinutes?: number | null;
  termsSnapshot?: unknown;
  reviewPolicyVersion: number | null;
  reviewDeadlineAt: Date | null;
  reviewDeliverySubmissionId: string | null;
  deliverySubmissions: { id: string }[];
  payments: {
    refundedCentavos: number;
    refunds: { id: string }[];
  }[];
  revisions: { id: string }[];
  disputes: { id: string }[];
};

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly storage: StorageService,
    private readonly realtime?: MessagesGateway,
    private readonly pricing?: MarketplacePricingPolicy,
  ) {}

  async create(clientId: string, input: CreateOrderDto) {
    const requestFingerprint = input.clientRequestId
      ? orderRequestFingerprint(input)
      : null;
    if (input.clientRequestId) {
      const existing = await this.findByClientRequestId(
        clientId,
        input.clientRequestId,
      );
      if (existing)
        return this.idempotentOrderResponse(existing, requestFingerprint!);
    }
    const service = await this.prisma.service.findFirst({
      where: { id: input.serviceId, status: "PUBLISHED", deletedAt: null },
      include: {
        provider: {
          select: {
            displayName: true,
            providerProfile: { select: { isAvailable: true } },
          },
        },
        packages: { where: { id: input.servicePackageId, isActive: true } },
      },
    });
    if (!service) throw new NotFoundException("Service is no longer available");
    if (service.provider.providerProfile?.isAvailable !== true)
      throw new ConflictException(
        "This provider is currently unavailable for new work",
      );
    if (service.providerId === clientId)
      throw new BadRequestException("You cannot order your own service");
    if (service.pricingModel === "SINGLE_PRICE_V2")
      return this.createV2Order(clientId, input, service, requestFingerprint);
    if (
      service.pricingModel !== undefined &&
      service.pricingModel !== "LEGACY_PACKAGES"
    )
      throw new ConflictException(
        "This service uses a marketplace model that is not available yet",
      );
    if (!input.servicePackageId)
      throw new BadRequestException("Select a service package");
    if (input.deliveryOption !== undefined)
      throw new BadRequestException(
        "Legacy package orders cannot include a V2 delivery option",
      );
    const selectedPackage = service.packages[0];
    if (!selectedPackage)
      throw new BadRequestException("Selected package is no longer available");
    const requirements = input.requirements.trim();
    const dueAt = resolveRequestedDeliveryDate(
      input.requestedDeliveryDate,
      selectedPackage.deliveryDays,
    );
    const dueDateLabel = dueAt.toLocaleDateString("en-PH", {
      timeZone: "Asia/Manila",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const orderNumber = `CG-${new Date().getFullYear()}-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
    const platformFeeCentavos = this.calculatePlatformFee(
      selectedPackage.priceCentavos,
    );
    const packageSnapshot = {
      tier: selectedPackage.tier,
      name: selectedPackage.name,
      description: selectedPackage.description,
      priceCentavos: selectedPackage.priceCentavos,
      deliveryDays: selectedPackage.deliveryDays,
      revisionLimit: selectedPackage.revisionLimit,
    };
    const totalCentavos = selectedPackage.priceCentavos + platformFeeCentavos;
    const termsSnapshot = buildLegacyOrderTermsSnapshot({
      serviceTitle: service.title,
      package: { id: selectedPackage.id, ...packageSnapshot },
      currency: "PHP",
      subtotalCentavos: selectedPackage.priceCentavos,
      platformFeeCentavos,
      totalCentavos,
      revisionLimit: selectedPackage.revisionLimit,
      dueAt,
    });
    let transactionResult: { order: any; created: boolean };
    try {
      transactionResult = await this.prisma.$transaction(async (database) => {
        await this.lockProviderWorkload(database, service.providerId);
        if (input.clientRequestId) {
          const existing = await database.order.findUnique({
            where: {
              clientId_clientRequestId: {
                clientId,
                clientRequestId: input.clientRequestId,
              },
            },
            include: this.orderInclude,
          });
          if (existing) return { order: existing, created: false };
        }
        const providerProfile = await database.providerProfile.findUnique({
          where: { userId: service.providerId },
          select: { isAvailable: true, maxPendingOrders: true },
        });
        if (!providerProfile?.isAvailable)
          throw new ConflictException(
            "This provider is currently unavailable for new work",
          );
        const pendingOrders = await database.order.count({
          where: { providerId: service.providerId, status: "REQUESTED" },
        });
        if (pendingOrders >= providerProfile.maxPendingOrders)
          throw new ConflictException(
            "This provider's request queue is currently full. Please try again later.",
          );
        const order = await database.order.create({
          data: {
            orderNumber,
            clientRequestId: input.clientRequestId ?? null,
            requestFingerprint,
            clientId,
            providerId: service.providerId,
            serviceId: service.id,
            servicePackageId: selectedPackage.id,
            pricingModel: legacyOrderPricingModel,
            titleSnapshot: service.title,
            packageSnapshot,
            termsSnapshot,
            subtotalCentavos: selectedPackage.priceCentavos,
            platformFeeCentavos,
            totalCentavos,
            requirements,
            dueAt,
            revisionLimit: selectedPackage.revisionLimit,
            history: {
              create: {
                toStatus: "REQUESTED",
                changedBy: clientId,
                note: `Client requested delivery by ${dueDateLabel}`,
              },
            },
            conversation: {
              create: {
                participants: {
                  create: [
                    { userId: clientId },
                    { userId: service.providerId },
                  ],
                },
              },
            },
            notifications: {
              create: {
                recipientId: service.providerId,
                type: "NEW_ORDER",
                title: "New service request",
                body: `A client requested ${service.title} for delivery by ${dueDateLabel}.`,
              },
            },
          },
          include: this.orderInclude,
        });
        return { order, created: true };
      });
    } catch (error: unknown) {
      if (
        !input.clientRequestId ||
        (error as { code?: string }).code !== "P2002"
      )
        throw error;
      const existing = await this.findByClientRequestId(
        clientId,
        input.clientRequestId,
      );
      if (!existing) throw error;
      return this.idempotentOrderResponse(existing, requestFingerprint!);
    }
    if (!transactionResult.created)
      return this.idempotentOrderResponse(
        transactionResult.order,
        requestFingerprint!,
      );
    const order = transactionResult.order;
    this.realtime?.publishOrderChanged?.(
      order.id,
      [order.clientId, order.providerId],
      "created",
    );
    return {
      data: this.toResponse(order),
      message: `${service.provider.displayName} has been notified.`,
    };
  }

  private async createV2Order(
    clientId: string,
    input: CreateOrderDto,
    service: any,
    requestFingerprint: string | null,
  ) {
    if (input.servicePackageId !== undefined)
      throw new BadRequestException(
        "Single-price orders do not use a service package",
      );
    if (input.requestedDeliveryDate !== undefined)
      throw new BadRequestException(
        "Single-price delivery starts after payment confirmation",
      );
    if (!input.deliveryOption)
      throw new BadRequestException("Select a delivery option");
    if (!this.pricing)
      throw new Error("Marketplace pricing policy is unavailable");
    const terms = {
      basePriceCentavos: service.basePriceCentavos,
      normalDeliveryMinutes: service.normalDeliveryMinutes,
      includedRevisionLimit: service.includedRevisionLimit,
      acceptsRushOrders: service.acceptsRushOrders,
      fastestRushTier: service.fastestRushTier,
    };
    const quote = this.pricing.quote(terms, input.deliveryOption);
    const requirements = input.requirements.trim();
    const termsSnapshot = {
      version: 2,
      pricingModel: "SINGLE_PRICE_V2",
      pricingPolicyVersion: quote.pricingPolicyVersion,
      service: {
        id: service.id,
        title: service.title,
        providerId: service.providerId,
      },
      pricing: {
        currency: quote.currency,
        basePriceCentavos: quote.basePriceCentavos,
        rushBasisPoints: quote.rushBasisPoints,
        rushSurchargeCentavos: quote.rushSurchargeCentavos,
        providerServiceSubtotalCentavos: quote.providerServiceSubtotalCentavos,
        platformFeeBasisPoints: quote.platformFeeBasisPoints,
        platformFeeCentavos: quote.platformFeeCentavos,
        clientTotalCentavos: quote.clientTotalCentavos,
      },
      delivery: {
        option: quote.deliveryOption,
        durationMinutes: quote.deliveryDurationMinutes,
        startsAfterPaymentConfirmation: true,
      },
      includedRevisionLimit: terms.includedRevisionLimit,
      requirements,
    } satisfies Prisma.InputJsonValue;
    const orderNumber = `CG-${new Date().getFullYear()}-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
    let transactionResult: { order: any; created: boolean };
    try {
      transactionResult = await this.prisma.$transaction(async (database) => {
        await this.lockProviderWorkload(database, service.providerId);
        if (input.clientRequestId) {
          const existing = await database.order.findUnique({
            where: {
              clientId_clientRequestId: {
                clientId,
                clientRequestId: input.clientRequestId,
              },
            },
            include: this.orderInclude,
          });
          if (existing) return { order: existing, created: false };
        }
        const providerProfile = await database.providerProfile.findUnique({
          where: { userId: service.providerId },
          select: { isAvailable: true, maxPendingOrders: true },
        });
        if (!providerProfile?.isAvailable)
          throw new ConflictException(
            "This provider is currently unavailable for new work",
          );
        const pendingOrders = await database.order.count({
          where: { providerId: service.providerId, status: "REQUESTED" },
        });
        if (pendingOrders >= providerProfile.maxPendingOrders)
          throw new ConflictException(
            "This provider's request queue is currently full. Please try again later.",
          );
        const order = await database.order.create({
          data: {
            orderNumber,
            clientRequestId: input.clientRequestId ?? null,
            requestFingerprint,
            clientId,
            providerId: service.providerId,
            serviceId: service.id,
            servicePackageId: null,
            pricingModel: "SINGLE_PRICE_V2",
            titleSnapshot: service.title,
            packageSnapshot: Prisma.DbNull,
            termsSnapshot,
            basePriceCentavos: quote.basePriceCentavos,
            rushSurchargeCentavos: quote.rushSurchargeCentavos,
            deliveryOption: quote.deliveryOption,
            deliveryDurationMinutes: quote.deliveryDurationMinutes,
            pricingPolicyVersion: quote.pricingPolicyVersion,
            platformFeeBasisPoints: quote.platformFeeBasisPoints,
            rushBasisPoints: quote.rushBasisPoints,
            subtotalCentavos: quote.providerServiceSubtotalCentavos,
            platformFeeCentavos: quote.platformFeeCentavos,
            totalCentavos: quote.clientTotalCentavos,
            currency: quote.currency,
            requirements,
            dueAt: null,
            revisionLimit: terms.includedRevisionLimit,
            history: {
              create: {
                toStatus: "REQUESTED",
                changedBy: clientId,
                note: `${this.deliveryOptionLabel(quote.deliveryOption)} selected; deadline starts after payment confirmation`,
              },
            },
            conversation: {
              create: {
                participants: {
                  create: [
                    { userId: clientId },
                    { userId: service.providerId },
                  ],
                },
              },
            },
            notifications: {
              create: {
                recipientId: service.providerId,
                type: "NEW_ORDER",
                title: "New service request",
                body: `A client requested ${service.title} with ${this.deliveryOptionLabel(quote.deliveryOption).toLowerCase()} delivery. The deadline starts after payment confirmation.`,
              },
            },
          },
          include: this.orderInclude,
        });
        return { order, created: true };
      });
    } catch (error: unknown) {
      if (
        !input.clientRequestId ||
        (error as { code?: string }).code !== "P2002"
      )
        throw error;
      const existing = await this.findByClientRequestId(
        clientId,
        input.clientRequestId,
      );
      if (!existing) throw error;
      return this.idempotentOrderResponse(existing, requestFingerprint!);
    }
    if (!transactionResult.created)
      return this.idempotentOrderResponse(
        transactionResult.order,
        requestFingerprint!,
      );
    const order = transactionResult.order;
    this.realtime?.publishOrderChanged?.(
      order.id,
      [order.clientId, order.providerId],
      "created",
    );
    return {
      data: this.toResponse(order),
      message: `${service.provider.displayName} has been notified.`,
    };
  }

  private findByClientRequestId(clientId: string, clientRequestId: string) {
    return this.prisma.order.findUnique({
      where: { clientId_clientRequestId: { clientId, clientRequestId } },
      include: this.orderInclude,
    });
  }

  private idempotentOrderResponse(order: any, requestFingerprint: string) {
    if (order.requestFingerprint !== requestFingerprint)
      throw new ConflictException(
        "This request identifier was already used for different order details",
      );
    return {
      data: this.toResponse(order),
      message: "This service request was already received.",
    };
  }

  async list(
    userId: string,
    scope: "client" | "provider",
    view: "active" | "archived" = "active",
    cursor?: string,
    limit = 20,
  ) {
    await this.reconcileExpiredReviewsForUser(userId);
    const baseWhere =
      scope === "provider"
        ? {
            providerId: userId,
            providerRemovedAt: null,
            providerArchivedAt: view === "archived" ? { not: null } : null,
          }
        : {
            clientId: userId,
            clientRemovedAt: null,
            clientArchivedAt: view === "archived" ? { not: null } : null,
          };
    const decodedCursor = cursor ? decodeOrderCursor(cursor) : null;
    const orders = await this.prisma.order.findMany({
      where: decodedCursor
        ? {
            AND: [
              baseWhere,
              {
                OR: [
                  { createdAt: { lt: decodedCursor.createdAt } },
                  {
                    createdAt: decodedCursor.createdAt,
                    id: { lt: decodedCursor.id },
                  },
                ],
              },
            ],
          }
        : baseWhere,
      include: this.orderInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const hasMore = orders.length > limit;
    const page = hasMore ? orders.slice(0, limit) : orders;
    const last = page.at(-1);
    return {
      data: page.map((order) => this.toResponse(order)),
      pagination: {
        hasMore,
        nextCursor:
          hasMore && last
            ? encodeOrderCursor({ createdAt: last.createdAt, id: last.id })
            : null,
      },
    };
  }

  async updateVisibility(
    userId: string,
    orderId: string,
    action: "archive" | "restore" | "remove",
  ) {
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        OR: [{ clientId: userId }, { providerId: userId }],
      },
      select: { id: true, status: true, clientId: true, providerId: true },
    });
    if (!order) throw new NotFoundException("Order not found");
    if (order.status !== "COMPLETED") {
      throw new ConflictException(
        "Only completed orders can be archived or removed",
      );
    }

    const client = order.clientId === userId;
    const now = new Date();
    const where = client
      ? {
          id: orderId,
          clientId: userId,
          status: "COMPLETED" as const,
          clientRemovedAt: null,
          ...(action === "restore" ? { clientArchivedAt: { not: null } } : {}),
        }
      : {
          id: orderId,
          providerId: userId,
          status: "COMPLETED" as const,
          providerRemovedAt: null,
          ...(action === "restore"
            ? { providerArchivedAt: { not: null } }
            : {}),
        };
    const data = client
      ? action === "archive"
        ? { clientArchivedAt: now }
        : action === "restore"
          ? { clientArchivedAt: null }
          : { clientRemovedAt: now }
      : action === "archive"
        ? { providerArchivedAt: now }
        : action === "restore"
          ? { providerArchivedAt: null }
          : { providerRemovedAt: now };
    const changed = await this.prisma.order.updateMany({ where, data });
    if (changed.count !== 1) {
      throw new ConflictException(
        "This order is no longer available in your list",
      );
    }
    return {
      data: {
        id: orderId,
        view:
          action === "archive"
            ? "archived"
            : action === "restore"
              ? "active"
              : "removed",
      },
    };
  }

  async findOne(userId: string, orderId: string) {
    await this.reconcileExpiredReviewForParticipant(userId, orderId);
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
      await this.lockProviderWorkload(database, providerId);
      const current = await database.order.findFirst({
        where: { id: order.id, providerId },
        select: { status: true },
      });
      if (current?.status !== "REQUESTED")
        throw new ConflictException("This request has already been decided");
      const profile = await database.providerProfile.findUnique({
        where: { userId: providerId },
        select: { maxActiveOrders: true },
      });
      if (!profile)
        throw new ConflictException("Complete your provider profile first");
      const activeOrders = await database.order.count({
        where: { providerId, status: { in: [...activeOrderStatuses] } },
      });
      if (activeOrders >= profile.maxActiveOrders)
        throw new ConflictException(
          `You have reached your limit of ${profile.maxActiveOrders} active orders. Complete an active order before accepting another request.`,
        );
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
    this.realtime?.publishOrderChanged?.(
      updated.id,
      [updated.clientId, updated.providerId],
      "accepted",
    );
    return {
      data: this.toResponse(updated),
      message: "Request accepted and the client has been notified.",
    };
  }

  private async lockProviderWorkload(
    database: Prisma.TransactionClient,
    providerId: string,
  ) {
    await database.$queryRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${providerId}::text, 0)) IS NULL AS "locked"`,
    );
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
    this.realtime?.publishOrderChanged?.(
      updated.id,
      [updated.clientId, updated.providerId],
      "rejected",
    );
    return {
      data: this.toResponse(updated),
      message: "Request declined and the client has been notified.",
    };
  }

  async cancel(clientId: string, orderId: string, reason: string) {
    const order = await this.requireClientOrder(clientId, orderId);
    if (order.status !== "REQUESTED")
      throw new ConflictException("Only a pending request can be cancelled");
    const note = reason.trim();
    const updated = await this.prisma.$transaction(async (database) => {
      const changed = await database.order.updateMany({
        where: { id: order.id, clientId, status: "REQUESTED" },
        data: { status: "CANCELLED" },
      });
      if (changed.count !== 1)
        throw new ConflictException("This request has already been updated");
      await database.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: "REQUESTED",
          toStatus: "CANCELLED",
          changedBy: clientId,
          note,
        },
      });
      await database.notification.create({
        data: {
          orderId: order.id,
          recipientId: order.providerId,
          type: "ORDER_CANCELLED",
          title: "Service request cancelled",
          body: `The client cancelled the request for ${order.titleSnapshot}. Reason: ${note}`,
        },
      });
      return database.order.findUniqueOrThrow({
        where: { id: order.id },
        include: this.orderInclude,
      });
    });
    this.realtime?.publishOrderChanged?.(
      updated.id,
      [updated.clientId, updated.providerId],
      "cancelled",
    );
    return {
      data: this.toResponse(updated),
      message: "Request cancelled and the provider has been notified.",
    };
  }

  async start(providerId: string, orderId: string) {
    const order = await this.requireProviderOrder(providerId, orderId);
    if (order.status !== "ACCEPTED")
      throw new ConflictException("Only an accepted order can be started");
    await this.requirePaidOrder(
      order.id,
      "Wait for the client payment to be confirmed before starting work",
    );
    const updated = await this.prisma.$transaction(async (database) => {
      await lockOrderReview(database, order.id);
      const changed = await database.order.updateMany({
        where: {
          id: order.id,
          providerId,
          status: "ACCEPTED",
          payments: { some: { status: "PAID" } },
        },
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
    this.realtime?.publishOrderChanged?.(
      updated.id,
      [updated.clientId, updated.providerId],
      "started",
    );
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
    clientRequestId?: string,
  ) {
    const order = await this.requireProviderOrder(providerId, orderId);
    const existingRequest = clientRequestId
      ? await this.prisma.deliverySubmission.findUnique({
          where: { orderId_clientRequestId: { orderId, clientRequestId } },
          select: { id: true },
        })
      : null;
    if (
      !existingRequest &&
      !(["IN_PROGRESS", "REVISION_REQUESTED"] as string[]).includes(
        order.status,
      )
    )
      throw new ConflictException(
        "Only active work or a requested revision can be submitted",
      );
    if (!files.length)
      throw new BadRequestException("Attach at least one deliverable file");
    if (!existingRequest)
      await this.requirePaidOrder(
        order.id,
        "Payment must be confirmed before deliverables can be submitted",
      );
    const submittedNote = note.trim();
    const stored = await this.storage.persistEvidenceUploads(
      "order-files",
      files,
    );
    const evidence = files.map((file, index) => ({
      storagePath: stored[index].storagePath,
      originalName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      checksum: stored[index].checksum,
    }));
    const requestFingerprint = clientRequestId
      ? deliveryRequestFingerprint(submittedNote, evidence)
      : null;
    let transactionResult: {
      order: any;
      submission: { version: number };
      created: boolean;
    };
    try {
      transactionResult = await this.prisma.$transaction(async (database) => {
        await lockOrderReview(database, orderId);
        if (clientRequestId) {
          const existing = await database.deliverySubmission.findUnique({
            where: { orderId_clientRequestId: { orderId, clientRequestId } },
            select: { version: true, requestFingerprint: true },
          });
          if (existing) {
            if (existing.requestFingerprint !== requestFingerprint)
              throw new ConflictException(
                "This request identifier was already used for different delivery content",
              );
            return {
              order: await database.order.findUniqueOrThrow({
                where: { id: orderId },
                include: this.orderInclude,
              }),
              submission: existing,
              created: false,
            };
          }
        }
        const current = await database.order.findFirst({
          where: { id: orderId, providerId },
          select: {
            status: true,
            clientId: true,
            titleSnapshot: true,
            provider: { select: { displayName: true } },
            payments: {
              where: { status: "PAID" },
              select: { id: true },
              take: 1,
            },
            revisions: {
              where: { status: "OPEN" },
              select: {
                id: true,
                type: true,
                revisionDeadlineAt: true,
                purchase: {
                  select: {
                    id: true,
                    paymentStatus: true,
                    activationStatus: true,
                  },
                },
              },
            },
            disputes: {
              where: { status: { in: [...ACTIVE_DISPUTE_STATUSES] } },
              select: { id: true },
            },
          },
        });
        if (!current) throw new NotFoundException("Order request not found");
        if (
          !(["IN_PROGRESS", "REVISION_REQUESTED"] as string[]).includes(
            current.status,
          )
        )
          throw new ConflictException(
            "Only active work or a requested revision can be submitted",
          );
        if (!current.payments.length)
          throw new ConflictException(
            "Payment must be confirmed before deliverables can be submitted",
          );
        if (current.disputes.length)
          throw new ConflictException(
            "An active dispute blocks delivery resubmission",
          );
        const fromStatus = current.status;
        const activeRevision =
          fromStatus === "REVISION_REQUESTED" ? current.revisions[0] : null;
        if (
          fromStatus === "REVISION_REQUESTED" &&
          (current.revisions.length !== 1 || !activeRevision)
        )
          throw new ConflictException(
            "The active revision request cannot be identified safely",
          );
        if (
          activeRevision?.type === "PAID_EXTRA" &&
          (activeRevision.purchase?.paymentStatus !== "PAID" ||
            activeRevision.purchase.activationStatus !== "ACTIVATED")
        )
          throw new ConflictException(
            "The paid extra revision is not authoritatively active",
          );
        const latest = await database.deliverySubmission.findFirst({
          where: { orderId },
          orderBy: { version: "desc" },
          select: { version: true },
        });
        const version = (latest?.version ?? 0) + 1;
        const submission = await database.deliverySubmission.create({
          data: {
            orderId,
            providerId,
            version,
            note: submittedNote,
            clientRequestId: clientRequestId ?? null,
            requestFingerprint,
            revisionRequestId: activeRevision?.id ?? null,
          },
          select: { id: true, version: true, submittedAt: true },
        });
        const reviewWindow = orderReviewWindow(submission.submittedAt);
        const purpose =
          fromStatus === "REVISION_REQUESTED" ? "REVISION" : "DELIVERABLE";
        const changed = await database.order.updateMany({
          where: {
            id: orderId,
            providerId,
            status: fromStatus,
            payments: { some: { status: "PAID" } },
          },
          data: {
            status: "SUBMITTED",
            submittedAt: submission.submittedAt,
            reviewPolicyVersion: orderReviewPolicyVersion,
            reviewStartedAt: reviewWindow.reviewStartedAt,
            reviewDeadlineAt: reviewWindow.reviewDeadlineAt,
            reviewDeliverySubmissionId: submission.id,
            completionSource: null,
          },
        });
        if (changed.count !== 1)
          throw new ConflictException(
            "This order changed before the delivery was submitted",
          );
        await database.orderFile.createMany({
          data: evidence.map((file) => ({
            orderId,
            deliverySubmissionId: submission.id,
            uploadedBy: providerId,
            purpose,
            storagePath: file.storagePath,
            originalName: file.originalName,
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
            checksum: file.checksum,
          })),
        });
        if (activeRevision)
          await database.revisionRequest.updateMany({
            where: { id: activeRevision.id, orderId, status: "OPEN" },
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
            body: `${current.provider.displayName} submitted delivery version ${version} for ${current.titleSnapshot}.`,
          },
        });
        return {
          order: await database.order.findUniqueOrThrow({
            where: { id: orderId },
            include: this.orderInclude,
          }),
          submission,
          created: true,
        };
      });
    } catch (error) {
      await Promise.all(
        stored.map(({ storagePath }) =>
          this.storage.delete("order-files", storagePath),
        ),
      );
      throw error;
    }
    if (!transactionResult.created) {
      await Promise.all(
        stored.map(({ storagePath }) =>
          this.storage.delete("order-files", storagePath),
        ),
      );
      return {
        data: this.toResponse(transactionResult.order),
        message: `Delivery version ${transactionResult.submission.version} was already received.`,
      };
    }
    const updated = transactionResult.order;
    this.realtime?.publishOrderChanged?.(
      updated.id,
      [updated.clientId, updated.providerId],
      "submitted",
    );
    return {
      data: this.toResponse(updated),
      message: `Delivery version ${transactionResult.submission.version} submitted and the client has been notified.`,
    };
  }

  async requestRevision(
    clientId: string,
    orderId: string,
    instructions: string,
  ) {
    const note = instructions.trim();
    const updated = await this.prisma.$transaction(async (database) => {
      await lockOrderReview(database, orderId);
      const order = await database.order.findFirst({
        where: { id: orderId, clientId },
        select: {
          id: true,
          status: true,
          providerId: true,
          titleSnapshot: true,
          pricingModel: true,
          deliveryDurationMinutes: true,
          termsSnapshot: true,
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
          payments: {
            where: { status: "PAID" },
            take: 2,
            select: {
              id: true,
              refundedCentavos: true,
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
          "A revision can only be requested for submitted work",
        );
      if (order.revisionsUsed >= order.revisionLimit)
        throw new ConflictException(
          "Included revisions are exhausted. Request an extra revision quote instead.",
        );
      const now = new Date();
      this.assertActionableRevisionReview(order, now);
      const turnaroundMinutes = this.revisionTurnaroundForOrder(order);
      const latestSequence = await database.revisionRequest.findFirst({
        where: { orderId },
        orderBy: { sequenceNumber: "desc" },
        select: { sequenceNumber: true },
      });
      const sequenceNumber = (latestSequence?.sequenceNumber ?? 0) + 1;
      const deadline = revisionDeadlineAt(now, turnaroundMinutes);
      const changed = await database.order.updateMany({
        where: {
          id: orderId,
          clientId,
          status: "SUBMITTED",
          revisionsUsed: order.revisionsUsed,
        },
        data: {
          status: "REVISION_REQUESTED",
          revisionsUsed: { increment: 1 },
          reviewPolicyVersion: null,
          reviewStartedAt: null,
          reviewDeadlineAt: null,
          reviewDeliverySubmissionId: null,
        },
      });
      if (changed.count !== 1)
        throw new ConflictException("This delivery has already been reviewed");
      await database.revisionRequest.create({
        data: {
          orderId,
          requestedBy: clientId,
          sequenceNumber,
          type: "INCLUDED",
          instructions: note,
          sourceDeliverySubmissionId: order.reviewDeliverySubmissionId,
          revisionDeadlineAt: deadline,
          turnaroundMinutes,
          createdAt: now,
        },
      });
      await database.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: "SUBMITTED",
          toStatus: "REVISION_REQUESTED",
          changedBy: clientId,
          note: `Included revision ${sequenceNumber}: ${note}`,
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
    this.realtime?.publishOrderChanged?.(
      updated.id,
      [updated.clientId, updated.providerId],
      "revision-requested",
    );
    return {
      data: this.toResponse(updated),
      message: "Revision requested and the provider has been notified.",
    };
  }

  async requestProviderCorrection(
    clientId: string,
    orderId: string,
    instructions: string,
  ) {
    const note = instructions.trim();
    const revision = await this.prisma.$transaction(async (database) => {
      await lockOrderReview(database, orderId);
      const order = await database.order.findFirst({
        where: { id: orderId, clientId },
        select: {
          id: true,
          status: true,
          providerId: true,
          titleSnapshot: true,
          pricingModel: true,
          deliveryDurationMinutes: true,
          termsSnapshot: true,
          reviewPolicyVersion: true,
          reviewDeadlineAt: true,
          reviewDeliverySubmissionId: true,
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
              refundedCentavos: true,
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
      const now = new Date();
      this.assertActionableRevisionReview(order, now);
      const existingClaim = await database.revisionRequest.findFirst({
        where: {
          orderId,
          sourceDeliverySubmissionId: order.reviewDeliverySubmissionId,
          type: "PROVIDER_CORRECTION",
        },
        select: { id: true },
      });
      if (existingClaim)
        throw new ConflictException(
          "A provider-correction claim was already recorded for this delivery",
        );
      const latestSequence = await database.revisionRequest.findFirst({
        where: { orderId },
        orderBy: { sequenceNumber: "desc" },
        select: { sequenceNumber: true },
      });
      const created = await database.revisionRequest.create({
        data: {
          orderId,
          requestedBy: clientId,
          sequenceNumber: (latestSequence?.sequenceNumber ?? 0) + 1,
          type: "PROVIDER_CORRECTION",
          instructions: note,
          status: "AWAITING_PROVIDER_ACKNOWLEDGEMENT",
          sourceDeliverySubmissionId: order.reviewDeliverySubmissionId,
          turnaroundMinutes: this.revisionTurnaroundForOrder(order),
          createdAt: now,
        },
      });
      await database.notification.create({
        data: {
          orderId,
          recipientId: order.providerId,
          type: "PROVIDER_CORRECTION_REVIEW",
          title: "Correction acknowledgement requested",
          body: `The client says the delivery for ${order.titleSnapshot} does not match the original requirements. Review and acknowledge or decline the correction request.`,
        },
      });
      return { created, providerId: order.providerId };
    });
    this.realtime?.publishOrderChanged?.(
      orderId,
      [clientId, revision.providerId],
      "correction-claimed",
    );
    return {
      data: revision.created,
      message:
        "Correction claim recorded. It becomes a free provider correction only if the provider acknowledges it; otherwise you may open a dispute.",
    };
  }

  async decideProviderCorrection(
    providerId: string,
    orderId: string,
    revisionId: string,
    accepted: boolean,
  ) {
    const result = await this.prisma.$transaction(async (database) => {
      await lockOrderReview(database, orderId);
      const revision = await database.revisionRequest.findFirst({
        where: {
          id: revisionId,
          orderId,
          type: "PROVIDER_CORRECTION",
          status: "AWAITING_PROVIDER_ACKNOWLEDGEMENT",
          order: { providerId },
        },
        include: {
          order: {
            select: {
              id: true,
              clientId: true,
              providerId: true,
              titleSnapshot: true,
              status: true,
              reviewPolicyVersion: true,
              reviewDeadlineAt: true,
              reviewDeliverySubmissionId: true,
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
                  refundedCentavos: true,
                  refunds: {
                    where: { status: "SUCCEEDED" },
                    select: { id: true },
                  },
                },
              },
              revisions: {
                where: { status: "OPEN" },
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
      if (!revision) throw new NotFoundException("Correction claim not found");
      const now = new Date();
      if (!accepted) {
        const declined = await database.revisionRequest.update({
          where: { id: revision.id },
          data: { status: "DECLINED", declinedAt: now },
        });
        await database.notification.create({
          data: {
            orderId,
            recipientId: revision.order.clientId,
            type: "PROVIDER_CORRECTION_DECLINED",
            title: "Correction claim was not acknowledged",
            body: `The provider did not acknowledge the correction claim for ${revision.order.titleSnapshot}. You may use the dispute path if the original requirements were not met.`,
          },
        });
        return {
          revision: declined,
          accepted: false,
          clientId: revision.order.clientId,
        };
      }
      this.assertActionableRevisionReview(revision.order, now);
      if (
        revision.sourceDeliverySubmissionId !==
        revision.order.reviewDeliverySubmissionId
      )
        throw new ConflictException(
          "This correction claim targets an older delivery",
        );
      const deadline = revisionDeadlineAt(now, revision.turnaroundMinutes ?? 0);
      const changed = await database.order.updateMany({
        where: {
          id: orderId,
          providerId,
          status: "SUBMITTED",
          reviewDeliverySubmissionId: revision.sourceDeliverySubmissionId,
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
        throw new ConflictException("This delivery has already changed");
      const acknowledged = await database.revisionRequest.update({
        where: { id: revision.id },
        data: {
          status: "OPEN",
          providerAcknowledgedAt: now,
          revisionDeadlineAt: deadline,
        },
      });
      await database.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: "SUBMITTED",
          toStatus: "REVISION_REQUESTED",
          changedBy: providerId,
          note: `Provider acknowledged correction ${revision.sequenceNumber}: ${revision.instructions}`,
        },
      });
      await database.notification.create({
        data: {
          orderId,
          recipientId: revision.order.clientId,
          type: "PROVIDER_CORRECTION_ACKNOWLEDGED",
          title: "Provider correction acknowledged",
          body: `The provider acknowledged the correction for ${revision.order.titleSnapshot}. No included revision or payment was used.`,
        },
      });
      return {
        revision: acknowledged,
        accepted: true,
        clientId: revision.order.clientId,
      };
    });
    this.realtime?.publishOrderChanged?.(
      orderId,
      [providerId, result.clientId],
      "correction-decided",
    );
    return {
      data: result.revision,
      message: result.accepted
        ? "Correction acknowledged. Submit corrected work by the revision deadline."
        : "Correction claim declined. The client may use the dispute path.",
    };
  }

  async complete(clientId: string, orderId: string) {
    const result = await this.completeReviewedOrder(
      orderId,
      "CLIENT_ACCEPTED",
      clientId,
      new Date(),
    );
    const updated = result.order;
    if (result.transitioned) this.publishCompletion(updated);
    return {
      data: this.toResponse(updated),
      message:
        updated.completionSource === "AUTO_REVIEW_TIMEOUT"
          ? "This order was already completed after the review period."
          : "Delivery accepted. You can now review the provider.",
    };
  }

  async reconcileExpiredReview(orderId: string, now = new Date()) {
    const result = await this.completeReviewedOrder(
      orderId,
      "AUTO_REVIEW_TIMEOUT",
      null,
      now,
    );
    if (result.transitioned) this.publishCompletion(result.order);
    return result;
  }

  async expiredReviewOrderIds(now = new Date(), limit = 25) {
    const boundedLimit = Math.min(Math.max(limit, 1), 100);
    const rows = await this.prisma.order.findMany({
      where: {
        status: "SUBMITTED",
        reviewPolicyVersion: orderReviewPolicyVersion,
        reviewDeadlineAt: { lte: now },
        reviewDeliverySubmissionId: { not: null },
        revisions: { none: { status: "OPEN" } },
        disputes: { none: { status: { in: [...ACTIVE_DISPUTE_STATUSES] } } },
      },
      select: { id: true },
      orderBy: [{ reviewDeadlineAt: "asc" }, { id: "asc" }],
      take: boundedLimit,
    });
    return rows.map(({ id }) => id);
  }

  async reconcileExpiredReviewsForProvider(
    providerId: string,
    now = new Date(),
  ) {
    return this.reconcileExpiredReviewsForParticipant({ providerId }, now, 25);
  }

  private async reconcileExpiredReviewsForUser(
    userId: string,
    now = new Date(),
  ) {
    return this.reconcileExpiredReviewsForParticipant(
      { OR: [{ clientId: userId }, { providerId: userId }] },
      now,
      25,
    );
  }

  private async reconcileExpiredReviewForParticipant(
    userId: string,
    orderId: string,
    now = new Date(),
  ) {
    const row = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        OR: [{ clientId: userId }, { providerId: userId }],
        status: "SUBMITTED",
        reviewPolicyVersion: orderReviewPolicyVersion,
        reviewDeadlineAt: { lte: now },
        reviewDeliverySubmissionId: { not: null },
        revisions: { none: { status: "OPEN" } },
        disputes: { none: { status: { in: [...ACTIVE_DISPUTE_STATUSES] } } },
      },
      select: { id: true },
    });
    if (row) await this.reconcileExpiredReview(row.id, now);
  }

  private async reconcileExpiredReviewsForParticipant(
    participantWhere: Prisma.OrderWhereInput,
    now: Date,
    limit: number,
  ) {
    const rows = await this.prisma.order.findMany({
      where: {
        ...participantWhere,
        status: "SUBMITTED",
        reviewPolicyVersion: orderReviewPolicyVersion,
        reviewDeadlineAt: { lte: now },
        reviewDeliverySubmissionId: { not: null },
        revisions: { none: { status: "OPEN" } },
        disputes: { none: { status: { in: [...ACTIVE_DISPUTE_STATUSES] } } },
      },
      select: { id: true },
      orderBy: [{ reviewDeadlineAt: "asc" }, { id: "asc" }],
      take: limit,
    });
    for (const row of rows) await this.reconcileExpiredReview(row.id, now);
    return rows.length;
  }

  private async completeReviewedOrder(
    orderId: string,
    source: OrderCompletionSource,
    clientId: string | null,
    completedAt: Date,
  ) {
    return this.prisma.$transaction(async (database) => {
      await lockOrderReview(database, orderId);
      const order = await database.order.findFirst({
        where: clientId ? { id: orderId, clientId } : { id: orderId },
        include: {
          provider: { select: { displayName: true } },
          payments: {
            where: { status: "PAID" },
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
          deliverySubmissions: {
            orderBy: { version: "desc" },
            take: 1,
            select: { id: true, version: true, submittedAt: true },
          },
          revisions: {
            where: { status: "OPEN" },
            select: { id: true },
          },
          disputes: {
            where: { status: { in: [...ACTIVE_DISPUTE_STATUSES] } },
            select: { id: true },
          },
          providerEarnings: {
            include: {
              ledgerEntries: {
                orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              },
              revisionPurchase: {
                include: {
                  revisionRequest: {
                    include: {
                      deliveredSubmission: {
                        select: { id: true, version: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });
      if (!order) throw new NotFoundException("Order not found");

      if (order.status === "COMPLETED" && order.completionSource) {
        this.assertReleasedEarning(order);
        return {
          order: await database.order.findUniqueOrThrow({
            where: { id: orderId },
            include: this.orderInclude,
          }),
          transitioned: false,
        };
      }
      if (order.status !== "SUBMITTED")
        throw new ConflictException("Only submitted work can be accepted");

      if (order.reviewPolicyVersion !== orderReviewPolicyVersion) {
        if (source !== "CLIENT_ACCEPTED" || !clientId)
          throw new ConflictException(
            "This historical delivery is not enrolled in automatic review",
          );
        return this.completeLegacySubmittedOrder(
          database,
          order,
          clientId,
          completedAt,
        );
      }

      const latestDelivery = order.deliverySubmissions[0];
      if (
        !latestDelivery ||
        !order.reviewStartedAt ||
        !order.reviewDeadlineAt ||
        !order.reviewDeliverySubmissionId ||
        latestDelivery.id !== order.reviewDeliverySubmissionId ||
        latestDelivery.submittedAt.getTime() !== order.reviewStartedAt.getTime()
      )
        throw new ConflictException(
          "The active delivery review does not match the latest submission",
        );
      if (
        source === "AUTO_REVIEW_TIMEOUT" &&
        !isOrderReviewExpired(order.reviewDeadlineAt, completedAt)
      )
        throw new ConflictException(
          "The delivery review period is still active",
        );
      if (order.revisions.length)
        throw new ConflictException("An unresolved revision blocks completion");
      if (order.disputes.length)
        throw new ConflictException("An active dispute blocks completion");

      const payment = order.payments[0];
      if (
        order.payments.length !== 1 ||
        !payment ||
        payment.refundedCentavos !== 0 ||
        payment.refunds.length
      )
        throw new ConflictException(
          "A confirmed, unreimbursed payment is required before completion",
        );
      const originalEarnings = order.providerEarnings.filter(
        (earning) => earning.sourceType === "ORIGINAL_ORDER",
      );
      const originalEarning = originalEarnings[0];
      if (
        originalEarnings.length !== 1 ||
        !originalEarning ||
        originalEarning.paymentId !== payment.id
      )
        throw new InternalServerErrorException(
          "Provider earning is missing or does not match the paid order",
        );
      const principal = providerEarningPrincipal(order, payment);
      const earningsToRelease = [
        originalEarning,
        ...order.providerEarnings.filter((earning) => {
          if (earning.sourceType !== "PAID_EXTRA_REVISION") return false;
          const purchase = earning.revisionPurchase;
          const delivered = purchase?.revisionRequest?.deliveredSubmission;
          if (
            !purchase ||
            purchase.paymentStatus !== "PAID" ||
            purchase.activationStatus !== "ACTIVATED" ||
            purchase.revisionRequest?.status !== "RESOLVED" ||
            !delivered ||
            delivered.version > latestDelivery.version
          )
            throw new InternalServerErrorException(
              "Paid revision earning is not tied to a completed revision delivery",
            );
          return true;
        }),
      ];
      for (const earning of earningsToRelease) {
        const pendingCredits = earning.ledgerEntries.filter(
          (entry) => entry.type === "EARNING_PENDING_CREDIT",
        );
        const releaseEvents = earning.ledgerEntries.filter(
          (entry) => entry.type === "EARNING_AVAILABLE_RELEASE",
        );
        const expectedAmount =
          earning.sourceType === "ORIGINAL_ORDER"
            ? principal.amountCentavos
            : earning.revisionPurchase!.providerSubtotalCentavos;
        const expectedCurrency =
          earning.sourceType === "ORIGINAL_ORDER"
            ? principal.currency
            : earning.revisionPurchase!.currency;
        if (
          earning.status !== "PENDING" ||
          earning.availableAt ||
          earning.grossServiceAmountCentavos !== expectedAmount ||
          earning.currency !== expectedCurrency ||
          pendingCredits.length !== 1 ||
          pendingCredits[0].amountCentavos !== expectedAmount ||
          pendingCredits[0].currency !== expectedCurrency ||
          releaseEvents.length !== 0
        )
          throw new InternalServerErrorException(
            "Provider earning cannot be reconciled for release",
          );
      }

      const changed = await database.order.updateMany({
        where: {
          id: orderId,
          status: "SUBMITTED",
          reviewPolicyVersion: orderReviewPolicyVersion,
          reviewDeliverySubmissionId: latestDelivery.id,
          reviewStartedAt: order.reviewStartedAt,
          reviewDeadlineAt: order.reviewDeadlineAt,
        },
        data: {
          status: "COMPLETED",
          completedAt,
          completionSource: source,
        },
      });
      if (changed.count !== 1)
        throw new ConflictException("This delivery has already been reviewed");
      for (const earning of earningsToRelease) {
        const earningChanged = await database.providerEarning.updateMany({
          where: { id: earning.id, status: "PENDING", availableAt: null },
          data: { status: "AVAILABLE", availableAt: completedAt },
        });
        if (earningChanged.count !== 1)
          throw new InternalServerErrorException(
            "Provider earning changed before it could be released",
          );
        await database.providerEarningLedgerEntry.create({
          data: {
            providerEarningId: earning.id,
            providerId: earning.providerId,
            orderId,
            sourcePaymentId: null,
            sourceRevisionPurchaseId: null,
            type: "EARNING_AVAILABLE_RELEASE",
            amountCentavos: 0,
            currency: earning.currency,
            sourceKey: earningAvailableReleaseSourceKey(earning.id),
            createdAt: completedAt,
          },
        });
      }
      await database.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: "SUBMITTED",
          toStatus: "COMPLETED",
          changedBy: source === "CLIENT_ACCEPTED" ? clientId : null,
          note:
            source === "CLIENT_ACCEPTED"
              ? "Client accepted the delivery"
              : "CampusGig completed the order after the 48-hour review period",
        },
      });
      await database.studentProfile.update({
        where: { userId: order.providerId },
        data: { completedOrderCount: { increment: 1 } },
      });
      await database.notification.createMany({
        data:
          source === "CLIENT_ACCEPTED"
            ? [
                {
                  orderId,
                  recipientId: order.providerId,
                  type: "ORDER_COMPLETED",
                  title: "Delivery accepted",
                  body: `The client accepted your delivery for ${order.titleSnapshot}. Your earning is now available in CampusGig.`,
                },
              ]
            : [
                {
                  orderId,
                  recipientId: order.providerId,
                  type: "ORDER_AUTO_COMPLETED",
                  title: "Review period completed",
                  body: `${order.titleSnapshot} was completed after the 48-hour review period. Your earning is now available in CampusGig.`,
                },
                {
                  orderId,
                  recipientId: order.clientId,
                  type: "ORDER_AUTO_COMPLETED",
                  title: "Order completed automatically",
                  body: `${order.titleSnapshot} was completed after the 48-hour review period.`,
                },
              ],
      });
      return {
        order: await database.order.findUniqueOrThrow({
          where: { id: orderId },
          include: this.orderInclude,
        }),
        transitioned: true,
      };
    });
  }

  private async completeLegacySubmittedOrder(
    database: Prisma.TransactionClient,
    order: any,
    clientId: string,
    completedAt: Date,
  ) {
    if (!order.payments.length)
      throw new ConflictException(
        "Payment must be confirmed before the delivery can be accepted",
      );
    const changed = await database.order.updateMany({
      where: {
        id: order.id,
        clientId,
        status: "SUBMITTED",
        reviewPolicyVersion: null,
        payments: { some: { status: "PAID" } },
      },
      data: { status: "COMPLETED", completedAt },
    });
    if (changed.count !== 1)
      throw new ConflictException("This delivery has already been reviewed");
    await database.orderStatusHistory.create({
      data: {
        orderId: order.id,
        fromStatus: "SUBMITTED",
        toStatus: "COMPLETED",
        changedBy: clientId,
        note: "Client accepted the delivery",
      },
    });
    await database.studentProfile.update({
      where: { userId: order.providerId },
      data: { completedOrderCount: { increment: 1 } },
    });
    await database.notification.create({
      data: {
        orderId: order.id,
        recipientId: order.providerId,
        type: "ORDER_COMPLETED",
        title: "Delivery accepted",
        body: `The client accepted your delivery for ${order.titleSnapshot}.`,
      },
    });
    return {
      order: await database.order.findUniqueOrThrow({
        where: { id: order.id },
        include: this.orderInclude,
      }),
      transitioned: true,
    };
  }

  private assertReleasedEarning(order: any) {
    if (order.reviewPolicyVersion !== orderReviewPolicyVersion) return;
    const earnings = order.providerEarnings ?? [];
    if (!earnings.length)
      throw new InternalServerErrorException(
        "Completed order earning release is inconsistent",
      );
    for (const earning of earnings) {
      const pendingCredits = earning.ledgerEntries.filter(
        (entry: any) => entry.type === "EARNING_PENDING_CREDIT",
      );
      const releaseEvents = earning.ledgerEntries.filter(
        (entry: any) => entry.type === "EARNING_AVAILABLE_RELEASE",
      );
      if (
        earning.status !== "AVAILABLE" ||
        !earning.availableAt ||
        pendingCredits.length !== 1 ||
        releaseEvents.length !== 1 ||
        releaseEvents[0].amountCentavos !== 0
      )
        throw new InternalServerErrorException(
          "Completed order earning release is inconsistent",
        );
    }
  }

  private publishCompletion(order: any) {
    this.realtime?.publishProviderStats(order.providerId, "completion");
    this.realtime?.publishOrderChanged?.(
      order.id,
      [order.clientId, order.providerId],
      "completed",
    );
  }

  async review(clientId: string, orderId: string, input: CreateReviewDto) {
    const order = await this.requireClientOrder(clientId, orderId);
    if (order.status !== "COMPLETED")
      throw new ConflictException("Complete the order before leaving a review");
    await this.requirePaidOrder(
      order.id,
      "Payment must be confirmed before the provider can be reviewed",
    );
    const review = await this.prisma
      .$transaction(async (database) => {
        await database.$queryRaw`
          SELECT "userId"
          FROM "StudentProfile"
          WHERE "userId" = ${order.providerId}::uuid
          FOR UPDATE
        `;
        const created = await database.review.create({
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
        });
        const aggregate = await database.review.aggregate({
          where: { revieweeId: order.providerId },
          _avg: { overallRating: true },
          _count: { _all: true },
        });
        await database.studentProfile.update({
          where: { userId: order.providerId },
          data: {
            ratingAverage: aggregate._avg.overallRating ?? 0,
            reviewCount: aggregate._count._all,
          },
        });
        await database.notification.create({
          data: {
            orderId,
            recipientId: order.providerId,
            type: "NEW_REVIEW",
            title: "You received a review",
            body: `The client rated ${order.titleSnapshot} ${input.overallRating} out of 5.`,
          },
        });
        return created;
      })
      .catch((error: { code?: string }) => {
        if (error.code === "P2002")
          throw new ConflictException("This order has already been reviewed");
        throw error;
      });
    this.realtime?.publishProviderStats(order.providerId, "review");
    this.realtime?.publishOrderChanged?.(
      order.id,
      [order.clientId, order.providerId],
      "reviewed",
    );
    return { data: review, message: "Thank you for reviewing the provider." };
  }

  async getFile(userId: string, orderId: string, fileId: string) {
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        OR: [{ clientId: userId }, { providerId: userId }],
      },
      select: { clientId: true, providerId: true },
    });
    if (!order) throw new NotFoundException("Order file not found");
    if (order.clientId === userId)
      await this.requirePaidOrder(
        orderId,
        "Payment must be confirmed before deliverables can be downloaded",
      );
    const file = await this.prisma.orderFile.findFirst({
      where: {
        id: fileId,
        orderId,
      },
      select: {
        storagePath: true,
        originalName: true,
        mimeType: true,
        deliverySubmissionId: true,
      },
    });
    if (!file) throw new NotFoundException("Order file not found");
    return file;
  }

  async recordDeliveryFileAccess(input: {
    orderId: string;
    deliverySubmissionId: string;
    fileId: string;
    userId: string;
  }) {
    const evidence = await this.prisma.orderFile.findFirst({
      where: {
        id: input.fileId,
        orderId: input.orderId,
        deliverySubmissionId: input.deliverySubmissionId,
        order: {
          OR: [{ clientId: input.userId }, { providerId: input.userId }],
        },
      },
      select: {
        deliverySubmission: {
          select: { orderId: true },
        },
      },
    });
    if (evidence?.deliverySubmission?.orderId !== input.orderId)
      throw new NotFoundException("Order file not found");
    await this.prisma.deliveryFileAccessAudit.create({
      data: {
        orderId: input.orderId,
        deliverySubmissionId: input.deliverySubmissionId,
        fileId: input.fileId,
        userId: input.userId,
        accessType: "ACCESS_GRANTED",
      },
    });
  }

  private async requirePaidOrder(orderId: string, message: string) {
    const paid = await this.prisma.payment.findFirst({
      where: { orderId, status: "PAID" },
      select: { id: true },
    });
    if (!paid) throw new ConflictException(message);
  }

  private async requireProviderOrder(providerId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, providerId },
      include: { provider: { select: { displayName: true } } },
    });
    if (!order) throw new NotFoundException("Order request not found");
    return order;
  }

  private assertActionableRevisionReview(
    order: RevisionActionOrder,
    now: Date,
  ) {
    if (order.status !== "SUBMITTED")
      throw new ConflictException(
        "A revision can only be requested for submitted work",
      );
    const latestDelivery = order.deliverySubmissions[0];
    if (
      order.reviewPolicyVersion !== orderReviewPolicyVersion ||
      !order.reviewDeadlineAt ||
      !order.reviewDeliverySubmissionId ||
      !latestDelivery ||
      latestDelivery.id !== order.reviewDeliverySubmissionId
    )
      throw new ConflictException(
        "This delivery does not have an actionable Phase F review",
      );
    if (isOrderReviewExpired(order.reviewDeadlineAt, now))
      throw new ConflictException("The delivery review period has ended");
    if (
      order.payments.length !== 1 ||
      order.payments[0].refundedCentavos !== 0 ||
      order.payments[0].refunds.length
    )
      throw new ConflictException(
        "A confirmed, unreimbursed order payment is required",
      );
    if (order.revisions.length)
      throw new ConflictException("Another revision request is already active");
    if (order.disputes.length)
      throw new ConflictException("An active dispute blocks revision changes");
  }

  private revisionTurnaroundForOrder(order: {
    pricingModel?: string;
    deliveryDurationMinutes?: number | null;
    termsSnapshot?: unknown;
  }) {
    const duration =
      order.pricingModel === "SINGLE_PRICE_V2"
        ? order.deliveryDurationMinutes
        : (() => {
            const terms = legacyPackageTerms(order.termsSnapshot);
            return terms ? terms.deliveryDays * 24 * 60 : null;
          })();
    if (!Number.isSafeInteger(duration) || (duration ?? 0) <= 0)
      throw new ConflictException(
        "This order does not have trustworthy delivery-duration evidence for a revision deadline",
      );
    return revisionTurnaroundMinutes(duration!);
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
    client: {
      select: {
        id: true,
        displayName: true,
        avatarPath: true,
        updatedAt: true,
      },
    },
    provider: {
      select: {
        id: true,
        displayName: true,
        avatarPath: true,
        updatedAt: true,
      },
    },
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
        checksum: true,
        createdAt: true,
      },
    },
    deliverySubmissions: {
      orderBy: { version: "desc" as const },
      select: {
        id: true,
        providerId: true,
        version: true,
        note: true,
        revisionRequestId: true,
        submittedAt: true,
        createdAt: true,
        files: {
          orderBy: { createdAt: "asc" as const },
          select: {
            id: true,
            purpose: true,
            originalName: true,
            mimeType: true,
            sizeBytes: true,
            checksum: true,
            createdAt: true,
          },
        },
      },
    },
    revisions: {
      orderBy: { sequenceNumber: "asc" as const },
      select: {
        id: true,
        sequenceNumber: true,
        type: true,
        instructions: true,
        status: true,
        sourceDeliverySubmissionId: true,
        revisionDeadlineAt: true,
        turnaroundMinutes: true,
        providerAcknowledgedAt: true,
        declinedAt: true,
        createdAt: true,
        resolvedAt: true,
        purchase: {
          select: {
            id: true,
            providerSubtotalCentavos: true,
            platformFeeCentavos: true,
            totalCentavos: true,
            currency: true,
            turnaroundMinutes: true,
            pricingPolicyVersion: true,
            paymentStatus: true,
            activationStatus: true,
            paidAt: true,
            activatedAt: true,
          },
        },
      },
    },
    revisionPurchases: {
      orderBy: { createdAt: "desc" as const },
      select: {
        id: true,
        sourceDeliverySubmissionId: true,
        providerSubtotalCentavos: true,
        platformFeeCentavos: true,
        totalCentavos: true,
        currency: true,
        turnaroundMinutes: true,
        pricingPolicyVersion: true,
        paymentStatus: true,
        activationStatus: true,
        failureCode: true,
        paidAt: true,
        activatedAt: true,
        createdAt: true,
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
    payments: {
      orderBy: { createdAt: "desc" as const },
      take: 1,
      select: { status: true, paidAt: true },
    },
    disputes: {
      select: { status: true },
    },
  } as const;

  private toResponse(order: any) {
    const pricingModel = order.pricingModel ?? legacyOrderPricingModel;
    const immutablePackage =
      pricingModel === legacyOrderPricingModel
        ? legacyPackageTerms(order.termsSnapshot)
        : null;
    const legacyPackage = immutablePackage
      ? { ...order.servicePackage, ...immutablePackage }
      : order.servicePackage;
    const deliverySubmissions = (order.deliverySubmissions ?? []).map(
      (submission: any, index: number) => ({
        id: submission.id,
        providerId: submission.providerId,
        version: submission.version,
        note: submission.note,
        revisionRequestId: submission.revisionRequestId ?? null,
        submittedAt: submission.submittedAt,
        createdAt: submission.createdAt,
        isCurrent: index === 0,
        files: (submission.files ?? []).map((file: any) => ({
          id: file.id,
          purpose: file.purpose,
          originalName: file.originalName,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          sha256: file.checksum ?? null,
          createdAt: file.createdAt,
        })),
      }),
    );
    const hasBlockingDispute = (order.disputes ?? []).some((dispute: any) =>
      isActiveDisputeStatus(dispute.status),
    );
    const reviewState =
      order.reviewPolicyVersion !== orderReviewPolicyVersion
        ? null
        : order.status === "COMPLETED"
          ? "COMPLETED"
          : order.status === "SUBMITTED" && hasBlockingDispute
            ? "BLOCKED_BY_DISPUTE"
            : order.status === "SUBMITTED"
              ? "ACTIVE"
              : "SUPERSEDED";
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      title: order.titleSnapshot,
      status: order.status,
      pricingModel,
      termsSnapshotVersion:
        termsSnapshotVersion(order.termsSnapshot) ??
        legacyOrderTermsSnapshotVersion,
      requirements: order.requirements,
      subtotalCentavos: order.subtotalCentavos,
      platformFeeCentavos: order.platformFeeCentavos,
      totalCentavos: order.totalCentavos,
      currency: order.currency,
      dueAt: order.dueAt,
      reviewPolicyVersion: order.reviewPolicyVersion ?? null,
      reviewStartedAt: order.reviewStartedAt ?? null,
      reviewDeadlineAt: order.reviewDeadlineAt ?? null,
      reviewDeliverySubmissionId: order.reviewDeliverySubmissionId ?? null,
      reviewState,
      reviewActionable: reviewState === "ACTIVE",
      completionSource: order.completionSource ?? null,
      completedAt: order.completedAt ?? null,
      paymentConfirmedAt: order.payments?.[0]?.paidAt ?? null,
      basePriceCentavos: order.basePriceCentavos ?? null,
      rushSurchargeCentavos: order.rushSurchargeCentavos ?? null,
      deliveryOption: order.deliveryOption ?? null,
      deliveryDurationMinutes: order.deliveryDurationMinutes ?? null,
      pricingPolicyVersion: order.pricingPolicyVersion ?? null,
      platformFeeBasisPoints: order.platformFeeBasisPoints ?? null,
      rushBasisPoints: order.rushBasisPoints ?? null,
      createdAt: order.createdAt,
      revisionsUsed: order.revisionsUsed,
      revisionLimit: order.revisionLimit,
      files: (order.files ?? []).map((file: any) => ({
        id: file.id,
        purpose: file.purpose,
        originalName: file.originalName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        sha256: file.checksum ?? null,
        createdAt: file.createdAt,
      })),
      deliverySubmissions,
      currentDeliverySubmission: deliverySubmissions[0] ?? null,
      revisions: order.revisions ?? [],
      revisionPurchases: order.revisionPurchases ?? [],
      review: order.review ?? null,
      paymentStatus: order.payments?.[0]?.status ?? null,
      client: {
        id: order.client.id,
        displayName: order.client.displayName,
        hasAvatar: Boolean(order.client.avatarPath),
        avatarVersion: order.client.updatedAt?.getTime?.() ?? 0,
      },
      provider: {
        id: order.provider.id,
        displayName: order.provider.displayName,
        hasAvatar: Boolean(order.provider.avatarPath),
        avatarVersion: order.provider.updatedAt?.getTime?.() ?? 0,
      },
      package:
        pricingModel === legacyOrderPricingModel ? legacyPackage : undefined,
    };
  }

  private calculatePlatformFee(subtotalCentavos: number) {
    const basisPoints = Number(
      this.config.get<string>("PLATFORM_FEE_BASIS_POINTS") ?? "500",
    );
    const minimum = Number(
      this.config.get<string>("PLATFORM_FEE_MIN_CENTAVOS") ?? "0",
    );
    if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 3000)
      throw new BadRequestException("Platform fee configuration is invalid");
    if (!Number.isInteger(minimum) || minimum < 0)
      throw new BadRequestException("Platform fee minimum is invalid");
    if (basisPoints === 0) return 0;
    return Math.max(
      minimum,
      Math.ceil((subtotalCentavos * basisPoints) / 10_000),
    );
  }

  private deliveryOptionLabel(option: DeliveryOption) {
    switch (option) {
      case DeliveryOption.NORMAL:
        return "Normal delivery";
      case DeliveryOption.RUSH_24_HOURS:
        return "24-hour Rush";
      case DeliveryOption.RUSH_12_HOURS:
        return "12-hour Rush";
      case DeliveryOption.RUSH_6_HOURS:
        return "6-hour Rush";
      case DeliveryOption.RUSH_3_HOURS:
        return "3-hour Rush";
    }
  }
}
