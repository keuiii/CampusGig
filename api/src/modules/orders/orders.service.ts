import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";
import type { CreateOrderDto } from "./dto/create-order.dto";

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(clientId: string, input: CreateOrderDto) {
    const service = await this.prisma.service.findFirst({
      where: { id: input.serviceId, status: "PUBLISHED", deletedAt: null },
      include: { provider: { select: { displayName: true } }, packages: { where: { id: input.servicePackageId, isActive: true } } },
    });
    if (!service) throw new NotFoundException("Service is no longer available");
    const selectedPackage = service.packages[0];
    if (!selectedPackage) throw new BadRequestException("Selected package is no longer available");
    if (service.providerId === clientId) throw new BadRequestException("You cannot order your own service");
    const requirements = input.requirements.trim();
    const dueAt = new Date(Date.now() + selectedPackage.deliveryDays * 24 * 60 * 60 * 1000);
    const orderNumber = `CG-${new Date().getFullYear()}-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
    const order = await this.prisma.$transaction(async (database) => database.order.create({
      data: {
        orderNumber, clientId, providerId: service.providerId, serviceId: service.id, servicePackageId: selectedPackage.id,
        titleSnapshot: service.title,
        packageSnapshot: { tier: selectedPackage.tier, name: selectedPackage.name, description: selectedPackage.description, priceCentavos: selectedPackage.priceCentavos, deliveryDays: selectedPackage.deliveryDays, revisionLimit: selectedPackage.revisionLimit },
        subtotalCentavos: selectedPackage.priceCentavos, totalCentavos: selectedPackage.priceCentavos, requirements, dueAt, revisionLimit: selectedPackage.revisionLimit,
        history: { create: { toStatus: "REQUESTED", changedBy: clientId, note: "Client submitted a service request" } },
        conversation: { create: { participants: { create: [{ userId: clientId }, { userId: service.providerId }] } } },
        notifications: { create: { recipientId: service.providerId, type: "NEW_ORDER", title: "New service request", body: `A client requested ${service.title}.`, } },
      },
      include: this.orderInclude,
    }));
    return { data: this.toResponse(order), message: `${service.provider.displayName} has been notified.` };
  }

  async list(userId: string, scope: "client" | "provider") {
    const orders = await this.prisma.order.findMany({ where: scope === "provider" ? { providerId: userId } : { clientId: userId }, include: this.orderInclude, orderBy: { createdAt: "desc" } });
    return { data: orders.map((order) => this.toResponse(order)) };
  }

  async accept(providerId: string, orderId: string) {
    const order = await this.requireProviderOrder(providerId, orderId);
    if (order.status !== "REQUESTED") throw new ConflictException("Only a requested order can be accepted");
    const updated = await this.prisma.$transaction(async (database) => database.order.update({
      where: { id: order.id },
      data: {
        status: "ACCEPTED", acceptedAt: new Date(),
        history: { create: { fromStatus: "REQUESTED", toStatus: "ACCEPTED", changedBy: providerId, note: "Provider accepted the service request" } },
        notifications: { create: { recipientId: order.clientId, type: "ORDER_ACCEPTED", title: "Service request accepted", body: `${order.provider.displayName} accepted your request for ${order.titleSnapshot}.` } },
      },
      include: this.orderInclude,
    }));
    return { data: this.toResponse(updated), message: "Request accepted and the client has been notified." };
  }

  async reject(providerId: string, orderId: string, reason: string) {
    const order = await this.requireProviderOrder(providerId, orderId);
    if (order.status !== "REQUESTED") throw new ConflictException("Only a requested order can be rejected");
    const note = reason.trim();
    const updated = await this.prisma.$transaction(async (database) => database.order.update({
      where: { id: order.id },
      data: {
        status: "REJECTED",
        history: { create: { fromStatus: "REQUESTED", toStatus: "REJECTED", changedBy: providerId, note } },
        notifications: { create: { recipientId: order.clientId, type: "ORDER_REJECTED", title: "Service request declined", body: `${order.provider.displayName} declined your request for ${order.titleSnapshot}. Reason: ${note}` } },
      },
      include: this.orderInclude,
    }));
    return { data: this.toResponse(updated), message: "Request declined and the client has been notified." };
  }

  private async requireProviderOrder(providerId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, providerId }, include: { provider: { select: { displayName: true } } } });
    if (!order) throw new NotFoundException("Order request not found");
    return order;
  }

  private readonly orderInclude = {
    client: { select: { id: true, displayName: true } }, provider: { select: { id: true, displayName: true } },
    servicePackage: { select: { id: true, tier: true, name: true, deliveryDays: true, revisionLimit: true } },
  } as const;

  private toResponse(order: any) {
    return { id: order.id, orderNumber: order.orderNumber, title: order.titleSnapshot, status: order.status, requirements: order.requirements, subtotalCentavos: order.subtotalCentavos, platformFeeCentavos: order.platformFeeCentavos, totalCentavos: order.totalCentavos, currency: order.currency, dueAt: order.dueAt, createdAt: order.createdAt, client: order.client, provider: order.provider, package: order.servicePackage };
  }
}
