import assert from "node:assert/strict";
import test from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import { compare, hash } from "bcryptjs";
import { PasswordChangeService } from "../src/modules/auth/password-change.service";

async function createHarness(mfaEnabled: boolean) {
  const calls = {
    cancelledRequests: 0,
    confirmationEmail: 0,
    mfaFactors: [] as { code: string; recoveryCode: boolean | undefined }[],
    reviewEmail: 0,
    trustedDevicesRevoked: 0,
    updatedPasswordHash: "",
  };
  const user = {
    email: "member@example.test",
    passwordHash: await hash("current-password", 4),
    mfaEnabledAt: mfaEnabled ? new Date("2026-09-01T00:00:00Z") : null,
  };
  const database = {
    user: {
      update: async ({ data }: { data: { passwordHash: string } }) => {
        calls.updatedPasswordHash = data.passwordHash;
        return {};
      },
    },
    passwordChangeRequest: {
      updateMany: async () => {
        calls.cancelledRequests += 1;
        return { count: 1 };
      },
    },
    trustedDevice: {
      updateMany: async () => {
        calls.trustedDevicesRevoked = 2;
        return { count: 2 };
      },
    },
  };
  const prisma = {
    user: { findUnique: async () => user },
    passwordChangeRequest: {
      updateMany: async () => ({ count: 0 }),
      findFirst: async () => null,
      create: async ({ data }: { data: { expiresAt: Date } }) => ({
        id: "password-request-id",
        status: "PENDING",
        expiresAt: data.expiresAt,
      }),
      delete: async () => ({}),
    },
    $transaction: async (
      action: (transaction: typeof database) => Promise<number>,
    ) => action(database),
  };
  const email = {
    sendPasswordChangeReview: async () => {
      calls.reviewEmail += 1;
      return { delivered: true };
    },
    sendPasswordChanged: async () => {
      calls.confirmationEmail += 1;
      return { delivered: true };
    },
  };
  const config = { get: () => undefined };
  const mfa = {
    verifyCurrentFactor: async (
      _userId: string,
      code: string,
      recoveryCode: boolean | undefined,
    ) => {
      calls.mfaFactors.push({ code, recoveryCode });
    },
  };
  const service = new PasswordChangeService(
    prisma as never,
    email as never,
    config as never,
    mfa as never,
  );
  return { calls, service };
}

test("MFA-enabled accounts change passwords immediately after authenticator verification", async () => {
  const { calls, service } = await createHarness(true);

  const result = await service.request(
    "user-id",
    {
      currentPassword: "current-password",
      newPassword: "new-password",
      mfaCode: "123456",
    },
    "http://localhost:4000",
  );

  assert.equal(result.status, "CONFIRMED");
  assert.equal(result.confirmationMethod, "AUTHENTICATOR");
  assert.deepEqual(calls.mfaFactors, [
    { code: "123456", recoveryCode: undefined },
  ]);
  assert.equal(await compare("new-password", calls.updatedPasswordHash), true);
  assert.equal(calls.cancelledRequests, 1);
  assert.equal(calls.trustedDevicesRevoked, 2);
  assert.equal(calls.reviewEmail, 0);
  assert.equal(calls.confirmationEmail, 1);
});

test("MFA-enabled accounts cannot change passwords without a second factor", async () => {
  const { calls, service } = await createHarness(true);

  await assert.rejects(
    service.request(
      "user-id",
      {
        currentPassword: "current-password",
        newPassword: "new-password",
      },
      "http://localhost:4000",
    ),
    UnauthorizedException,
  );

  assert.equal(calls.updatedPasswordHash, "");
  assert.equal(calls.confirmationEmail, 0);
  assert.equal(calls.reviewEmail, 0);
});

test("MFA-enabled accounts can use a one-time recovery code", async () => {
  const { calls, service } = await createHarness(true);

  const result = await service.request(
    "user-id",
    {
      currentPassword: "current-password",
      newPassword: "new-password",
      mfaCode: "ABCDE-12345",
      recoveryCode: true,
    },
    "http://localhost:4000",
  );

  assert.equal(result.status, "CONFIRMED");
  assert.equal(result.confirmationMethod, "RECOVERY_CODE");
  assert.deepEqual(calls.mfaFactors, [
    { code: "ABCDE-12345", recoveryCode: true },
  ]);
});

test("accounts without MFA retain the email-approval flow", async () => {
  const { calls, service } = await createHarness(false);

  const result = await service.request(
    "user-id",
    {
      currentPassword: "current-password",
      newPassword: "new-password",
    },
    "http://localhost:4000",
  );

  assert.equal(result.status, "PENDING");
  assert.equal(calls.mfaFactors.length, 0);
  assert.equal(calls.reviewEmail, 1);
  assert.equal(calls.confirmationEmail, 0);
});
