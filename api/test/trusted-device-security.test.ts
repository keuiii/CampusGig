import assert from "node:assert/strict";
import test from "node:test";
import { AuthController } from "../src/modules/auth/auth.controller";
import { MfaService } from "../src/modules/auth/mfa.service";

type CookieRecord = {
  name: string;
  value?: string;
  options: Record<string, unknown>;
};

function responseRecorder() {
  const cookies: CookieRecord[] = [];
  return {
    cookies,
    response: {
      cookie: (name: string, value: string, options: Record<string, unknown>) =>
        cookies.push({ name, value, options }),
      clearCookie: (name: string, options: Record<string, unknown>) =>
        cookies.push({ name, options }),
    },
  };
}

const browserRequest = (cookie?: string) =>
  ({ headers: cookie ? { cookie } : {} }) as never;

test("Web login consumes only the HttpOnly trusted-device cookie", async () => {
  let suppliedToken: string | undefined;
  const controller = new AuthController({
    login: async (input: { trustedDeviceToken?: string }) => {
      suppliedToken = input.trustedDeviceToken;
      return { requiresTwoFactor: true };
    },
  } as never);
  const { response } = responseRecorder();

  await controller.login(
    {
      email: "student@example.com",
      password: "password-value",
      clientType: "WEB",
      trustedDeviceToken: "javascript-readable-token-must-be-ignored",
    },
    browserRequest("campusgig_trusted_device=cookie-token"),
    response as never,
  );

  assert.equal(suppliedToken, "cookie-token");
});

test("remembered Web devices receive a narrow cookie and no raw token response", async () => {
  const originalEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const controller = new AuthController({
      verifyMfaChallenge: async () => ({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        refreshExpiresIn: 600,
        trustedDeviceToken: "trusted-device-token",
        trustedForDays: 30,
        user: { id: "user-1" },
      }),
    } as never);
    const recorder = responseRecorder();

    const result = await controller.verifyMfaChallenge(
      {
        challengeToken: "challenge-token-value-with-enough-length",
        code: "123456",
        rememberDevice: true,
        clientType: "WEB",
      },
      recorder.response as never,
    );

    const trustedCookie = recorder.cookies.find(
      ({ name }) => name === "campusgig_trusted_device",
    );
    assert.ok(trustedCookie);
    assert.equal(trustedCookie.value, "trusted-device-token");
    assert.deepEqual(trustedCookie.options, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/api/v1/auth",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
    assert.equal("trustedDeviceToken" in result, false);
    assert.equal("trustedForDays" in result, false);
    assert.equal("refreshToken" in result, false);
  } finally {
    if (originalEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnvironment;
  }
});

test("MOBILE retains explicit trusted-device token delivery", async () => {
  let suppliedToken: string | undefined;
  const controller = new AuthController({
    login: async (input: { trustedDeviceToken?: string }) => {
      suppliedToken = input.trustedDeviceToken;
      return {
        accessToken: "access-token",
        refreshToken: "refresh-token",
        trustedDeviceToken: "new-mobile-token",
      };
    },
  } as never);
  const recorder = responseRecorder();

  const result = await controller.login(
    {
      email: "student@example.com",
      password: "password-value",
      clientType: "MOBILE",
      trustedDeviceToken: "stored-mobile-token",
    },
    browserRequest("campusgig_trusted_device=browser-token"),
    recorder.response as never,
  );

  assert.equal(suppliedToken, "stored-mobile-token");
  assert.equal(result.trustedDeviceToken, "new-mobile-token");
  assert.equal(recorder.cookies.length, 0);
});

test("invalid, expired, and revoked trusted-device tokens cannot bypass MFA", async () => {
  const states = [
    null,
    {
      id: "expired",
      userId: "user-1",
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1),
    },
    {
      id: "revoked",
      userId: "user-1",
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    },
  ];
  for (const state of states) {
    let updates = 0;
    const service = new MfaService(
      {
        trustedDevice: {
          findUnique: async () => state,
          update: async () => {
            updates += 1;
          },
        },
      } as never,
      {} as never,
    );
    assert.equal(await service.isTrustedDevice("user-1", "token"), false);
    assert.equal(updates, 0);
  }
});

test("a valid trusted-device token is accepted and records its use", async () => {
  let updates = 0;
  const service = new MfaService(
    {
      trustedDevice: {
        findUnique: async () => ({
          id: "trusted-device-1",
          userId: "user-1",
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
        }),
        update: async () => {
          updates += 1;
        },
      },
    } as never,
    {} as never,
  );

  assert.equal(await service.isTrustedDevice("user-1", "valid-token"), true);
  assert.equal(updates, 1);
});

test("trusted-device issuance stores only a hash with a 30-day expiry", async () => {
  let stored: { tokenHash: string; expiresAt: Date } | undefined;
  const service = new MfaService(
    {
      trustedDevice: {
        create: async ({ data }: { data: typeof stored }) => {
          stored = data;
        },
      },
    } as never,
    {} as never,
  );
  const issue = Reflect.get(service, "issueTrustedDevice") as (
    userId: string,
  ) => Promise<string>;
  const before = Date.now();
  const token = await issue.call(service, "user-1");

  assert.ok(stored);
  assert.equal(stored.tokenHash.length, 64);
  assert.notEqual(stored.tokenHash, token);
  const lifetime = stored.expiresAt.getTime() - before;
  assert.ok(lifetime >= 30 * 24 * 60 * 60 * 1000);
  assert.ok(lifetime < 30 * 24 * 60 * 60 * 1000 + 1_000);
});

test("trusted-device revocation clears the Web cookie", async () => {
  const controller = new AuthController({
    revokeTrustedDevices: async () => ({ revoked: 2 }),
  } as never);
  const recorder = responseRecorder();
  const request = { auth: { sub: "user-1" }, headers: {} } as never;

  assert.deepEqual(
    await controller.revokeTrustedDevices(request, recorder.response as never),
    { revoked: 2 },
  );
  assert.deepEqual(recorder.cookies[0], {
    name: "campusgig_trusted_device",
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/api/v1/auth",
    },
  });
});

test("an immediately confirmed password change clears the Web cookie", async () => {
  const controller = new AuthController({
    changePassword: async () => ({ status: "CONFIRMED" }),
  } as never);
  const recorder = responseRecorder();
  const request = {
    auth: { sub: "user-1" },
    headers: {},
    protocol: "https",
    get: () => "campusgig.example",
  } as never;

  await controller.changePassword(
    request,
    {
      currentPassword: "current-password",
      newPassword: "new-password-value",
      mfaCode: "123456",
    },
    recorder.response as never,
  );

  assert.equal(recorder.cookies[0]?.name, "campusgig_trusted_device");
});
