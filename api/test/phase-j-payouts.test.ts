import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PayoutDestinationCipherService } from "../src/modules/payments/payout-destination-cipher.service";
import { DisabledPayoutDisbursementAdapter } from "../src/modules/payments/payout-disbursement.adapter";
import {
  assertEarningFinancialInvariant,
  isEarningWithdrawable,
  withdrawalEligibleAt,
  withdrawalHoldMilliseconds,
} from "../src/modules/payments/provider-payout.policy";
import { ProviderPayoutsService } from "../src/modules/payments/provider-payouts.service";

const root = resolve(import.meta.dirname, "..");
const schema = readFileSync(resolve(root, "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  resolve(
    root,
    "prisma/migrations/20261009030000_add_provider_payouts/migration.sql",
  ),
  "utf8",
);
const serviceSource = readFileSync(
  resolve(root, "src/modules/payments/provider-payouts.service.ts"),
  "utf8",
);
const providerController = readFileSync(
  resolve(root, "src/modules/payments/provider-payouts.controller.ts"),
  "utf8",
);
const adminController = readFileSync(
  resolve(root, "src/modules/payments/admin-payouts.controller.ts"),
  "utf8",
);

const availableAt = new Date("2026-10-08T00:00:00.000Z");
const eligibleAt = new Date(availableAt.getTime() + withdrawalHoldMilliseconds);
const earning = (overrides: Record<string, unknown> = {}) => ({
  id: "earning-original",
  providerId: "provider-1",
  orderId: "order-1",
  status: "AVAILABLE",
  availableAt,
  grossServiceAmountCentavos: 70_000,
  currency: "PHP",
  hasActiveDispute: false,
  hasActiveRefund: false,
  hasActivePayoutReservation: false,
  ledgerEntries: [
    {
      type: "EARNING_PENDING_CREDIT",
      amountCentavos: 70_000,
      currency: "PHP",
    },
    { type: "EARNING_AVAILABLE_RELEASE", amountCentavos: 0, currency: "PHP" },
  ],
  disputeAssociations: [],
  refunds: [],
  payoutItems: [],
  ...overrides,
});

test("24-hour hold uses the exact persisted availableAt boundary", () => {
  assert.equal(
    withdrawalEligibleAt(availableAt)?.getTime(),
    eligibleAt.getTime(),
  );
  assert.equal(
    isEarningWithdrawable(earning(), new Date(eligibleAt.getTime() - 1)),
    false,
  );
  assert.equal(isEarningWithdrawable(earning(), eligibleAt), true);
  assert.equal(
    isEarningWithdrawable(earning(), new Date(eligibleAt.getTime() + 1)),
    true,
  );
});

test("status, currency, dispute, refund, reservation, and principal guards fail closed", () => {
  for (const status of [
    "PENDING",
    "FROZEN",
    "REFUNDED",
    "PAYOUT_PROCESSING",
    "PAID_OUT",
  ])
    assert.equal(isEarningWithdrawable(earning({ status }), eligibleAt), false);
  assert.equal(
    isEarningWithdrawable(earning({ hasActiveDispute: true }), eligibleAt),
    false,
  );
  assert.equal(
    isEarningWithdrawable(earning({ hasActiveRefund: true }), eligibleAt),
    false,
  );
  assert.equal(
    isEarningWithdrawable(
      earning({ hasActivePayoutReservation: true }),
      eligibleAt,
    ),
    false,
  );
  assert.equal(isEarningWithdrawable(earning(), eligibleAt, "USD"), false);
  assert.throws(
    () =>
      assertEarningFinancialInvariant(
        earning({ grossServiceAmountCentavos: 70_001 }),
      ),
    /does not reconcile/,
  );
});

