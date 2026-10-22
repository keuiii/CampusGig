import assert from "node:assert/strict";
import test from "node:test";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { ProviderService } from "../src/modules/provider/provider.service";

function serviceRecord(status: string) {
  return {
    id: "service-1",
    providerId: "provider-1",
    title: "Campus portrait session",
    status,
    category: { id: "photography", name: "Photography" },
    packages: [],
    media: [],
  };
}

function fixture(initialStatus: string, updatedCount = 1) {
  let currentStatus = initialStatus;
  let updateInput: any;
  const marketplaceEvents: unknown[][] = [];
  const accountEvents: unknown[][] = [];
  const prisma = {
    service: {
      findFirst: async (input: any) => {
        if (input?.select) return { status: currentStatus };
        return serviceRecord(currentStatus);
      },
      updateMany: async (input: any) => {
        updateInput = input;
        if (updatedCount === 1) currentStatus = input.data.status;
        return { count: updatedCount };
      },
      findFirstOrThrow: async () => serviceRecord(currentStatus),
    },
  };
  const realtime = {
    publishMarketplaceChanged: (...args: unknown[]) =>
      marketplaceEvents.push(args),
    publishAccountChanged: (...args: unknown[]) => accountEvents.push(args),
  };
  const service = new ProviderService(
    prisma as never,
    {} as never,
    realtime as never,
  );
  return {
    service,
    getUpdateInput: () => updateInput,
    marketplaceEvents,
    accountEvents,
  };
}

test("published listings pause atomically and notify both marketplace and owner", async () => {
  const context = fixture("PUBLISHED");
  const result = await context.service.pauseService("provider-1", "service-1");

  assert.equal(result.data.status, "PAUSED");
  assert.deepEqual(context.getUpdateInput().where, {
    id: "service-1",
    providerId: "provider-1",
    deletedAt: null,
    status: "PUBLISHED",
  });
  assert.deepEqual(context.marketplaceEvents, [["service", "service-1"]]);
  assert.deepEqual(context.accountEvents, [["provider-1", "services"]]);
});

test("paused listings resume while archived listings restore to paused", async () => {
  const resumed = fixture("PAUSED");
  assert.equal(
    (await resumed.service.resumeService("provider-1", "service-1")).data
      .status,
    "PUBLISHED",
  );

  const restored = fixture("ARCHIVED");
  assert.equal(
    (await restored.service.restoreService("provider-1", "service-1")).data
      .status,
    "PAUSED",
  );
});

test("published and paused listings atomically become private revision drafts", async () => {
  for (const status of ["PUBLISHED", "PAUSED"]) {
    const context = fixture(status);
    const result = await context.service.reviseService(
      "provider-1",
      "service-1",
    );

    assert.equal(result.data.status, "DRAFT");
    assert.deepEqual(context.getUpdateInput().where, {
      id: "service-1",
      providerId: "provider-1",
      deletedAt: null,
      status,
    });
    assert.deepEqual(context.getUpdateInput().data, {
      status: "DRAFT",
      publishedAt: null,
      reviewedAt: null,
      reviewedBy: null,
      rejectionReason: null,
    });
    assert.deepEqual(context.marketplaceEvents, [["service", "service-1"]]);
    assert.deepEqual(context.accountEvents, [["provider-1", "services"]]);
  }
});

test("unapproved listings cannot start a published-listing revision", async () => {
  for (const status of ["DRAFT", "REJECTED", "PENDING_REVIEW", "ARCHIVED"])
    await assert.rejects(
      () => fixture(status).service.reviseService("provider-1", "service-1"),
      ConflictException,
    );
});

test("only approved listings can be archived", async () => {
  for (const status of ["PUBLISHED", "PAUSED"]) {
    const context = fixture(status);
    assert.equal(
      (await context.service.archiveService("provider-1", "service-1")).data
        .status,
      "ARCHIVED",
    );
  }

  await assert.rejects(
    () => fixture("DRAFT").service.archiveService("provider-1", "service-1"),
    ConflictException,
  );
});

test("invalid and concurrent transitions never emit synchronization events", async () => {
  const invalid = fixture("PENDING_REVIEW");
  await assert.rejects(
    () => invalid.service.pauseService("provider-1", "service-1"),
    ConflictException,
  );
  assert.equal(invalid.marketplaceEvents.length, 0);

  const concurrent = fixture("PUBLISHED", 0);
  await assert.rejects(
    () => concurrent.service.pauseService("provider-1", "service-1"),
    /changed in another session/i,
  );
  assert.equal(concurrent.marketplaceEvents.length, 0);
  assert.equal(concurrent.accountEvents.length, 0);
});

test("listing lifecycle does not reveal whether another provider owns an id", async () => {
  const service = new ProviderService(
    {
      service: { findFirst: async () => null },
    } as never,
    {} as never,
    {} as never,
  );
  await assert.rejects(
    () => service.pauseService("provider-1", "other-service"),
    NotFoundException,
  );
});
