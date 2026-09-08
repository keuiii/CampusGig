import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { ConflictException, ForbiddenException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { PaymongoClient } from "./paymongo.client";

@Injectable()
export class PaymentLedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymongo: PaymongoClient,
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

  async createCheckout(userId: string, orderId: string) {
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
    if (!["REQUESTED", "ACCEPTED"].includes(order.status))
      throw new ConflictException("This order is not awaiting payment");

    const existing = await this.prisma.payment.findFirst({
      where: { orderId, status: { in: ["PENDING", "REQUIRES_ACTION", "PAID"] } },
      orderBy: { createdAt: "desc" },
    });
    if (existing?.status === "PAID")
      throw new ConflictException("This order has already been paid");
    if (existing?.checkoutUrl)
      return { data: this.publicPayment(existing), checkoutUrl: existing.checkoutUrl };

    const payment = existing ?? await this.createPending(orderId, `checkout:${orderId}:${randomUUID()}`);
    const checkout = await this.paymongo.createCheckout({
      amountCentavos: payment.amountCentavos,
      orderNumber: order.orderNumber,
      title: order.titleSnapshot,
      customerName: order.client.displayName,
      customerEmail: order.client.email,
    });
    const updated = await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        providerCheckoutId: checkout.id,
        checkoutUrl: checkout.attributes.checkout_url,
        status: "REQUIRES_ACTION",
      },
    });
    return { data: this.publicPayment(updated), checkoutUrl: checkout.attributes.checkout_url };
  }

  async processWebhook(payload: PaymongoWebhookPayload) {
    if (!payload?.data?.id || payload.data.type !== "event" || !payload.data.attributes?.type)
      throw new BadRequestException("Invalid PayMongo webhook payload");
    if (payload.data.attributes.livemode)
      throw new BadRequestException("Live PayMongo events are disabled");
    const eventType = payload.data.attributes.type;
    const recorded = await this.recordWebhookOnce(payload.data.id, eventType, payload as unknown as Prisma.InputJsonValue);
    if (recorded.duplicate && recorded.event.processedAt)
      return { received: true, duplicate: true };
    try {
      if (eventType === "checkout_session.payment.paid") {
        const resource = payload.data.attributes.data;
        if (!resource?.id) throw new Error("PayMongo checkout resource is missing");
        const providerPaymentId = resource.attributes.payments?.[0]?.id;
        const providerAmount = resource.attributes.payments?.[0]?.attributes?.amount;
        const payment = await this.prisma.payment.findUnique({ where: { providerCheckoutId: resource.id } });
        if (!payment) throw new Error("Checkout session is not linked to a CampusGig payment");
        if (providerAmount != null && providerAmount !== payment.amountCentavos)
          throw new Error("PayMongo payment amount does not match the order ledger");
        const order = await this.prisma.order.findUniqueOrThrow({
          where: { id: payment.orderId },
          select: { clientId: true, providerId: true, titleSnapshot: true },
        });
        await this.prisma.$transaction(async (database) => {
          const changed = await database.payment.updateMany({
            where: { id: payment.id, status: { not: "PAID" } },
            data: { status: "PAID", providerPaymentId, paidAt: new Date() },
          });
          if (changed.count)
            await database.notification.createMany({
              data: [order.clientId, order.providerId].map((recipientId) => ({
                recipientId,
                orderId: payment.orderId,
                type: "ORDER_PAYMENT_RECEIVED",
                title: "Order payment confirmed",
                body: `Payment for ${order.titleSnapshot} was confirmed by PayMongo.`,
              })),
            });
          await database.paymentWebhookEvent.update({
            where: { id: recorded.event.id },
            data: { processedAt: new Date(), processingError: null },
          });
        });
      } else if (eventType === "payment.refunded") {
        const resource = payload.data.attributes.data;
        const payment = await this.prisma.payment.findUnique({
          where: { providerPaymentId: resource.id },
        });
        if (!payment) throw new Error("Refunded PayMongo payment is not linked to CampusGig");
        const refunds = resource.attributes.refunds ?? [];
        const refundedCentavos = refunds
          .filter((refund) => refund.attributes.status === "succeeded")
          .reduce((sum, refund) => sum + refund.attributes.amount, 0);
        if (refundedCentavos > payment.amountCentavos)
          throw new Error("Refund total exceeds the payment ledger amount");
        await this.prisma.$transaction(async (database) => {
          for (const refund of refunds) {
            await database.paymentRefund.upsert({
              where: { providerRefundId: refund.id },
              create: {
                paymentId: payment.id,
                providerRefundId: refund.id,
                idempotencyKey: `paymongo-refund:${refund.id}`,
                amountCentavos: refund.attributes.amount,
                reason: refund.attributes.reason || "PayMongo refund",
                status: refund.attributes.status === "succeeded" ? "SUCCEEDED" : refund.attributes.status === "failed" ? "FAILED" : "PENDING",
                processedAt: refund.attributes.status === "succeeded" ? new Date() : null,
              },
              update: {
                status: refund.attributes.status === "succeeded" ? "SUCCEEDED" : refund.attributes.status === "failed" ? "FAILED" : "PENDING",
                processedAt: refund.attributes.status === "succeeded" ? new Date() : null,
              },
            });
          }
          await database.payment.update({
            where: { id: payment.id },
            data: {
              refundedCentavos,
              status: refundedCentavos >= payment.amountCentavos ? "REFUNDED" : "PARTIALLY_REFUNDED",
            },
          });
          await database.paymentWebhookEvent.update({
            where: { id: recorded.event.id },
            data: { processedAt: new Date(), processingError: null },
          });
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
        data: { processingError: error instanceof Error ? error.message.slice(0, 1000) : "Unknown processing error" },
      });
      throw error;
    }
  }

  async createPending(orderId: string, idempotencyKey: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        totalCentavos: true,
        platformFeeCentavos: true,
        currency: true,
      },
    });
    if (!order) throw new NotFoundException("Order not found");
    if (order.totalCentavos <= 0)
      throw new BadRequestException("Payment amount must be positive");
    const providerNetCentavos =
      order.totalCentavos - order.platformFeeCentavos;
    if (providerNetCentavos < 0)
      throw new BadRequestException("Platform fee exceeds the order total");

    return this.prisma.payment.upsert({
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

  private publicPayment(payment: { id: string; amountCentavos: number; currency: string; status: string; createdAt: Date }) {
    return { id: payment.id, amountCentavos: payment.amountCentavos, currency: payment.currency, status: payment.status, createdAt: payment.createdAt };
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
          payments?: { id: string; attributes?: { amount?: number } }[];
          refunds?: {
            id: string;
            attributes: {
              amount: number;
              reason?: string;
              status: "pending" | "succeeded" | "failed";
            };
          }[];
        };
      };
    };
  };
};