test("withdraw-all reserves exact original and revision earnings with zero fee", async () => {
  const requestAvailableAt = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const rows = [
    earning({ availableAt: requestAvailableAt }),
    earning({
      id: "earning-revision",
      orderId: "order-2",
      grossServiceAmountCentavos: 30_000,
      availableAt: requestAvailableAt,
      ledgerEntries: [
        {
          type: "EARNING_PENDING_CREDIT",
          amountCentavos: 30_000,
          currency: "PHP",
        },
        {
          type: "EARNING_AVAILABLE_RELEASE",
          amountCentavos: 0,
          currency: "PHP",
        },
      ],
    }),
  ];
  let payoutCreate: any;
  const earningUpdates: any[] = [];
  const ledgerWrites: any[] = [];
  const database = {
    $queryRaw: async () => [{ locked: true }],
    providerPayout: {
      findUnique: async () => null,
      create: async ({ data }: any) => {
        payoutCreate = data;
        return { id: "payout-1" };
      },
    },
    providerPayoutDestination: {
      findFirst: async () => ({
        id: "destination-1",
        type: "E_WALLET",
        displayLabel: "Primary wallet",
        maskedAccountIdentifier: "**** 1234",
        accountHolderName: "Provider One",
        verificationStatus: "ADMIN_REVIEWED",
        reviewedAt: new Date(),
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    },
    providerEarning: {
      findMany: async (query: any) =>
        query.select?.orderId ? rows.map(({ orderId }) => ({ orderId })) : rows,
      updateMany: async (query: any) => {
        earningUpdates.push(query);
        return { count: 1 };
      },
    },
    providerEarningLedgerEntry: {
      create: async (query: any) => ledgerWrites.push(query),
    },
    notification: { create: async () => undefined },
  };
  const prisma = {
    $transaction: async (operation: (client: typeof database) => unknown) =>
      operation(database),
    providerPayout: {
      findFirst: async () => ({ id: "payout-1" }),
    },
  };
  const cipher = new PayoutDestinationCipherService(
    new ConfigService({
      PAYOUT_DESTINATION_ENCRYPTION_KEY: "p".repeat(64),
    }),
  );
  const payouts = new ProviderPayoutsService(prisma as never, cipher);
  await payouts.request("provider-1", {
    destinationId: "destination-1",
    clientRequestId: "63d63f34-c2ed-4cc9-b22e-f59a80567d50",
    currency: "PHP",
  });

  assert.equal(payoutCreate.requestedPrincipalCentavos, 100_000);
  assert.equal(payoutCreate.eligiblePrincipalCentavos, 100_000);
  assert.equal(payoutCreate.payoutFeeCentavos, 0);
  assert.equal(payoutCreate.netDisbursementCentavos, 100_000);
  assert.deepEqual(
    payoutCreate.items.create.map((item: any) => item.providerEarningId),
    ["earning-original", "earning-revision"],
  );
  assert.equal(earningUpdates.length, 2);
  assert.ok(
    earningUpdates.every(
      (update) =>
        update.where.status === "AVAILABLE" &&
        update.data.status === "PAYOUT_PROCESSING",
    ),
  );
  assert.equal(ledgerWrites.length, 2);
  assert.ok(
    ledgerWrites.every(
      (write) =>
        write.data.type === "EARNING_PAYOUT_RESERVED" &&
        write.data.amountCentavos === 0,
    ),
  );
});

test("payout destination cipher round-trips without exposing plaintext", () => {
  const cipher = new PayoutDestinationCipherService(
    new ConfigService({
      PAYOUT_DESTINATION_ENCRYPTION_KEY: "p".repeat(64),
    }),
  );
  const encrypted = cipher.encrypt("09171234567");

  assert.notEqual(encrypted, "09171234567");
  assert.equal(encrypted.split(".").length, 3);
  assert.equal(cipher.decrypt(encrypted), "09171234567");
  assert.throws(() => cipher.decrypt(`${encrypted}tampered`));
});

test("payout destinations stay masked until an admin explicitly reveals them", async () => {
  const cipher = new PayoutDestinationCipherService(
    new ConfigService({
      PAYOUT_DESTINATION_ENCRYPTION_KEY: "p".repeat(64),
    }),
  );
  let storedToken = "";
  const destination = {
    id: "destination-1",
    type: "E_WALLET",
    displayLabel: "Primary GCash",
    maskedAccountIdentifier: "•••• 4567",
    accountHolderName: "Provider One",
    verificationStatus: "UNVERIFIED",
    reviewedAt: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const prisma = {
    providerPayoutDestination: {
      create: async ({ data }: any) => {
        storedToken = data.externalReferenceToken;
        return destination;
      },
      findUnique: async () => ({
        id: destination.id,
        type: destination.type,
        displayLabel: destination.displayLabel,
        accountHolderName: destination.accountHolderName,
        externalReferenceToken: storedToken,
      }),
    },
  };
  const payouts = new ProviderPayoutsService(prisma as never, cipher);

  const created = await payouts.createDestination("provider-1", {
    type: "E_WALLET",
    displayLabel: "Primary GCash",
    accountIdentifier: "0917-123-4567",
    accountHolderName: "Provider One",
  });
  assert.equal(created.data.maskedAccountIdentifier, "•••• 4567");
  assert.ok(!JSON.stringify(created).includes("09171234567"));
  assert.ok(storedToken && !storedToken.includes("09171234567"));

  const revealed = await payouts.sensitiveDestinationDetails(
    "admin-1",
    destination.id,
  );
  assert.equal(revealed.data.accountIdentifier, "09171234567");
});

test("migration 41 is additive and enforces immutable payout accounting", () => {
  assert.equal(
    readdirSync(resolve(root, "prisma/migrations"), {
      withFileTypes: true,
    }).filter((entry) => entry.isDirectory()).length,
    41,
  );
  assert.match(
    schema,
    /enum ProviderPayoutStatus[\s\S]*RECONCILIATION_REQUIRED/,
  );
  assert.match(schema, /model ProviderPayoutItem/);
  assert.match(migration, /one_active_reservation_per_earning/);
  assert.match(migration, /"payoutFeeCentavos" = 0/);
  assert.match(migration, /EARNING_PAYOUT_RESERVED[\s\S]*"amountCentavos" = 0/);
  assert.doesNotMatch(migration, /EARNING_(PAYOUT|PAID)[^\n]*-[0-9]/);
  assert.doesNotMatch(migration, /DELETE\s+FROM|DROP\s+(TABLE|COLUMN)/i);
});

test("lifecycle, idempotency, and locks protect concurrent financial transitions", () => {
  assert.match(serviceSource, /providerId_clientRequestId/);
  assert.match(
    serviceSource,
    /await lockProviderPayout\(database, providerId\)/,
  );
  assert.match(serviceSource, /await lockOrderReview\(database, orderId\)/);
  assert.match(
    serviceSource,
    /status: ProviderEarningStatus\.PAYOUT_PROCESSING/,
  );
  assert.match(serviceSource, /status: ProviderEarningStatus\.PAID_OUT/);
  assert.match(serviceSource, /status: ProviderEarningStatus\.AVAILABLE/);
  assert.match(serviceSource, /EARNING_PAYOUT_RELEASED/);
  assert.match(serviceSource, /EARNING_PAID_OUT/);
  assert.match(serviceSource, /This payout was already settled differently/);
  assert.match(
    serviceSource,
    /Begin manual settlement before recording payment evidence/,
  );
});

test("provider and admin payout routes enforce identity-derived roles and UUIDs", () => {
  assert.match(providerController, /@Roles\(UserRole\.PROVIDER\)/);
  assert.match(providerController, /request\.auth\.sub/);
  assert.doesNotMatch(providerController, /@Body\(\).*providerId/);
  assert.match(adminController, /@Roles\(UserRole\.ADMIN\)/);
  assert.match(adminController, /ParseUUIDPipe/);
  assert.doesNotMatch(adminController, /amountCentavos\s*=/);
});

test("external payout adapter is disabled and fails closed", async () => {
  const adapter = new DisabledPayoutDisbursementAdapter({
    get: () => "disabled",
  } as never);
  await assert.rejects(
    adapter.createDisbursement({
      payoutId: "payout-1",
      amountCentavos: 100_000,
      currency: "PHP",
      destinationToken: "unused",
      idempotencyKey: "unused",
    }),
    ServiceUnavailableException,
  );
  await assert.rejects(
    adapter.reconcileDisbursement("external-1"),
    ServiceUnavailableException,
  );
});

test("destination masking discards raw identifiers and settlement requires evidence", () => {
  assert.match(serviceSource, /\[\^A-Za-z0-9\]/);
  assert.match(serviceSource, /slice\(-4\)/);
  assert.doesNotMatch(schema, /rawAccount|accountIdentifier\s+String/);
  assert.match(serviceSource, /manualSettlementReference/);
  assert.match(serviceSource, /settlementAt/);
  assert.match(serviceSource, /settledById/);
  assert.match(serviceSource, /MANUAL_SETTLED/);
  assert.match(serviceSource, /No automated bank or wallet transfer occurred/);
});
