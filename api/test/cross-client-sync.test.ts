import assert from "node:assert/strict";
import test from "node:test";
import { ProviderService } from "../src/modules/provider/provider.service";
import { VerificationService } from "../src/modules/profile/verification.service";

test("verification approval persists provider access and invalidates the existing account session", async () => {
  const writes: Array<{ resource: string; value: unknown }> = [];
  const prisma = {
    verificationRequest: {
      findUnique: async () => ({
        id: "verification-1",
        userId: "student-1",
        schoolId: "school-1",
        status: "PENDING",
      }),
    },
    $transaction: async (operation: (database: unknown) => unknown) =>
      operation({
        verificationRequest: {
          update: async (value: unknown) =>
            writes.push({ resource: "verification", value }),
        },
        studentProfile: {
          update: async (value: unknown) =>
            writes.push({ resource: "student", value }),
        },
        userRoleAssignment: {
          upsert: async (value: unknown) =>
            writes.push({ resource: "role", value }),
        },
      }),
  };
  const accountEvents: unknown[] = [];
  const realtime = {
    publishAccountChanged: (userId: string, resource: string) =>
      accountEvents.push({ userId, resource }),
  };

  const result = await new VerificationService(
    prisma as never,
    undefined as never,
    realtime as never,
  ).review("verification-1", "admin-1", true);

  assert.equal(result.data.status, "APPROVED");
  assert.equal(writes.length, 3);
  assert.deepEqual(writes.find(({ resource }) => resource === "role")?.value, {
    where: { userId_role: { userId: "student-1", role: "PROVIDER" } },
    create: { userId: "student-1", role: "PROVIDER" },
    update: {},
  });
  assert.deepEqual(accountEvents, [
    { userId: "student-1", resource: "identity" },
  ]);
});

test("provider profile writes authoritative shared fields and emits private and public invalidations", async () => {
  let upsert: any;
  const prisma = {
    studentProfile: {
      findUnique: async () => ({ verificationStatus: "APPROVED" }),
    },
    providerProfile: {
      upsert: async (value: any) => {
        upsert = value;
        return { userId: "provider-1", ...value.create };
      },
    },
  };
  const events: unknown[] = [];
  const realtime = {
    publishAccountChanged: (userId: string, resource: string) =>
      events.push({ scope: "account", userId, resource }),
    publishMarketplaceChanged: (resource: string, resourceId: string) =>
      events.push({ scope: "marketplace", resource, resourceId }),
  };

  const result = await new ProviderService(
    prisma as never,
    undefined as never,
    realtime as never,
  ).updateProfile("provider-1", {
    headline: "  Student engineer  ",
    bio: "  Builds reliable campus software.  ",
    skills: [" TypeScript ", "MAUI", "TypeScript"],
    isAvailable: false,
  });

  assert.deepEqual(upsert.create, {
    userId: "provider-1",
    headline: "Student engineer",
    bio: "Builds reliable campus software.",
    skills: ["TypeScript", "MAUI"],
    isAvailable: false,
    maxActiveOrders: 5,
    maxPendingOrders: 50,
    instagramUrl: null,
    linkedinUrl: null,
    xUrl: null,
    portfolioUrl: null,
  });
  assert.deepEqual(upsert.update, {
    headline: "Student engineer",
    bio: "Builds reliable campus software.",
    skills: ["TypeScript", "MAUI"],
    isAvailable: false,
    instagramUrl: null,
    linkedinUrl: null,
    xUrl: null,
    portfolioUrl: null,
  });
  assert.equal(result.data.isAvailable, false);
  assert.deepEqual(events, [
    {
      scope: "account",
      userId: "provider-1",
      resource: "provider-profile",
    },
    {
      scope: "marketplace",
      resource: "provider",
      resourceId: "provider-1",
    },
  ]);
});
