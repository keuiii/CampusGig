import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { OrdersService } from "../src/modules/orders/orders.service";
import {
  decodeOrderCursor,
  encodeOrderCursor,
} from "../src/modules/orders/order-cursor";

const providerId = "00000000-0000-0000-0000-000000000002";
const clientId = "00000000-0000-0000-0000-000000000001";

const order = (id: string, createdAt: Date) => ({
  id,
  orderNumber: `CG-${id}`,
  titleSnapshot: "Portfolio",
  status: "REQUESTED",
  requirements: "Build a student portfolio",
  subtotalCentavos: 10000,
  platformFeeCentavos: 0,
  totalCentavos: 10000,
  currency: "PHP",
  dueAt: new Date("2026-10-15T00:00:00.000Z"),
  createdAt,
  revisionsUsed: 0,
  revisionLimit: 1,
  files: [],
  revisions: [],
  review: null,
  payments: [],
  client: { id: clientId, displayName: "Client", updatedAt: createdAt },
  provider: { id: providerId, displayName: "Provider", updatedAt: createdAt },
  servicePackage: { id: "package-1", name: "Basic" },
});

test("order cursors round-trip and reject malformed input", () => {
  const value = {
    createdAt: new Date("2026-09-27T08:00:00.000Z"),
    id: "order-2",
  };
  assert.deepEqual(decodeOrderCursor(encodeOrderCursor(value)), value);
  assert.throws(() => decodeOrderCursor("not-a-cursor"), BadRequestException);
});

test("order lists return a bounded stable cursor page", async () => {
  const rows = [
    order("order-3", new Date("2026-09-27T03:00:00.000Z")),
    order("order-2", new Date("2026-09-27T02:00:00.000Z")),
    order("order-1", new Date("2026-09-27T01:00:00.000Z")),
  ];
  let query: any;
  const service = new OrdersService({
    order: {
      findMany: async (input: unknown) => {
        if ((input as any).select?.id) return [];
        query = input;
        return rows;
      },
    },
  } as never);

  const result = await service.list(clientId, "client", "active", undefined, 2);
  assert.deepEqual(
    result.data.map((item) => item.id),
    ["order-3", "order-2"],
  );
  assert.equal(result.pagination.hasMore, true);
  assert.deepEqual(decodeOrderCursor(result.pagination.nextCursor!), {
    createdAt: rows[1].createdAt,
    id: rows[1].id,
  });
  assert.equal(query.take, 3);
  assert.deepEqual(query.orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
});

test("provider capacity is checked only after the provider workload lock", async () => {
  const events: string[] = [];
  const requested = order("order-1", new Date());
  const service = new OrdersService({
    order: { findFirst: async () => requested },
    $transaction: async (work: (database: unknown) => Promise<unknown>) =>
      work({
        $queryRaw: async () => events.push("lock"),
        order: {
          findFirst: async () => ({ status: "REQUESTED" }),
          count: async () => {
            events.push("count");
            return 5;
          },
        },
        providerProfile: {
          findUnique: async () => ({ maxActiveOrders: 5 }),
        },
      }),
  } as never);

  await assert.rejects(
    service.accept(providerId, requested.id),
    (error: unknown) =>
      error instanceof ConflictException &&
      /limit of 5 active orders/.test(error.message),
  );
  assert.deepEqual(events, ["lock", "count"]);
});

test("new requests cannot exceed the provider's pending queue", async () => {
  const events: string[] = [];
  const service = new OrdersService(
    {
      service: {
        findFirst: async () => ({
          id: "service-1",
          title: "Portfolio",
          providerId,
          provider: {
            displayName: "Provider",
            providerProfile: { isAvailable: true },
          },
          packages: [
            {
              id: "package-1",
              tier: "BASIC",
              name: "Basic",
              description: "Basic package",
              priceCentavos: 10000,
              deliveryDays: 3,
              revisionLimit: 1,
            },
          ],
        }),
      },
      $transaction: async (work: (database: unknown) => Promise<unknown>) =>
        work({
          $queryRaw: async () => events.push("lock"),
          providerProfile: {
            findUnique: async () => ({
              isAvailable: true,
              maxPendingOrders: 2,
            }),
          },
          order: {
            count: async () => {
              events.push("count");
              return 2;
            },
          },
        }),
    } as never,
    { get: () => "0" } as never,
    {} as never,
  );

  await assert.rejects(
    service.create(clientId, {
      serviceId: "service-1",
      servicePackageId: "package-1",
      requirements: "Build a student portfolio",
    }),
    (error: unknown) =>
      error instanceof ConflictException &&
      /request queue is currently full/.test(error.message),
  );
  assert.deepEqual(events, ["lock", "count"]);
});
