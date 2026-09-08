import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class PaymentLedgerService {
  constructor(private readonly prisma: PrismaService) {}

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
}
