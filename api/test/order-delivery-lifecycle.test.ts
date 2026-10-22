import assert from "node:assert/strict";
import test from "node:test";
import { NotFoundException } from "@nestjs/common";
import { OrdersService } from "../src/modules/orders/orders.service";

test("paid work follows start, delivery, revision, resubmission, and completion atomically", async () => {
  const order: any = {
    id: "order-1",
    orderNumber: "CG-E2E-1",
    clientId: "client-1",
    providerId: "provider-1",
    titleSnapshot: "Campus poster",
    pricingModel: "SINGLE_PRICE_V2",
    deliveryDurationMinutes: 2_880,
    status: "ACCEPTED",
    requirements: "Create the event poster.",
    subtotalCentavos: 10000,
    platformFeeCentavos: 500,
    totalCentavos: 10500,
    currency: "PHP",
    dueAt: new Date("2026-10-01T00:00:00Z"),
    createdAt: new Date("2026-09-15T00:00:00Z"),
    revisionsUsed: 0,
    revisionLimit: 2,
    client: { id: "client-1", displayName: "Campus Client" },
    provider: { id: "provider-1", displayName: "Campus Provider" },
    servicePackage: {
      id: "package-1",
      tier: "BASIC",
      name: "Basic",
      deliveryDays: 2,
      revisionLimit: 1,
    },
    files: [],
    deliverySubmissions: [],
    revisions: [],
    disputes: [],
    review: null,
    payments: [
      {
        id: "payment-1",
        status: "PAID",
        amountCentavos: 10500,
        platformFeeCentavos: 500,
        providerNetCentavos: 10000,
        refundedCentavos: 0,
        currency: "PHP",
        refunds: [],
      },
    ],
  };
  const history: any[] = [];
  const notifications: any[] = [];
  let completedWorkIncrements = 0;
  const providerEarning: any = {
    id: "earning-1",
    providerId: "provider-1",
    orderId: "order-1",
    paymentId: "payment-1",
    revisionPurchaseId: null,
    sourceType: "ORIGINAL_ORDER",
    grossServiceAmountCentavos: 10000,
    currency: "PHP",
    status: "PENDING",
    availableAt: null,
    ledgerEntries: [
      {
        type: "EARNING_PENDING_CREDIT",
        amountCentavos: 10000,
        currency: "PHP",
      },
    ],
  };
  order.providerEarnings = [providerEarning];

  const database = {
    order: {
      findFirst: async ({ include, select }: any = {}) =>
        include?.providerEarnings || select?.revisions
          ? {
              ...order,
              revisions: order.revisions.filter(
                (revision: any) => revision.status === "OPEN",
              ),
              disputes: [],
            }
          : order,
      updateMany: async ({ where, data }: any) => {
        if (where.id !== order.id || where.status !== order.status)
          return { count: 0 };
        if (where.providerId && where.providerId !== order.providerId)
          return { count: 0 };
        if (where.clientId && where.clientId !== order.clientId)
          return { count: 0 };
        order.status = data.status;
        for (const [key, value] of Object.entries(data)) {
          if (key !== "revisionsUsed") order[key] = value;
        }
        if (data.revisionsUsed?.increment)
          order.revisionsUsed += data.revisionsUsed.increment;
        return { count: 1 };
      },
      findUniqueOrThrow: async () => order,
    },
    orderStatusHistory: {
      create: async ({ data }: any) => history.push(data),
    },
    notification: {
      create: async ({ data }: any) => notifications.push(data),
      createMany: async ({ data }: any) => notifications.push(...data),
    },
    orderFile: {
      createMany: async ({ data }: any) => {
        const submission = order.deliverySubmissions.find(
          (item: any) => item.id === data[0].deliverySubmissionId,
        );
        submission.files.push(...data);
        order.files.push(...data);
      },
    },
    deliverySubmission: {
      findUnique: async () => null,
      findFirst: async () => order.deliverySubmissions[0] ?? null,
      create: async ({ data }: any) => {
        const created = {
          id: `submission-${data.version}`,
          ...data,
          submittedAt: new Date(`2099-10-0${data.version}T00:00:00Z`),
          files: [],
        };
        order.deliverySubmissions.unshift(created);
        return created;
      },
    },
    revisionRequest: {
      findFirst: async () =>
        order.revisions.length
          ? { sequenceNumber: order.revisions.at(-1).sequenceNumber }
          : null,
      create: async ({ data }: any) => {
        order.revisions.push({ ...data, status: "OPEN" });
      },
      updateMany: async () => {
        order.revisions.forEach((revision: any) => {
          if (revision.status === "OPEN") revision.status = "RESOLVED";
        });
      },
    },
    studentProfile: {
      update: async () => {
        completedWorkIncrements += 1;
      },
    },
    providerEarning: {
      updateMany: async ({ data }: any) => {
        if (providerEarning.status !== "PENDING") return { count: 0 };
        Object.assign(providerEarning, data);
        return { count: 1 };
      },
    },
    providerEarningLedgerEntry: {
      create: async ({ data }: any) => {
        providerEarning.ledgerEntries.push(data);
        return data;
      },
    },
    $queryRaw: async () => [{ locked: true }],
  };
  const prisma = {
    order: {
      findFirst: async ({ where }: any) => {
        if (where.id !== order.id) return null;
        if (where.providerId && where.providerId !== order.providerId)
          return null;
        if (where.clientId && where.clientId !== order.clientId) return null;
        return order;
      },
    },
    payment: { findFirst: async () => ({ id: "payment-1" }) },
    $transaction: async (operation: (client: typeof database) => unknown) =>
      operation(database),
  };
  const storedPurposes: string[] = [];
  const storage = {
    persistEvidenceUploads: async (purpose: string, files: unknown[]) => {
      storedPurposes.push(purpose);
      return files.map((_, index) => ({
        storagePath: `orders/order-1/file-${index + 1}`,
        checksum: "a".repeat(64),
      }));
    },
    delete: async () => undefined,
  };
  const orderEvents: any[] = [];
  const statsEvents: any[] = [];
  const realtime = {
    publishOrderChanged: (
      orderId: string,
      recipients: string[],
      reason: string,
    ) => orderEvents.push({ orderId, recipients, reason }),
    publishProviderStats: (providerId: string, reason: string) =>
      statsEvents.push({ providerId, reason }),
  };
  const service = new OrdersService(
    prisma as never,
    undefined as never,
    storage as never,
    realtime as never,
  );
  const delivery = {
    originalname: "poster.pdf",
    mimetype: "application/pdf",
    size: 2048,
  } as Express.Multer.File;

  await assert.rejects(
    service.start("unrelated-provider", order.id),
    NotFoundException,
  );

  assert.equal(
    (await service.start("provider-1", order.id)).data.status,
    "IN_PROGRESS",
  );
  assert.equal(providerEarning.status, "PENDING");
  assert.equal(
    (
      await service.deliver("provider-1", order.id, "Initial delivery", [
        delivery,
      ])
    ).data.status,
    "SUBMITTED",
  );
  assert.equal(order.reviewDeliverySubmissionId, "submission-1");
  assert.equal(
    order.reviewDeadlineAt.getTime() - order.reviewStartedAt.getTime(),
    48 * 60 * 60 * 1000,
  );
  assert.equal(providerEarning.status, "PENDING");
  assert.equal(
    (
      await service.requestRevision(
        "client-1",
        order.id,
        "Adjust the event date",
      )
    ).data.status,
    "REVISION_REQUESTED",
  );
  assert.equal(order.revisionsUsed, 1);
  assert.equal(order.reviewDeadlineAt, null);
  assert.equal(providerEarning.status, "PENDING");
  assert.equal(
    (
      await service.deliver("provider-1", order.id, "Revised delivery", [
        delivery,
      ])
    ).data.status,
    "SUBMITTED",
  );
  assert.equal(order.revisions[0].status, "RESOLVED");
  assert.equal(order.reviewDeliverySubmissionId, "submission-2");
  assert.equal(providerEarning.status, "PENDING");
  assert.equal(
    (
      await service.requestRevision(
        "client-1",
        order.id,
        "Export one additional print-ready size",
      )
    ).data.status,
    "REVISION_REQUESTED",
  );
  assert.equal(
    (
      await service.deliver("provider-1", order.id, "Third delivery", [
        delivery,
      ])
    ).data.status,
    "SUBMITTED",
  );
  assert.deepEqual(
    order.deliverySubmissions.map((submission: any) => ({
      version: submission.version,
      note: submission.note,
      fileCount: submission.files.length,
    })),
    [
      { version: 3, note: "Third delivery", fileCount: 1 },
      { version: 2, note: "Revised delivery", fileCount: 1 },
      { version: 1, note: "Initial delivery", fileCount: 1 },
    ],
  );
  assert.equal(
    (await service.complete("client-1", order.id)).data.status,
    "COMPLETED",
  );
  assert.equal(providerEarning.status, "AVAILABLE");
  assert.equal(providerEarning.ledgerEntries.length, 2);
  assert.deepEqual(
    providerEarning.ledgerEntries.map((entry: any) => [
      entry.type,
      entry.amountCentavos,
    ]),
    [
      ["EARNING_PENDING_CREDIT", 10000],
      ["EARNING_AVAILABLE_RELEASE", 0],
    ],
  );

  assert.deepEqual(storedPurposes, [
    "order-files",
    "order-files",
    "order-files",
  ]);
  assert.deepEqual(
    history.map(({ toStatus }) => toStatus),
    [
      "IN_PROGRESS",
      "SUBMITTED",
      "REVISION_REQUESTED",
      "SUBMITTED",
      "REVISION_REQUESTED",
      "SUBMITTED",
      "COMPLETED",
    ],
  );
  assert.deepEqual(
    notifications.map(({ type }) => type),
    [
      "ORDER_STARTED",
      "DELIVERY_SUBMITTED",
      "REVISION_REQUESTED",
      "DELIVERY_SUBMITTED",
      "REVISION_REQUESTED",
      "DELIVERY_SUBMITTED",
      "ORDER_COMPLETED",
    ],
  );
  assert.deepEqual(
    orderEvents.map(({ reason }) => reason),
    [
      "started",
      "submitted",
      "revision-requested",
      "submitted",
      "revision-requested",
      "submitted",
      "completed",
    ],
  );
  assert.deepEqual(
    orderEvents.map(({ recipients }) => recipients),
    Array.from({ length: 7 }, () => ["client-1", "provider-1"]),
  );
  assert.equal(completedWorkIncrements, 1);
  assert.deepEqual(statsEvents, [
    { providerId: "provider-1", reason: "completion" },
  ]);
});

