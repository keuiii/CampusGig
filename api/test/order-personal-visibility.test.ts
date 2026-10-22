import assert from "node:assert/strict";
import test from "node:test";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { OrdersService } from "../src/modules/orders/orders.service";
import { orderRequestFingerprint } from "../src/modules/orders/order-idempotency";

const clientId = "client-1";
const providerId = "provider-1";
const orderId = "order-1";

test("repeated order request identifiers return the original order", async () => {
  const input = {
    clientRequestId: "13f1847d-0fe4-4c4f-91fb-3a1d88e8f816",
    serviceId: "service-1",
    servicePackageId: "package-1",
    requirements: "  Build the requested portfolio  ",
    requestedDeliveryDate: "2026-10-15",
  };
  const existing = {
    id: orderId,
    orderNumber: "CG-2026-EXISTING",
    requestFingerprint: orderRequestFingerprint(input),
    client: { id: clientId, displayName: "Client" },
    provider: { id: providerId, displayName: "Provider" },
    payments: [],
  };
  const service = new OrdersService({
    order: { findUnique: async () => existing },
  } as never);
  const result = await service.create(clientId, input);
  assert.equal(result.data.id, orderId);
  assert.match(result.message, /already received/i);
});

test("an order request identifier cannot be reused for different details", async () => {
  const input = {
    clientRequestId: "13f1847d-0fe4-4c4f-91fb-3a1d88e8f816",
    serviceId: "service-1",
    servicePackageId: "package-1",
    requirements: "Build the requested portfolio",
    requestedDeliveryDate: "2026-10-15",
  };
  const service = new OrdersService({
    order: {
      findUnique: async () => ({
        id: orderId,
        requestFingerprint: orderRequestFingerprint({
          ...input,
          requirements: "A different project request",
        }),
      }),
    },
  } as never);
  await assert.rejects(service.create(clientId, input), ConflictException);
});

test("a concurrent idempotency conflict resolves to the committed order", async () => {
  const input = {
    clientRequestId: "13f1847d-0fe4-4c4f-91fb-3a1d88e8f816",
    serviceId: "service-1",
    servicePackageId: "package-1",
    requirements: "Build the requested portfolio",
  };
  const existing = {
    id: orderId,
    orderNumber: "CG-2026-WINNER",
    requestFingerprint: orderRequestFingerprint(input),
    client: { id: clientId, displayName: "Client" },
    provider: { id: providerId, displayName: "Provider" },
    payments: [],
  };
  let lookupCount = 0;
  const service = new OrdersService(
    {
      order: {
        findUnique: async () => (++lookupCount === 1 ? null : existing),
      },
      service: {
        findFirst: async () => ({
          id: input.serviceId,
          title: "Portfolio",
          providerId,
          provider: {
            displayName: "Provider",
            providerProfile: { isAvailable: true },
          },
          packages: [
            {
              id: input.servicePackageId,
              tier: "BASIC",
              name: "Basic",
              description: "Package",
              priceCentavos: 10000,
              deliveryDays: 3,
              revisionLimit: 1,
            },
          ],
        }),
      },
      $transaction: async (work: (database: unknown) => Promise<unknown>) =>
        work({
          $queryRaw: async () => [],
          providerProfile: {
            findUnique: async () => ({
              isAvailable: true,
              maxPendingOrders: 50,
            }),
          },
          order: {
            findUnique: async () => null,
            count: async () => 0,
            create: async () => {
              const conflict = new Error("unique conflict") as Error & {
                code: string;
              };
              conflict.code = "P2002";
              throw conflict;
            },
          },
        }),
    } as never,
    { get: () => "0" } as never,
    {} as never,
  );
  const result = await service.create(clientId, input);
  assert.equal(result.data.id, orderId);
  assert.equal(lookupCount, 2);
});

