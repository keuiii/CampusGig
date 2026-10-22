import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ProviderService } from "../src/modules/provider/provider.service";
import { ServicesService } from "../src/modules/services/services.service";
import { AdminService } from "../src/modules/admin/admin.service";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { CreateServiceDto } from "../src/modules/provider/dto/create-service.dto";

const common = {
  categoryId: "design",
  title: "Campus event identity design",
  description:
    "I will create a complete visual identity for your campus event and provide polished source files.",
  deliveryMethod: "ONLINE" as const,
};

function createFixture() {
  let createData: any;
  const prisma = {
    studentProfile: {
      findUnique: async () => ({ verificationStatus: "APPROVED" }),
    },
    providerProfile: { findUnique: async () => ({ userId: "provider-1" }) },
    category: { findFirst: async () => ({ id: "design" }) },
    service: {
      create: async ({ data }: any) => {
        createData = data;
        return { id: "service-1", ...data, packages: [], media: [] };
      },
      findFirst: async () => null,
    },
  };
  return {
    service: new ProviderService(
      prisma as never,
      {} as never,
      { publishAccountChanged: () => undefined } as never,
    ),
    data: () => createData,
  };
}

test("provider creates canonical V2 terms without package fabrication", async () => {
  const fixture = createFixture();
  await fixture.service.createService("provider-1", {
    ...common,
    pricingModel: "SINGLE_PRICE_V2",
    basePriceCentavos: 45_000,
    normalDeliveryMinutes: 2880,
    includedRevisionLimit: 2,
  });
  assert.equal(fixture.data().pricingModel, "SINGLE_PRICE_V2");
  assert.equal(fixture.data().normalDeliveryMinutes, 2880);
  assert.equal("packages" in fixture.data(), false);
});

test("provider rejects missing and contradictory V2 terms", async () => {
  const fixture = createFixture();
  await assert.rejects(
    () =>
      fixture.service.createService("provider-1", {
        ...common,
        pricingModel: "SINGLE_PRICE_V2",
        basePriceCentavos: 45_000,
        normalDeliveryMinutes: 2880,
      }),
    BadRequestException,
  );
  await assert.rejects(
    () =>
      fixture.service.createService("provider-1", {
        ...common,
        pricingModel: "SINGLE_PRICE_V2",
        basePriceCentavos: 45_000,
        normalDeliveryMinutes: 2880,
        includedRevisionLimit: 2,
        packages: [
          {
            tier: "BASIC",
            name: "Basic",
            description: "Contradictory legacy package",
            priceCentavos: 45_000,
            deliveryDays: 2,
            revisionLimit: 2,
          },
        ],
      }),
    /cannot include legacy packages/i,
  );
});

test("V2 DTO enforces price, duration, revision, and enum bounds", () => {
  const invalid = plainToInstance(CreateServiceDto, {
    ...common,
    pricingModel: "SINGLE_PRICE_V2",
    basePriceCentavos: 99,
    normalDeliveryMinutes: 59,
    includedRevisionLimit: 21,
  });
  const properties = validateSync(invalid).map(({ property }) => property);
  assert.ok(properties.includes("basePriceCentavos"));
  assert.ok(properties.includes("normalDeliveryMinutes"));
  assert.ok(properties.includes("includedRevisionLimit"));

  const unknownModel = plainToInstance(CreateServiceDto, {
    ...common,
    pricingModel: "FUTURE_PRICE_V3",
  });
  assert.ok(
    validateSync(unknownModel).some(
      ({ property }) => property === "pricingModel",
    ),
  );
});

