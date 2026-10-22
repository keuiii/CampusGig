import assert from "node:assert/strict";
import test from "node:test";
import { ConflictException } from "@nestjs/common";
import { OrdersService } from "../src/modules/orders/orders.service";

function requestedOrder(status = "REQUESTED") {
  return {
    id: "order-1",
    clientId: "client-1",
    providerId: "provider-1",
    titleSnapshot: "Logo Design",
    status,
    provider: { id: "provider-1", displayName: "Provider" },
    client: { id: "client-1", displayName: "Client" },
    servicePackage: { id: "package-1", name: "Standard" },
    files: [],
    revisions: [],
    review: null,
  };
}

test("client cancellation atomically records history and notifies the provider", async () => {
  const order = requestedOrder();
  let updateInput: any;
  let historyInput: any;
  let notificationInput: any;
  const database = {
    order: {
      updateMany: async (input: unknown) => {
        updateInput = input;
        return { count: 1 };
      },
      findUniqueOrThrow: async () => ({ ...order, status: "CANCELLED" }),
    },
    orderStatusHistory: {
      create: async (input: unknown) => (historyInput = input),
    },
    notification: {
      create: async (input: unknown) => (notificationInput = input),
    },
  };
  const prisma = {
    order: { findFirst: async () => order },
    $transaction: async (operation: (client: typeof database) => unknown) =>
      operation(database),
  };

  const result = await new OrdersService(prisma as never).cancel(
    "client-1",
    "order-1",
    "No longer needed",
  );

  assert.deepEqual(updateInput.where, {
    id: "order-1",
    clientId: "client-1",
    status: "REQUESTED",
  });
  assert.equal(updateInput.data.status, "CANCELLED");
  assert.equal(historyInput.data.toStatus, "CANCELLED");
  assert.equal(historyInput.data.note, "No longer needed");
  assert.equal(notificationInput.data.recipientId, "provider-1");
  assert.equal(notificationInput.data.type, "ORDER_CANCELLED");
  assert.equal(result.data.status, "CANCELLED");
});

test("client cannot cancel an order after the provider has accepted it", async () => {
  const prisma = {
    order: { findFirst: async () => requestedOrder("ACCEPTED") },
  };
  await assert.rejects(
    () =>
      new OrdersService(prisma as never).cancel(
        "client-1",
        "order-1",
        "Changed plans",
      ),
    ConflictException,
  );
});

test("orders cannot start before a verified payment even when the legacy flag is disabled", async () => {
  const order = requestedOrder("ACCEPTED");
  const prisma = {
    order: { findFirst: async () => order },
    payment: { findFirst: async () => null },
  };
  const config = {
    get: (key: string) => (key === "PAYMENTS_REQUIRED" ? "false" : undefined),
  };
  await assert.rejects(
    () =>
      new OrdersService(prisma as never, config as never).start(
        "provider-1",
        "order-1",
      ),
    /Wait for the client payment/,
  );
});

test("providers cannot submit deliverables before payment is verified", async () => {
  const prisma = {
    order: { findFirst: async () => requestedOrder("IN_PROGRESS") },
    payment: { findFirst: async () => null },
  };
  let persisted = false;
  const storage = {
    persistUploads: async () => {
      persisted = true;
      return [];
    },
  };

  await assert.rejects(
    () =>
      new OrdersService(prisma as never, {} as never, storage as never).deliver(
        "provider-1",
        "order-1",
        "Final delivery",
        [{ originalname: "final.pdf" }] as never,
      ),
    /Payment must be confirmed before deliverables/,
  );
  assert.equal(persisted, false);
});

test("clients cannot complete submitted work before payment is verified", async () => {
  const order = { ...requestedOrder("SUBMITTED"), payments: [] };
  const database = {
    $queryRaw: async () => [{ locked: true }],
    order: { findFirst: async () => order },
  };
  const prisma = {
    order: { findFirst: async () => order },
    $transaction: async (operation: (client: typeof database) => unknown) =>
      operation(database),
  };

  await assert.rejects(
    () => new OrdersService(prisma as never).complete("client-1", "order-1"),
    /Payment must be confirmed before the delivery can be accepted/,
  );
});

test("clients cannot download deliverables before payment is verified", async () => {
  let fileQueried = false;
  const prisma = {
    order: {
      findFirst: async () => ({
        clientId: "client-1",
        providerId: "provider-1",
      }),
    },
    payment: { findFirst: async () => null },
    orderFile: {
      findFirst: async () => {
        fileQueried = true;
        return null;
      },
    },
  };

  await assert.rejects(
    () =>
      new OrdersService(prisma as never).getFile(
        "client-1",
        "order-1",
        "file-1",
      ),
    /Payment must be confirmed before deliverables can be downloaded/,
  );
  assert.equal(fileQueried, false);
});

test("clients cannot review a completed unpaid order", async () => {
  const prisma = {
    order: { findFirst: async () => requestedOrder("COMPLETED") },
    payment: { findFirst: async () => null },
  };

  await assert.rejects(
    () =>
      new OrdersService(prisma as never).review("client-1", "order-1", {
        overallRating: 5,
      }),
    /Payment must be confirmed before the provider can be reviewed/,
  );
});

test("client protection fee is added to rather than deducted from provider price", () => {
  const config = {
    get: (key: string) =>
      ({
        PLATFORM_FEE_BASIS_POINTS: "700",
        PLATFORM_FEE_MIN_CENTAVOS: "1500",
      })[key],
  };
  const service = new OrdersService({} as never, config as never);
  assert.equal((service as any).calculatePlatformFee(50000), 3500);
  assert.equal((service as any).calculatePlatformFee(10000), 1500);
});

test("clients cannot request a service from an unavailable provider", async () => {
  const prisma = {
    service: {
      findFirst: async () => ({
        id: "service-1",
        providerId: "provider-1",
        provider: {
          displayName: "Provider",
          providerProfile: { isAvailable: false },
        },
        packages: [{ id: "package-1", priceCentavos: 50000 }],
      }),
    },
  };
  const service = new OrdersService(
    prisma as never,
    { get: () => undefined } as never,
  );

  await assert.rejects(
    () =>
      service.create("client-1", {
        serviceId: "service-1",
        servicePackageId: "package-1",
        requirements: "Create a campus logo design",
      }),
    /currently unavailable/,
  );
});