test("active and archived lists are isolated by participant role", async () => {
  const queries: unknown[] = [];
  const service = new OrdersService({
    order: {
      findMany: async (query: any) => {
        if (query.select?.id) return [];
        queries.push(query);
        return [];
      },
    },
  } as never);
  await service.list(clientId, "client", "active");
  await service.list(clientId, "client", "archived");
  await service.list(providerId, "provider", "archived");
  assert.deepEqual((queries[0] as any).where, {
    clientId,
    clientRemovedAt: null,
    clientArchivedAt: null,
  });
  assert.deepEqual((queries[1] as any).where, {
    clientId,
    clientRemovedAt: null,
    clientArchivedAt: { not: null },
  });
  assert.deepEqual((queries[2] as any).where, {
    providerId,
    providerRemovedAt: null,
    providerArchivedAt: { not: null },
  });
});

test("order parties expose avatar availability without revealing storage paths", async () => {
  const updatedAt = new Date("2026-09-27T00:00:00.000Z");
  const order = {
    id: orderId,
    client: {
      id: clientId,
      displayName: "Client",
      avatarPath: null,
      updatedAt,
    },
    provider: {
      id: providerId,
      displayName: "Provider",
      avatarPath: "private/avatar.jpg",
      updatedAt,
    },
    payments: [],
  };
  const service = new OrdersService({
    order: {
      findMany: async (query: any) => (query.select?.id ? [] : [order]),
    },
  } as never);
  const result = await service.list(clientId, "client");
  assert.deepEqual(result.data[0].provider, {
    id: providerId,
    displayName: "Provider",
    hasAvatar: true,
    avatarVersion: updatedAt.getTime(),
  });
  assert.equal(result.data[0].client.hasAvatar, false);
  assert.equal(JSON.stringify(result).includes("private/avatar.jpg"), false);
});

test("client archive changes only the client's visibility flag", async () => {
  let update: any;
  const service = new OrdersService({
    order: {
      findFirst: async () => ({
        id: orderId,
        clientId,
        providerId,
        status: "COMPLETED",
      }),
      updateMany: async (query: unknown) => {
        update = query;
        return { count: 1 };
      },
    },
  } as never);
  assert.deepEqual(
    await service.updateVisibility(clientId, orderId, "archive"),
    {
      data: { id: orderId, view: "archived" },
    },
  );
  assert.deepEqual(update.where, {
    id: orderId,
    clientId,
    status: "COMPLETED",
    clientRemovedAt: null,
  });
  assert.ok(update.data.clientArchivedAt instanceof Date);
  assert.equal(update.data.providerArchivedAt, undefined);
});

test("provider restore and removal never delete the order", async () => {
  const updates: any[] = [];
  const service = new OrdersService({
    order: {
      findFirst: async () => ({
        id: orderId,
        clientId,
        providerId,
        status: "COMPLETED",
      }),
      updateMany: async (query: unknown) => {
        updates.push(query);
        return { count: 1 };
      },
    },
  } as never);
  await service.updateVisibility(providerId, orderId, "restore");
  await service.updateVisibility(providerId, orderId, "remove");
  assert.deepEqual(updates[0].where, {
    id: orderId,
    providerId,
    status: "COMPLETED",
    providerRemovedAt: null,
    providerArchivedAt: { not: null },
  });
  assert.deepEqual(updates[0].data, { providerArchivedAt: null });
  assert.ok(updates[1].data.providerRemovedAt instanceof Date);
  assert.equal(updates[1].data.clientRemovedAt, undefined);
});

test("nonparticipants and incomplete orders cannot change visibility", async () => {
  const service = new OrdersService({
    order: { findFirst: async () => null },
  } as never);
  await assert.rejects(
    service.updateVisibility("stranger", orderId, "remove"),
    NotFoundException,
  );
  const incomplete = new OrdersService({
    order: {
      findFirst: async () => ({
        id: orderId,
        clientId,
        providerId,
        status: "SUBMITTED",
      }),
    },
  } as never);
  await assert.rejects(
    incomplete.updateVisibility(clientId, orderId, "archive"),
    ConflictException,
  );
});