test("failed delivery persistence removes every scanned storage object", async () => {
  const deleted: string[] = [];
  const order = {
    id: "order-1",
    clientId: "client-1",
    providerId: "provider-1",
    titleSnapshot: "Campus poster",
    status: "IN_PROGRESS",
    provider: { displayName: "Campus Provider" },
  };
  const service = new OrdersService(
    {
      order: { findFirst: async () => order },
      payment: { findFirst: async () => ({ id: "payment-1" }) },
      $transaction: async () => {
        throw new Error("database unavailable");
      },
    } as never,
    undefined as never,
    {
      persistEvidenceUploads: async () => [
        { storagePath: "delivery-1.pdf", checksum: "a".repeat(64) },
        { storagePath: "delivery-2.png", checksum: "b".repeat(64) },
      ],
      delete: async (_namespace: string, key: string) => {
        deleted.push(key);
      },
    } as never,
  );
  const files = [
    {
      originalname: "delivery.pdf",
      mimetype: "application/pdf",
      size: 2048,
    },
    {
      originalname: "preview.png",
      mimetype: "image/png",
      size: 1024,
    },
  ] as Express.Multer.File[];

  await assert.rejects(
    () => service.deliver("provider-1", "order-1", "Final delivery", files),
    /database unavailable/,
  );
  assert.deepEqual(deleted.sort(), ["delivery-1.pdf", "delivery-2.png"]);
});
