import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { OrdersService } from "../src/modules/orders/orders.service";
import {
  buildLegacyOrderTermsSnapshot,
  legacyPackageTerms,
  termsSnapshotVersion,
} from "../src/modules/orders/legacy-order-terms";

const root = resolve(import.meta.dirname, "../..");

test("legacy terms snapshot preserves immutable package, pricing, and deadline terms", () => {
  const dueAt = new Date("2026-10-08T15:59:59.999Z");
  const snapshot = buildLegacyOrderTermsSnapshot({
    serviceTitle: "Campus presentation design",
    package: {
      id: "package-1",
      tier: "STANDARD",
      name: "Standard",
      description: "Twenty carefully designed presentation slides.",
      priceCentavos: 50_000,
      deliveryDays: 5,
      revisionLimit: 2,
    },
    currency: "PHP",
    subtotalCentavos: 50_000,
    platformFeeCentavos: 2_500,
    totalCentavos: 52_500,
    revisionLimit: 2,
    dueAt,
  });

  assert.equal(termsSnapshotVersion(snapshot), 1);
  assert.deepEqual(legacyPackageTerms(snapshot), {
    id: "package-1",
    tier: "STANDARD",
    name: "Standard",
    description: "Twenty carefully designed presentation slides.",
    priceCentavos: 50_000,
    deliveryDays: 5,
    revisionLimit: 2,
  });
  assert.deepEqual(snapshot.pricing, {
    currency: "PHP",
    subtotalCentavos: 50_000,
    platformFeeCentavos: 2_500,
    totalCentavos: 52_500,
  });
  assert.deepEqual(snapshot.fulfillment, {
    deliveryDays: 5,
    revisionLimit: 2,
    dueAt: dueAt.toISOString(),
    deadlineBasis: "STORED_DUE_AT",
  });
});

test("legacy order creation owns pricing versions and renders immutable snapshot terms", async () => {
  let createData: Record<string, unknown> | undefined;
  const selectedPackage = {
    id: "package-1",
    serviceId: "service-1",
    tier: "PREMIUM",
    name: "Premium",
    description: "Complete premium package scope stored at booking time.",
    priceCentavos: 80_000,
    deliveryDays: 7,
    revisionLimit: 3,
    isActive: true,
  };
  const serviceRecord = {
    id: "service-1",
    title: "Presentation package",
    providerId: "provider-1",
    pricingModel: "LEGACY_PACKAGES",
    provider: {
      displayName: "Provider",
      providerProfile: { isAvailable: true },
    },
    packages: [selectedPackage],
  };
  const database = {
    $queryRaw: async () => [{ locked: true }],
    providerProfile: {
      findUnique: async () => ({ isAvailable: true, maxPendingOrders: 50 }),
    },
    order: {
      count: async () => 0,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        createData = data;
        return {
          ...data,
          id: "order-1",
          orderNumber: data.orderNumber,
          status: "REQUESTED",
          createdAt: new Date("2026-10-02T00:00:00.000Z"),
          revisionsUsed: 0,
          files: [],
          revisions: [],
          review: null,
          payments: [],
          client: {
            id: "client-1",
            displayName: "Client",
            avatarPath: null,
            updatedAt: new Date(0),
          },
          provider: {
            id: "provider-1",
            displayName: "Provider",
            avatarPath: null,
            updatedAt: new Date(0),
          },
          servicePackage: {
            ...selectedPackage,
            name: "Mutated current package",
            deliveryDays: 90,
            revisionLimit: 20,
          },
        };
      },
    },
  };
  const prisma = {
    service: { findFirst: async () => serviceRecord },
    $transaction: async (operation: (client: typeof database) => unknown) =>
      operation(database),
  };
  const result = await new OrdersService(
    prisma as never,
    { get: () => "0" } as never,
  ).create("client-1", {
    serviceId: "service-1",
    servicePackageId: "package-1",
    requirements: "Create a complete presentation for the campus event.",
  });

  assert.equal(createData?.pricingModel, "LEGACY_PACKAGE_V1");
  assert.equal(result.data.pricingModel, "LEGACY_PACKAGE_V1");
  assert.equal(result.data.termsSnapshotVersion, 1);
  assert.equal(result.data.package.name, "Premium");
  assert.equal(result.data.package.serviceId, "service-1");
  assert.equal(result.data.package.isActive, true);
  assert.equal(result.data.package.deliveryDays, 7);
  assert.equal(result.data.package.revisionLimit, 3);
  assert.deepEqual(createData?.packageSnapshot, {
    tier: "PREMIUM",
    name: "Premium",
    description: "Complete premium package scope stored at booking time.",
    priceCentavos: 80_000,
    deliveryDays: 7,
    revisionLimit: 3,
  });
});