test("legacy create remains compatible and ownership remains enforced", async () => {
  const fixture = createFixture();
  await fixture.service.createService("provider-1", {
    ...common,
    packages: [
      {
        tier: "BASIC",
        name: "Basic",
        description: "Complete legacy package",
        priceCentavos: 25_000,
        deliveryDays: 3,
        revisionLimit: 1,
      },
    ],
  });
  assert.equal(fixture.data().pricingModel, "LEGACY_PACKAGES");
  assert.equal(fixture.data().packages.create.length, 1);
  await assert.rejects(
    () => fixture.service.updateService("provider-1", "other-service", common),
    NotFoundException,
  );
});

test("marketplace maps V2 terms and keeps packages empty", () => {
  const mapper = new ServicesService({} as never) as any;
  const result = mapper.toResponse({
    id: "service-v2",
    title: "V2 service",
    description: "Description",
    pricingModel: "SINGLE_PRICE_V2",
    basePriceCentavos: 32_500,
    normalDeliveryMinutes: 180,
    includedRevisionLimit: 1,
    provider: {
      id: "provider-1",
      displayName: "Provider",
      providerProfile: { isAvailable: true, maxPendingOrders: 50 },
      studentProfile: { school: { name: "Campus" } },
    },
    category: { name: "Design" },
    packages: [],
    media: [],
  });
  assert.equal(result.price, 325);
  assert.equal(result.delivery, "3 hours");
  assert.equal(result.includedRevisionLimit, 1);
  assert.deepEqual(result.packages, []);
});

test("complete V2 drafts submit through the existing lifecycle", async () => {
  let updateData: any;
  const service = new ProviderService(
    {
      service: {
        findFirst: async () => ({
          id: "service-v2",
          providerId: "provider-1",
          status: "DRAFT",
          pricingModel: "SINGLE_PRICE_V2",
          basePriceCentavos: 32_500,
          normalDeliveryMinutes: 180,
          includedRevisionLimit: 1,
          packages: [],
        }),
        update: async ({ data }: any) => {
          updateData = data;
          return { id: "service-v2", ...data };
        },
      },
    } as never,
    {} as never,
    { publishAccountChanged: () => undefined } as never,
  );
  await service.submitService("provider-1", "service-v2");
  assert.equal(updateData.status, "PENDING_REVIEW");
});

test("admin moderation publishes a complete V2 listing and rejects invalid terms", async () => {
  const updates: any[] = [];
  const validRecord = {
    status: "PENDING_REVIEW",
    pricingModel: "SINGLE_PRICE_V2",
    basePriceCentavos: 32_500,
    normalDeliveryMinutes: 180,
    includedRevisionLimit: 1,
    packages: [],
  };
  const prisma = {
    service: {
      findFirst: async () => validRecord,
      update: async ({ data }: any) => {
        updates.push(data);
        return {
          id: "service-v2",
          providerId: "provider-1",
          ...validRecord,
          ...data,
        };
      },
    },
  };
  const admin = new AdminService(
    prisma as never,
    {
      publishAccountChanged: () => undefined,
      publishMarketplaceChanged: () => undefined,
    } as never,
  );
  await admin.reviewService("service-v2", "admin-1", true);
  assert.equal(updates[0].status, "PUBLISHED");

  validRecord.basePriceCentavos = null as never;
  await assert.rejects(
    () => admin.reviewService("service-v2", "admin-1", true),
    /incomplete or contradictory/i,
  );
});

test("Phase B migration is additive and leaves package and order tables untouched", () => {
  const sql = readFileSync(
    resolve(
      import.meta.dirname,
      "../prisma/migrations/20261002110000_add_single_price_v2_listing_terms/migration.sql",
    ),
    "utf8",
  );
  assert.match(sql, /ADD COLUMN "basePriceCentavos" INTEGER/);
  assert.match(sql, /ADD COLUMN "normalDeliveryMinutes" INTEGER/);
  assert.match(sql, /ADD COLUMN "includedRevisionLimit" INTEGER/);
  assert.doesNotMatch(sql, /DROP|DELETE|UPDATE/i);
  assert.doesNotMatch(sql, /ALTER TABLE "(?:ServicePackage|Order)"/i);
});