test("V2 order path rejects a fabricated legacy package", async () => {
  const service = new OrdersService(
    {
      service: {
        findFirst: async () => ({
          id: "service-v2",
          providerId: "provider-1",
          pricingModel: "SINGLE_PRICE_V2",
          provider: {
            displayName: "Provider",
            providerProfile: { isAvailable: true },
          },
          packages: [
            {
              id: "00000000-0000-0000-0000-000000000001",
              serviceId: "legacy-service-owned-by-someone-else",
              isActive: true,
            },
          ],
        }),
      },
    } as never,
    { get: () => "0" } as never,
  );

  await assert.rejects(
    () =>
      service.create("client-1", {
        serviceId: "service-v2",
        servicePackageId: "00000000-0000-0000-0000-000000000001",
        requirements: "Create a service request that must remain legacy.",
      }),
    BadRequestException,
  );
});

test("pricing compatibility migrations are additive and backfill only from order history", () => {
  const expand = readFileSync(
    resolve(
      root,
      "api/prisma/migrations/20261002100000_add_pricing_model_compatibility/migration.sql",
    ),
    "utf8",
  );
  const backfill = readFileSync(
    resolve(
      root,
      "api/prisma/migrations/20261002101000_backfill_legacy_order_terms_snapshot/migration.sql",
    ),
    "utf8",
  );
  const constraint = readFileSync(
    resolve(
      root,
      "api/prisma/migrations/20261002102000_require_order_terms_snapshot/migration.sql",
    ),
    "utf8",
  );
  const schema = readFileSync(
    resolve(root, "api/prisma/schema.prisma"),
    "utf8",
  );

  assert.match(expand, /DEFAULT 'LEGACY_PACKAGES'/);
  assert.match(expand, /DEFAULT 'LEGACY_PACKAGE_V1'/);
  assert.match(expand, /ADD COLUMN "termsSnapshot" JSONB;/);
  assert.doesNotMatch(expand, /termsSnapshot" JSONB NOT NULL/);
  assert.match(backfill, /WHERE "termsSnapshot" IS NULL/);
  assert.match(backfill, /Legacy package snapshot is incomplete/);
  assert.match(backfill, /"packageSnapshot"/);
  assert.match(backfill, /"subtotalCentavos"/);
  assert.match(backfill, /"platformFeeCentavos"/);
  assert.match(backfill, /"totalCentavos"/);
  assert.match(backfill, /"dueAt"/);
  assert.match(backfill, /"revisionLimit"/);
  assert.doesNotMatch(backfill, /FROM "Service(?:Package)?"/);
  assert.match(constraint, /WHERE "termsSnapshot" IS NULL/);
  assert.match(constraint, /ALTER COLUMN "termsSnapshot" SET NOT NULL/);
  for (const migration of [expand, backfill, constraint]) {
    assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN|TYPE)/i);
    assert.doesNotMatch(migration, /DELETE\s+FROM/i);
  }
  assert.match(schema, /servicePackageId\s+String\?\s+@db\.Uuid/);
  assert.match(schema, /packageSnapshot\s+Json\?/);
  assert.match(schema, /dueAt\s+DateTime\?/);
  assert.match(schema, /revisionLimit\s+Int\s+@default\(0\)/);
});
