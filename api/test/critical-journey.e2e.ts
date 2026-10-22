import assert from "node:assert/strict";
import test from "node:test";
import { createHmac, randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
import { io, type Socket } from "socket.io-client";

type Session = {
  accessToken: string;
  refreshToken?: string;
  user: { id: string; email: string; roles: string[] };
};

type Account = Session["user"];

type JsonResponse<T> = {
  status: number;
  body: T;
  cookie?: string;
};

const baseUrl = (
  process.env.E2E_API_URL ?? "http://127.0.0.1:4000/api/v1"
).replace(/\/$/, "");
const allowRemote = process.env.E2E_ALLOW_REMOTE === "true";
const parsedBaseUrl = new URL(baseUrl);
if (
  !allowRemote &&
  !["localhost", "127.0.0.1", "::1"].includes(parsedBaseUrl.hostname)
)
  throw new Error(
    "E2E_API_URL must be local unless E2E_ALLOW_REMOTE=true is explicitly set",
  );

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl)
  throw new Error("DATABASE_URL is required for the disposable E2E journey");
const databaseHostname = new URL(databaseUrl).hostname;
const allowRemoteDatabase = process.env.E2E_ALLOW_REMOTE_DATABASE === "true";
if (
  !allowRemoteDatabase &&
  !["localhost", "127.0.0.1", "::1"].includes(databaseHostname)
)
  throw new Error(
    "DATABASE_URL must be local unless E2E_ALLOW_REMOTE_DATABASE=true is explicitly set",
  );

const storageDriver = (process.env.STORAGE_DRIVER ?? "local").toLowerCase();
if (storageDriver !== "local")
  throw new Error(
    "The disposable E2E journey requires STORAGE_DRIVER=local so uploaded fixtures can be removed safely",
  );

const prisma = new PrismaClient();
const realtimeUrl = `${parsedBaseUrl.origin}/realtime`;
const localOrderFilesRoot = resolve(
  import.meta.dirname,
  "../private-storage/order-files",
);

function waitForSocketEvent<T>(socket: Socket, event: string, timeout = 5_000) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeout);
    const onEvent = (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    };
    socket.once(event, onEvent);
  });
}

async function connectSocket(token: string) {
  const socket = io(realtimeUrl, {
    auth: { token },
    transports: ["websocket"],
    reconnection: false,
    forceNew: true,
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out connecting to realtime gateway"));
    }, 5_000);
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("connect", onConnect);
      socket.off("connect_error", onError);
    };
    const onConnect = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    socket.once("connect", onConnect);
    socket.once("connect_error", onError);
  });
  const readinessDeadline = Date.now() + 5_000;
  while (Date.now() < readinessDeadline) {
    const ready = await emitWithAck<{ ok: boolean }>(
      socket,
      "provider:unsubscribe",
      { providerId: "e2e-readiness" },
    );
    if (ready.ok) return socket;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  socket.disconnect();
  throw new Error("Timed out waiting for realtime gateway authentication");
}

function emitWithAck<T>(socket: Socket, event: string, payload: unknown) {
  return new Promise<T>((resolve, reject) => {
    socket
      .timeout(5_000)
      .emit(event, payload, (error: Error | null, result: T) => {
        if (error) reject(error);
        else resolve(result);
      });
  });
}

async function request<T>(
  path: string,
  options: {
    method?: string;
    token?: string;
    cookie?: string;
    body?: unknown | FormData;
  } = {},
): Promise<JsonResponse<T>> {
  const isFormData = options.body instanceof FormData;
  const response = await fetch(`${baseUrl}/${path.replace(/^\//, "")}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body === undefined || isFormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    ...(options.body === undefined
      ? {}
      : {
          body: isFormData ? options.body : JSON.stringify(options.body),
        }),
  });
  const text = await response.text();
  const body = text ? (JSON.parse(text) as T) : ({} as T);
  const setCookie = response.headers.get("set-cookie");
  return {
    status: response.status,
    body,
    ...(setCookie ? { cookie: setCookie.split(";", 1)[0] } : {}),
  };
}

async function registerAndVerify(
  email: string,
  displayName: string,
  clientType: "WEB" | "MOBILE",
  isStudent = false,
) {
  const registered = await request<{ developmentCode?: string }>(
    "auth/register",
    {
      method: "POST",
      body: { email, displayName, password: "Journey-Test-934!", isStudent },
    },
  );
  assert.equal(registered.status, 201, JSON.stringify(registered.body));
  let verificationCode = registered.body.developmentCode;
  if (!verificationCode) {
    verificationCode = "731942";
    const temporaryUser = await prisma.user.findUniqueOrThrow({
      where: { email },
    });
    await prisma.$transaction([
      prisma.accountCode.deleteMany({
        where: { userId: temporaryUser.id, purpose: "VERIFY_EMAIL" },
      }),
      prisma.accountCode.create({
        data: {
          userId: temporaryUser.id,
          purpose: "VERIFY_EMAIL",
          codeHash: await hash(verificationCode, 4),
          expiresAt: new Date(Date.now() + 5 * 60_000),
        },
      }),
    ]);
  }
  const verified = await request<Session>("auth/verify-email", {
    method: "POST",
    body: {
      email,
      code: verificationCode,
      clientType,
      deviceName: clientType === "MOBILE" ? "E2E Android" : "E2E Browser",
    },
  });
  assert.equal(verified.status, 201, JSON.stringify(verified.body));
  assert.ok(verified.body.accessToken);
  if (clientType === "WEB") {
    assert.equal(verified.body.refreshToken, undefined);
    assert.ok(verified.cookie?.startsWith("campusgig_refresh="));
  } else {
    assert.ok(verified.body.refreshToken);
  }
  return verified;
}

test(
  "critical account, availability, paid delivery, review, message, and session journey",
  { timeout: 120_000 },
  async () => {
    const suffix = randomUUID().slice(0, 12);
    const providerEmail = `e2e-provider-${suffix}@example.test`;
    const clientEmail = `e2e-client-${suffix}@example.test`;
    const adminEmail = `e2e-admin-${suffix}@example.test`;
    let providerId: string | undefined;
    let clientId: string | undefined;
    let verificationRequestId: string | undefined;
    let serviceId: string | undefined;
    let orderId: string | undefined;
    let revisionWebhookEventId: string | undefined;
    let fixtureSchoolId: string | undefined;
    let fixtureCategoryId: string | undefined;
    const sockets: Socket[] = [];

    try {
      const health = await request<{ status: string }>("health");
      assert.equal(
        health.status,
        200,
        `CampusGig API is not reachable at ${baseUrl}`,
      );
      assert.equal(health.body.status, "ok");

      let school = await prisma.school.findFirst({
        where: { status: "ACTIVE" },
      });
      if (!school) {
        school = await prisma.school.create({
          data: {
            name: `E2E School ${suffix}`,
            shortName: `E2E-${suffix.slice(0, 6)}`,
            emailDomain: `${suffix}.example.test`,
            status: "ACTIVE",
          },
        });
        fixtureSchoolId = school.id;
      }
      let category = await prisma.category.findFirst({
        where: { isActive: true },
      });
      if (!category) {
        category = await prisma.category.create({
          data: {
            id: `e2e-${suffix}`,
            name: `E2E Category ${suffix}`,
            icon: "E2E",
            color: "mint",
            sortOrder: 999,
          },
        });
        fixtureCategoryId = category.id;
      }

      const providerInitial = await registerAndVerify(
        providerEmail,
        "Journey Provider",
        "MOBILE",
        true,
      );
      providerId = providerInitial.body.user.id;
      const pendingVerification = await prisma.$transaction(
        async (database) => {
          await database.studentProfile.create({
            data: {
              userId: providerId,
              schoolId: school.id,
              program: "E2E Testing",
              yearLevel: 4,
              verificationStatus: "PENDING",
            },
          });
          return database.verificationRequest.create({
            data: {
              userId: providerId!,
              schoolId: school.id,
              studentIdFilePath: `e2e/${suffix}/student-id.png`,
            },
          });
        },
      );
      verificationRequestId = pendingVerification.id;

      await prisma.user.create({
        data: {
          email: adminEmail,
          displayName: "Journey Administrator",
          passwordHash: await hash("Journey-Test-934!", 4),
          status: "ACTIVE",
          emailVerifiedAt: new Date(),
          roles: { create: [{ role: "ADMIN" }] },
        },
      });

      const providerWebLogin = await request<Session>("auth/login", {
        method: "POST",
        body: {
          email: providerEmail,
          password: "Journey-Test-934!",
          clientType: "WEB",
          deviceName: "E2E Browser",
        },
      });
      assert.equal(
        providerWebLogin.status,
        201,
        JSON.stringify(providerWebLogin.body),
      );
      assert.ok(!providerWebLogin.body.user.roles.includes("PROVIDER"));

      const unauthorizedApproval = await request(
        `admin/verifications/${verificationRequestId}/approve`,
        { method: "POST", token: providerInitial.body.accessToken },
      );
      assert.equal(unauthorizedApproval.status, 403);

      const adminLogin = await request<Session>("auth/login", {
        method: "POST",
        body: {
          email: adminEmail,
          password: "Journey-Test-934!",
          clientType: "WEB",
          deviceName: "E2E Admin Browser",
        },
      });
      assert.equal(adminLogin.status, 201, JSON.stringify(adminLogin.body));
      const providerMobileSocket = await connectSocket(
        providerInitial.body.accessToken,
      );
      const providerWebSocket = await connectSocket(
        providerWebLogin.body.accessToken,
      );
      const unrelatedAdminSocket = await connectSocket(
        adminLogin.body.accessToken,
      );
      sockets.push(
        providerMobileSocket,
        providerWebSocket,
        unrelatedAdminSocket,
      );
      let unrelatedReceivedIdentity = false;
      unrelatedAdminSocket.on("account:changed", () => {
        unrelatedReceivedIdentity = true;
      });
      const mobileIdentity = waitForSocketEvent<{ resource: string }>(
        providerMobileSocket,
        "account:changed",
      );
      const webIdentity = waitForSocketEvent<{ resource: string }>(
        providerWebSocket,
        "account:changed",
      );
      const approved = await request<{ data: { status: string } }>(
        `admin/verifications/${verificationRequestId}/approve`,
        { method: "POST", token: adminLogin.body.accessToken },
      );
      assert.equal(approved.status, 201, JSON.stringify(approved.body));
      assert.equal(approved.body.data.status, "APPROVED");
      assert.equal((await mobileIdentity).resource, "identity");
      assert.equal((await webIdentity).resource, "identity");
      assert.equal(unrelatedReceivedIdentity, false);

      const persistedProvider = await prisma.user.findUniqueOrThrow({
        where: { id: providerId },
        include: { roles: true, studentProfile: true },
      });
      assert.ok(
        persistedProvider.roles.some(({ role }) => role === "PROVIDER"),
      );
      assert.equal(
        persistedProvider.studentProfile?.verificationStatus,
        "APPROVED",
      );

      const mobileAccountAfterApproval = await request<Account>("auth/me", {
        token: providerInitial.body.accessToken,
      });
      const webAccountAfterApproval = await request<Account>("auth/me", {
        token: providerWebLogin.body.accessToken,
      });
      assert.equal(mobileAccountAfterApproval.status, 200);
      assert.equal(webAccountAfterApproval.status, 200);
      assert.ok(mobileAccountAfterApproval.body.roles.includes("PROVIDER"));
      assert.ok(webAccountAfterApproval.body.roles.includes("PROVIDER"));

      const providerLogin = await request<Session>("auth/login", {
        method: "POST",
        body: {
          email: providerEmail,
          password: "Journey-Test-934!",
          clientType: "MOBILE",
          deviceName: "E2E Android",
        },
      });
      assert.equal(
        providerLogin.status,
        201,
        JSON.stringify(providerLogin.body),
      );
      assert.ok(providerLogin.body.user.roles.includes("PROVIDER"));
      let providerToken = providerLogin.body.accessToken;
      const providerRefresh = providerLogin.body.refreshToken;
      assert.ok(providerRefresh);

      const profile = await request<{ data: { isAvailable: boolean } }>(
        "provider/profile",
        {
          method: "PUT",
          token: providerToken,
          body: {
            headline: "Reliable end-to-end test provider",
            bio: "This disposable profile validates the complete CampusGig provider journey.",
            skills: ["Testing", "Quality assurance"],
            isAvailable: false,
          },
        },
      );
      assert.equal(profile.status, 200, JSON.stringify(profile.body));
      assert.equal(profile.body.data.isAvailable, false);

      const createdService = await request<{
        data: { id: string; packages: Array<{ id: string }> };
      }>("provider/services", {
        method: "POST",
        token: providerToken,
        body: {
          categoryId: category.id,
          title: `E2E CampusGig Service ${suffix}`,
          description:
            "A disposable service used to validate availability, ordering, messaging, and cleanup behavior.",
          deliveryMethod: "ONLINE",
          packages: [
            {
              tier: "BASIC",
              name: "Journey package",
              description:
                "A deterministic package created only for automated end-to-end validation.",
              priceCentavos: 10000,
              deliveryDays: 2,
              revisionLimit: 1,
            },
          ],
        },
      });
      assert.equal(
        createdService.status,
        201,
        JSON.stringify(createdService.body),
      );
      serviceId = createdService.body.data.id;
      const packageId = createdService.body.data.packages[0]?.id;
      assert.ok(packageId);
      await prisma.service.update({
        where: { id: serviceId },
        data: { status: "PUBLISHED", publishedAt: new Date() },
      });

      const client = await registerAndVerify(
        clientEmail,
        "Journey Client",
        "WEB",
      );
      clientId = client.body.user.id;
      let clientToken = client.body.accessToken;
      let clientCookie = client.cookie;
      assert.ok(clientCookie);

      const unavailableOrder = await request<{ message: string }>("orders", {
        method: "POST",
        token: clientToken,
        body: {
          serviceId,
          servicePackageId: packageId,
          requirements:
            "Validate that unavailable providers cannot receive new requests.",
        },
      });
      assert.equal(unavailableOrder.status, 409);

      const online = await request<{ data: { isAvailable: boolean } }>(
        "provider/availability",
        {
          method: "PUT",
          token: providerToken,
          body: { isAvailable: true },
        },
      );
      assert.equal(online.status, 200, JSON.stringify(online.body));
      assert.equal(online.body.data.isAvailable, true);

      const clientRequestId = randomUUID();
      const orderRequest = {
        clientRequestId,
        serviceId,
        servicePackageId: packageId,
        requirements:
          "Complete the disposable CampusGig critical journey validation.",
      };
      const createdOrder = await request<{
        data: { id: string; status: string };
      }>("orders", {
        method: "POST",
        token: clientToken,
        body: orderRequest,
      });
      assert.equal(createdOrder.status, 201, JSON.stringify(createdOrder.body));
      orderId = createdOrder.body.data.id;
      assert.equal(createdOrder.body.data.status, "REQUESTED");
      const replayedOrder = await request<{ data: { id: string } }>("orders", {
        method: "POST",
        token: clientToken,
        body: orderRequest,
      });
      assert.equal(
        replayedOrder.status,
        201,
        JSON.stringify(replayedOrder.body),
      );
      assert.equal(replayedOrder.body.data.id, orderId);
      const mismatchedReplay = await request<{ message: string }>("orders", {
        method: "POST",
        token: clientToken,
        body: {
          ...orderRequest,
          requirements: "A different service request payload.",
        },
      });
      assert.equal(mismatchedReplay.status, 409);

      const participantSubscription = await emitWithAck<{ ok: boolean }>(
        providerMobileSocket,
        "conversation:subscribe",
        { orderId },
      );
      const unrelatedSubscription = await emitWithAck<{ ok: boolean }>(
        unrelatedAdminSocket,
        "conversation:subscribe",
        { orderId },
      );
      assert.equal(participantSubscription.ok, true);
      assert.equal(unrelatedSubscription.ok, false);

      const accepted = await request<{ data: { status: string } }>(
        `orders/${orderId}/accept`,
        {
          method: "POST",
          token: providerToken,
        },
      );
      assert.equal(accepted.status, 201, JSON.stringify(accepted.body));
      assert.equal(accepted.body.data.status, "ACCEPTED");

      const sent = await request<{ data: { body: string } }>(
        `orders/${orderId}/messages`,
        {
          method: "POST",
          token: clientToken,
          body: { body: "Disposable E2E journey message" },
        },
      );
      assert.equal(sent.status, 201, JSON.stringify(sent.body));
      const messages = await request<{ data: Array<{ body: string }> }>(
        `orders/${orderId}/messages`,
        { token: providerToken },
      );
      assert.equal(messages.status, 200, JSON.stringify(messages.body));
      assert.ok(
        messages.body.data.some(
          (message) => message.body === "Disposable E2E journey message",
        ),
      );

      const payableOrder = await prisma.order.findUniqueOrThrow({
        where: { id: orderId },
        select: {
          subtotalCentavos: true,
          platformFeeCentavos: true,
          totalCentavos: true,
        },
      });
      const paidAt = new Date();
      const payment = await prisma.payment.create({
        data: {
          orderId,
          providerPaymentId: `pay_e2e_${suffix}`,
          providerCheckoutId: `cs_e2e_${suffix}`,
          idempotencyKey: `e2e-paid-${suffix}`,
          amountCentavos: payableOrder.totalCentavos,
          platformFeeCentavos: payableOrder.platformFeeCentavos,
          providerNetCentavos: payableOrder.subtotalCentavos,
          status: "PAID",
          paidAt,
        },
      });
      await prisma.providerEarning.create({
        data: {
          providerId,
          orderId,
          paymentId: payment.id,
          currency: "PHP",
          grossServiceAmountCentavos: payableOrder.subtotalCentavos,
          status: "PENDING",
          pendingAt: paidAt,
          ledgerEntries: {
            create: {
              providerId,
              orderId,
              sourcePaymentId: payment.id,
              type: "EARNING_PENDING_CREDIT",
              amountCentavos: payableOrder.subtotalCentavos,
              currency: "PHP",
              sourceKey: `payment:${payment.id}:earning-pending-credit`,
              createdAt: paidAt,
            },
          },
        },
      });

      const started = await request<{ data: { status: string } }>(
        `orders/${orderId}/start`,
        { method: "POST", token: providerToken },
      );
      assert.equal(started.status, 201, JSON.stringify(started.body));
      assert.equal(started.body.data.status, "IN_PROGRESS");

      const onePixelPng = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      );
      const resolveProviderDispute = async (
        expectedSourceType: "ORIGINAL_ORDER" | "PAID_EXTRA_REVISION",
      ) => {
        const opened = await request<{
          data: { id: string; status: string };
        }>(`orders/${orderId}/disputes`, {
          method: "POST",
          token: clientToken,
          body: {
            reason: "QUALITY_ISSUE",
            details: `Disposable ${expectedSourceType} dispute evidence review.`,
          },
        });
        assert.equal(opened.status, 201, JSON.stringify(opened.body));
        assert.equal(opened.body.data.status, "WAITING_FOR_PROVIDER");

        const persisted = await prisma.orderDispute.findUniqueOrThrow({
          where: { id: opened.body.data.id },
          include: {
            affectedEarnings: { include: { providerEarning: true } },
          },
        });
        assert.ok(persisted.responseRequestedAt);
        assert.ok(persisted.responseDeadlineAt);
        assert.equal(
          persisted.responseDeadlineAt.getTime() -
            persisted.responseRequestedAt.getTime(),
          48 * 60 * 60 * 1_000,
        );
        assert.equal(persisted.affectedEarnings.length, 1);
        assert.equal(
          persisted.affectedEarnings[0].providerEarning.sourceType,
          expectedSourceType,
        );
        assert.equal(
          persisted.affectedEarnings[0].providerEarning.status,
          "FROZEN",
        );

        const responded = await request<{ data: { status: string } }>(
          `orders/${orderId}/disputes/${persisted.id}/responses`,
          {
            method: "POST",
            token: providerToken,
            body: {
              details:
                "Provider response for the disposable dispute review journey.",
            },
          },
        );
        assert.equal(responded.status, 201, JSON.stringify(responded.body));
        assert.equal(responded.body.data.status, "READY_FOR_REVIEW");

        const reviewing = await request<{ data: { status: string } }>(
          `admin/disputes/${persisted.id}/review`,
          { method: "POST", token: adminLogin.body.accessToken },
        );
        assert.equal(reviewing.status, 201, JSON.stringify(reviewing.body));
        assert.equal(reviewing.body.data.status, "UNDER_REVIEW");

        const resolved = await request<{ data: { status: string } }>(
          `admin/disputes/${persisted.id}/resolve`,
          {
            method: "POST",
            token: adminLogin.body.accessToken,
            body: {
              status: "RESOLVED_PROVIDER",
              resolutionNote:
                "Evidence supports the provider; resume the preserved review window.",
            },
          },
        );
        assert.equal(resolved.status, 201, JSON.stringify(resolved.body));
        assert.equal(resolved.body.data.status, "RESOLVED_PROVIDER");

        const restored = await prisma.providerEarning.findUniqueOrThrow({
          where: {
            id: persisted.affectedEarnings[0].providerEarningId,
          },
          include: { ledgerEntries: true },
        });
        assert.equal(restored.status, "PENDING");
        assert.equal(
          restored.ledgerEntries.filter(({ type }) => type === "EARNING_FROZEN")
            .length,
          1,
        );
        assert.equal(
          restored.ledgerEntries.filter(
            ({ type }) => type === "EARNING_UNFROZEN",
          ).length,
          1,
        );
      };
      const firstDelivery = new FormData();
      firstDelivery.set("note", "Initial disposable E2E delivery");
      firstDelivery.set(
        "files",
        new Blob([onePixelPng], { type: "image/png" }),
        `delivery-${suffix}.png`,
      );
      const delivered = await request<{ data: { status: string } }>(
        `orders/${orderId}/deliver`,
        { method: "POST", token: providerToken, body: firstDelivery },
      );
      assert.equal(delivered.status, 201, JSON.stringify(delivered.body));
      assert.equal(delivered.body.data.status, "SUBMITTED");
      await resolveProviderDispute("ORIGINAL_ORDER");

      const revision = await request<{ data: { status: string } }>(
        `orders/${orderId}/revision`,
        {
          method: "POST",
          token: clientToken,
          body: {
            instructions:
              "Please submit the revised disposable E2E deliverable.",
          },
        },
      );
      assert.equal(revision.status, 201, JSON.stringify(revision.body));
      assert.equal(revision.body.data.status, "REVISION_REQUESTED");

      const revisedDelivery = new FormData();
      revisedDelivery.set("note", "Revised disposable E2E delivery");
      revisedDelivery.set(
        "files",
        new Blob([onePixelPng], { type: "image/png" }),
        `revision-${suffix}.png`,
      );
      const resubmitted = await request<{ data: { status: string } }>(
        `orders/${orderId}/deliver`,
        { method: "POST", token: providerToken, body: revisedDelivery },
      );
      assert.equal(resubmitted.status, 201, JSON.stringify(resubmitted.body));
      assert.equal(resubmitted.body.data.status, "SUBMITTED");

      const extraRevisionQuote = await request<{
        data: {
          revisionType: string;
          providerSubtotalCentavos: number;
          platformFeeCentavos: number;
          clientTotalCentavos: number;
          currency: string;
          turnaroundMinutes: number;
          pricingPolicyVersion: number;
          pricingBasisCentavos: number;
          deliveryDurationBasisMinutes: number;
          currentDeliverySubmissionId: string;
        };
      }>(`orders/${orderId}/payments/revision-quote`, {
        token: clientToken,
      });
      assert.equal(
        extraRevisionQuote.status,
        200,
        JSON.stringify(extraRevisionQuote.body),
      );
      assert.equal(extraRevisionQuote.body.data.revisionType, "PAID_EXTRA");
      assert.equal(extraRevisionQuote.body.data.currency, "PHP");
      assert.equal(
        extraRevisionQuote.body.data.clientTotalCentavos,
        extraRevisionQuote.body.data.providerSubtotalCentavos +
          extraRevisionQuote.body.data.platformFeeCentavos,
      );

      const revisionCheckoutId = `cs_revision_e2e_${suffix}`;
      const revisionPurchase = await prisma.orderRevisionPurchase.create({
        data: {
          orderId,
          sourceDeliverySubmissionId:
            extraRevisionQuote.body.data.currentDeliverySubmissionId,
          clientId,
          providerId,
          instructions:
            "Please complete the paid extra disposable E2E revision.",
          providerSubtotalCentavos:
            extraRevisionQuote.body.data.providerSubtotalCentavos,
          platformFeeCentavos: extraRevisionQuote.body.data.platformFeeCentavos,
          totalCentavos: extraRevisionQuote.body.data.clientTotalCentavos,
          currency: extraRevisionQuote.body.data.currency,
          turnaroundMinutes: extraRevisionQuote.body.data.turnaroundMinutes,
          pricingPolicyVersion:
            extraRevisionQuote.body.data.pricingPolicyVersion,
          pricingBasisCentavos:
            extraRevisionQuote.body.data.pricingBasisCentavos,
          deliveryDurationBasisMinutes:
            extraRevisionQuote.body.data.deliveryDurationBasisMinutes,
          providerCheckoutId: revisionCheckoutId,
          checkoutUrl: `https://checkout.example.test/${revisionCheckoutId}`,
          idempotencyKey: `revision-checkout-e2e-${suffix}`,
          paymentStatus: "REQUIRES_ACTION",
        },
      });
      const beforeRevisionWebhook =
        await prisma.orderRevisionPurchase.findUniqueOrThrow({
          where: { id: revisionPurchase.id },
          select: {
            paymentStatus: true,
            activationStatus: true,
            revisionRequestId: true,
          },
        });
      assert.deepEqual(beforeRevisionWebhook, {
        paymentStatus: "REQUIRES_ACTION",
        activationStatus: "PENDING",
        revisionRequestId: null,
      });

      revisionWebhookEventId = `evt_revision_e2e_${suffix}`;
      const webhookSecret = process.env.PAYMONGO_WEBHOOK_SECRET;
      assert.ok(
        webhookSecret,
        "PAYMONGO_WEBHOOK_SECRET is required for the signed E2E webhook",
      );
      const webhookBody = JSON.stringify({
        data: {
          id: revisionWebhookEventId,
          type: "event",
          attributes: {
            type: "checkout_session.payment.paid",
            livemode: false,
            data: {
              id: revisionCheckoutId,
              type: "checkout_session",
              attributes: {
                payments: [
                  {
                    id: `pay_revision_e2e_${suffix}`,
                    attributes: {
                      amount: extraRevisionQuote.body.data.clientTotalCentavos,
                      currency: extraRevisionQuote.body.data.currency,
                      paid_at: Math.floor(Date.now() / 1_000),
                    },
                  },
                ],
              },
            },
          },
        },
      });
      const webhookTimestamp = Math.floor(Date.now() / 1_000).toString();
      const webhookSignature = createHmac("sha256", webhookSecret)
        .update(`${webhookTimestamp}.${webhookBody}`)
        .digest("hex");
      const revisionWebhook = await fetch(
        `${baseUrl}/payments/paymongo/webhook`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "paymongo-signature": `t=${webhookTimestamp},te=${webhookSignature}`,
          },
          body: webhookBody,
        },
      );
      assert.equal(revisionWebhook.status, 201, await revisionWebhook.text());

      const activatedPurchase =
        await prisma.orderRevisionPurchase.findUniqueOrThrow({
          where: { id: revisionPurchase.id },
          include: {
            revisionRequest: true,
            providerEarning: {
              include: { ledgerEntries: true },
            },
          },
        });
      assert.equal(activatedPurchase.paymentStatus, "PAID");
      assert.equal(activatedPurchase.activationStatus, "ACTIVATED");
      assert.equal(activatedPurchase.revisionRequest?.type, "PAID_EXTRA");
      assert.equal(activatedPurchase.revisionRequest?.status, "OPEN");
      assert.equal(activatedPurchase.providerEarning?.status, "PENDING");
      assert.equal(
        activatedPurchase.providerEarning?.grossServiceAmountCentavos,
        extraRevisionQuote.body.data.providerSubtotalCentavos,
      );
      assert.deepEqual(
        activatedPurchase.providerEarning?.ledgerEntries.map((entry) => [
          entry.type,
          entry.amountCentavos,
        ]),
        [
          [
            "EARNING_PENDING_CREDIT",
            extraRevisionQuote.body.data.providerSubtotalCentavos,
          ],
        ],
      );
      const originalPendingEarning =
        await prisma.providerEarning.findFirstOrThrow({
          where: { orderId, sourceType: "ORIGINAL_ORDER" },
        });
      assert.equal(originalPendingEarning.status, "PENDING");

      const paidRevisionDelivery = new FormData();
      paidRevisionDelivery.set(
        "note",
        "Paid extra revised disposable E2E delivery",
      );
      paidRevisionDelivery.set(
        "files",
        new Blob([onePixelPng], { type: "image/png" }),
        `paid-revision-${suffix}.png`,
      );
      const paidRevisionResubmitted = await request<{
        data: { status: string };
      }>(`orders/${orderId}/deliver`, {
        method: "POST",
        token: providerToken,
        body: paidRevisionDelivery,
      });
      assert.equal(
        paidRevisionResubmitted.status,
        201,
        JSON.stringify(paidRevisionResubmitted.body),
      );
      assert.equal(paidRevisionResubmitted.body.data.status, "SUBMITTED");
      await resolveProviderDispute("PAID_EXTRA_REVISION");

      const completed = await request<{ data: { status: string } }>(
        `orders/${orderId}/complete`,
        { method: "POST", token: clientToken },
      );
      assert.equal(completed.status, 201, JSON.stringify(completed.body));
      assert.equal(completed.body.data.status, "COMPLETED");
      const releasedEarning = await prisma.providerEarning.findFirstOrThrow({
        where: { orderId, sourceType: "ORIGINAL_ORDER" },
        include: { ledgerEntries: { orderBy: { createdAt: "asc" } } },
      });
      assert.equal(releasedEarning.status, "AVAILABLE");
      assert.equal(
        releasedEarning.grossServiceAmountCentavos,
        payableOrder.subtotalCentavos,
      );
      assert.deepEqual(
        releasedEarning.ledgerEntries.map((entry) => [
          entry.type,
          entry.amountCentavos,
        ]),
        [
          ["EARNING_PENDING_CREDIT", payableOrder.subtotalCentavos],
          ["EARNING_FROZEN", 0],
          ["EARNING_UNFROZEN", 0],
          ["EARNING_AVAILABLE_RELEASE", 0],
        ],
      );
      const releasedRevisionEarning =
        await prisma.providerEarning.findFirstOrThrow({
          where: { orderId, sourceType: "PAID_EXTRA_REVISION" },
          include: { ledgerEntries: { orderBy: { createdAt: "asc" } } },
        });
      assert.equal(releasedRevisionEarning.status, "AVAILABLE");
      assert.equal(
        releasedRevisionEarning.grossServiceAmountCentavos,
        extraRevisionQuote.body.data.providerSubtotalCentavos,
      );
      assert.deepEqual(
        releasedRevisionEarning.ledgerEntries.map((entry) => [
          entry.type,
          entry.amountCentavos,
        ]),
        [
          [
            "EARNING_PENDING_CREDIT",
            extraRevisionQuote.body.data.providerSubtotalCentavos,
          ],
          ["EARNING_FROZEN", 0],
          ["EARNING_UNFROZEN", 0],
          ["EARNING_AVAILABLE_RELEASE", 0],
        ],
      );

      const reviewed = await request<{ data: { overallRating: number } }>(
        `orders/${orderId}/review`,
        {
          method: "POST",
          token: clientToken,
          body: {
            overallRating: 5,
            qualityRating: 5,
            communicationRating: 5,
            timelinessRating: 5,
            comment: "Disposable E2E review for the completed journey.",
          },
        },
      );
      assert.equal(reviewed.status, 201, JSON.stringify(reviewed.body));
      assert.equal(reviewed.body.data.overallRating, 5);

      const completedProvider = await prisma.studentProfile.findUniqueOrThrow({
        where: { userId: providerId },
        select: {
          completedOrderCount: true,
          ratingAverage: true,
          reviewCount: true,
        },
      });
      assert.equal(completedProvider.completedOrderCount, 1);
      assert.equal(Number(completedProvider.ratingAverage), 5);
      assert.equal(completedProvider.reviewCount, 1);

      const clientWinOpened = await request<{
        data: { id: string; status: string };
      }>(`orders/${orderId}/disputes`, {
        method: "POST",
        token: clientToken,
        body: {
          reason: "PAYMENT_ISSUE",
          details:
            "Disposable post-acceptance payment escalation for client-win validation.",
        },
      });
      assert.equal(
        clientWinOpened.status,
        201,
        JSON.stringify(clientWinOpened.body),
      );
      const clientWinDispute = await prisma.orderDispute.findUniqueOrThrow({
        where: { id: clientWinOpened.body.data.id },
        include: {
          affectedEarnings: { include: { providerEarning: true } },
        },
      });
      assert.equal(clientWinDispute.affectedEarnings.length, 1);
      assert.equal(
        clientWinDispute.affectedEarnings[0].providerEarning.sourceType,
        "PAID_EXTRA_REVISION",
      );
      assert.equal(
        clientWinDispute.affectedEarnings[0].preFreezeStatus,
        "AVAILABLE",
      );
      assert.equal(
        clientWinDispute.affectedEarnings[0].providerEarning.status,
        "FROZEN",
      );

      const clientWinResponse = await request<{ data: { status: string } }>(
        `orders/${orderId}/disputes/${clientWinDispute.id}/responses`,
        {
          method: "POST",
          token: providerToken,
          body: {
            details:
              "Provider response for the client-win financial boundary journey.",
          },
        },
      );
      assert.equal(clientWinResponse.status, 201);
      assert.equal(clientWinResponse.body.data.status, "READY_FOR_REVIEW");
      const clientWinReview = await request<{ data: { status: string } }>(
        `admin/disputes/${clientWinDispute.id}/review`,
        { method: "POST", token: adminLogin.body.accessToken },
      );
      assert.equal(clientWinReview.status, 201);
      assert.equal(clientWinReview.body.data.status, "UNDER_REVIEW");
      const clientWinResolution = await request<{
        data: { status: string };
      }>(`admin/disputes/${clientWinDispute.id}/resolve`, {
        method: "POST",
        token: adminLogin.body.accessToken,
        body: {
          status: "RESOLVED_CLIENT",
          resolutionNote:
            "Client-favoring decision recorded; financial remediation remains pending.",
        },
      });
      assert.equal(clientWinResolution.status, 201);
      assert.equal(clientWinResolution.body.data.status, "RESOLVED_CLIENT");

      const duplicateClientWin = await request<{ data: { status: string } }>(
        `admin/disputes/${clientWinDispute.id}/resolve`,
        {
          method: "POST",
          token: adminLogin.body.accessToken,
          body: {
            status: "RESOLVED_CLIENT",
            resolutionNote:
              "Client-favoring decision recorded; financial remediation remains pending.",
          },
        },
      );
      assert.equal(duplicateClientWin.status, 201);
      assert.equal(duplicateClientWin.body.data.status, "RESOLVED_CLIENT");
      assert.equal(
        await prisma.disputeTimelineEvent.count({
          where: { disputeId: clientWinDispute.id, type: "RESOLVED_CLIENT" },
        }),
        1,
      );

      const clientWinEarnings = await prisma.providerEarning.findMany({
        where: { orderId },
        include: { ledgerEntries: true },
      });
      assert.equal(
        clientWinEarnings.find(
          ({ sourceType }) => sourceType === "ORIGINAL_ORDER",
        )?.status,
        "AVAILABLE",
      );
      const clientWinPaidRevision = clientWinEarnings.find(
        ({ sourceType }) => sourceType === "PAID_EXTRA_REVISION",
      );
      assert.equal(clientWinPaidRevision?.status, "FROZEN");
      assert.equal(
        clientWinPaidRevision?.ledgerEntries.filter(
          ({ type }) => type === "EARNING_UNFROZEN",
        ).length,
        1,
      );
      assert.ok(
        clientWinEarnings.every((earning) =>
          earning.ledgerEntries.every(
            ({ amountCentavos }) => amountCentavos >= 0,
          ),
        ),
      );
      assert.equal(
        await prisma.paymentRefund.count({ where: { payment: { orderId } } }),
        0,
      );

      const listOrderIds = async (
        token: string,
        scope: "client" | "provider",
        view: "active" | "archived",
      ) => {
        const response = await request<{ data: { id: string }[] }>(
          `orders?scope=${scope}&view=${view}`,
          { token },
        );
        assert.equal(response.status, 200, JSON.stringify(response.body));
        return response.body.data.map(({ id }) => id);
      };
      assert.ok(
        (await listOrderIds(clientToken, "client", "active")).includes(orderId),
      );
      assert.ok(
        (await listOrderIds(providerToken, "provider", "active")).includes(
          orderId,
        ),
      );

      const clientArchive = await request(`orders/${orderId}/archive`, {
        method: "POST",
        token: clientToken,
      });
      assert.equal(
        clientArchive.status,
        201,
        JSON.stringify(clientArchive.body),
      );
      assert.ok(
        !(await listOrderIds(clientToken, "client", "active")).includes(
          orderId,
        ),
      );
      assert.ok(
        (await listOrderIds(clientToken, "client", "archived")).includes(
          orderId,
        ),
      );
      assert.ok(
        (await listOrderIds(providerToken, "provider", "active")).includes(
          orderId,
        ),
      );

      const clientRestore = await request(`orders/${orderId}/restore`, {
        method: "POST",
        token: clientToken,
      });
      assert.equal(
        clientRestore.status,
        201,
        JSON.stringify(clientRestore.body),
      );
      assert.ok(
        (await listOrderIds(clientToken, "client", "active")).includes(orderId),
      );

      const providerArchive = await request(`orders/${orderId}/archive`, {
        method: "POST",
        token: providerToken,
      });
      assert.equal(
        providerArchive.status,
        201,
        JSON.stringify(providerArchive.body),
      );
      assert.ok(
        !(await listOrderIds(providerToken, "provider", "active")).includes(
          orderId,
        ),
      );
      assert.ok(
        (await listOrderIds(providerToken, "provider", "archived")).includes(
          orderId,
        ),
      );
      assert.ok(
        (await listOrderIds(clientToken, "client", "active")).includes(orderId),
      );

      const providerRestore = await request(`orders/${orderId}/restore`, {
        method: "POST",
        token: providerToken,
      });
      assert.equal(
        providerRestore.status,
        201,
        JSON.stringify(providerRestore.body),
      );

      const clientRemove = await request(`orders/${orderId}/remove`, {
        method: "POST",
        token: clientToken,
      });
      assert.equal(clientRemove.status, 201, JSON.stringify(clientRemove.body));
      assert.ok(
        !(await listOrderIds(clientToken, "client", "active")).includes(
          orderId,
        ),
      );
      assert.ok(
        !(await listOrderIds(clientToken, "client", "archived")).includes(
          orderId,
        ),
      );
      assert.ok(
        (await listOrderIds(providerToken, "provider", "active")).includes(
          orderId,
        ),
      );
      const retainedOrder = await request<{ data: { status: string } }>(
        `orders/${orderId}`,
        { token: clientToken },
      );
      assert.equal(
        retainedOrder.status,
        200,
        JSON.stringify(retainedOrder.body),
      );
      assert.equal(retainedOrder.body.data.status, "COMPLETED");
      assert.equal(await prisma.payment.count({ where: { orderId } }), 1);
      assert.equal(await prisma.review.count({ where: { orderId } }), 1);
      const retainedProviderTotals =
        await prisma.studentProfile.findUniqueOrThrow({
          where: { userId: providerId },
          select: {
            completedOrderCount: true,
            ratingAverage: true,
            reviewCount: true,
          },
        });
      assert.equal(retainedProviderTotals.completedOrderCount, 1);
      assert.equal(Number(retainedProviderTotals.ratingAverage), 5);
      assert.equal(retainedProviderTotals.reviewCount, 1);

      const lifecycle = await prisma.orderStatusHistory.findMany({
        where: { orderId },
        orderBy: { createdAt: "asc" },
        select: { toStatus: true },
      });
      assert.deepEqual(
        lifecycle.map(({ toStatus }) => toStatus),
        [
          "REQUESTED",
          "ACCEPTED",
          "IN_PROGRESS",
          "SUBMITTED",
          "REVISION_REQUESTED",
          "SUBMITTED",
          "REVISION_REQUESTED",
          "SUBMITTED",
          "COMPLETED",
        ],
      );

      const browserRefresh = await request<Session>("auth/refresh", {
        method: "POST",
        cookie: clientCookie,
        body: {},
      });
      assert.equal(
        browserRefresh.status,
        200,
        JSON.stringify(browserRefresh.body),
      );
      assert.equal(browserRefresh.body.refreshToken, undefined);
      assert.ok(browserRefresh.cookie);
      clientToken = browserRefresh.body.accessToken;
      clientCookie = browserRefresh.cookie;

      const mobileRefresh = await request<Session>("auth/refresh", {
        method: "POST",
        body: { refreshToken: providerRefresh },
      });
      assert.equal(
        mobileRefresh.status,
        200,
        JSON.stringify(mobileRefresh.body),
      );
      assert.ok(mobileRefresh.body.refreshToken);
      assert.notEqual(mobileRefresh.body.refreshToken, providerRefresh);
      providerToken = mobileRefresh.body.accessToken;

      const sessions = await request<{
        data: Array<{ clientType: string; current: boolean }>;
      }>("auth/sessions", { token: clientToken });
      assert.equal(sessions.status, 200, JSON.stringify(sessions.body));
      assert.ok(
        sessions.body.data.some(
          (session) => session.clientType === "WEB" && session.current,
        ),
      );

      const logout = await request<{ revoked: number }>("auth/logout", {
        method: "POST",
        cookie: clientCookie,
        body: {},
      });
      assert.equal(logout.status, 200, JSON.stringify(logout.body));
      assert.equal(logout.body.revoked, 1);
      const revokedAccess = await request("auth/me", { token: clientToken });
      assert.equal(revokedAccess.status, 401);

      const mobileDisconnected = waitForSocketEvent(
        providerMobileSocket,
        "disconnect",
      );
      const webDisconnected = waitForSocketEvent(
        providerWebSocket,
        "disconnect",
      );
      const logoutAll = await request<{ revoked: number }>("auth/logout-all", {
        method: "POST",
        token: providerToken,
      });
      assert.equal(logoutAll.status, 201, JSON.stringify(logoutAll.body));
      assert.ok(logoutAll.body.revoked >= 1);
      await Promise.all([mobileDisconnected, webDisconnected]);
      const revokedProvider = await request("auth/me", {
        token: providerToken,
      });
      assert.equal(revokedProvider.status, 401);

      const revokedSocket = io(realtimeUrl, {
        auth: { token: providerToken },
        transports: ["websocket"],
        reconnection: false,
        forceNew: true,
      });
      sockets.push(revokedSocket);
      const rejectedSocketDisconnected = waitForSocketEvent(
        revokedSocket,
        "disconnect",
      );
      const realtimeError = await waitForSocketEvent<{ message: string }>(
        revokedSocket,
        "realtime:error",
      );
      assert.equal(realtimeError.message, "Authentication required");
      await rejectedSocketDisconnected;
      assert.equal(revokedSocket.connected, false);
    } finally {
      try {
        sockets.forEach((socket) => socket.disconnect());
        if (orderId) {
          const storedFiles = await prisma.orderFile.findMany({
            where: { orderId },
            select: { storagePath: true },
          });
          await Promise.all(
            storedFiles.map(({ storagePath }) => {
              assert.match(
                storagePath,
                /^[a-zA-Z0-9._-]+$/,
                "E2E cleanup refused an unsafe storage key",
              );
              return unlink(resolve(localOrderFilesRoot, storagePath)).catch(
                () => undefined,
              );
            }),
          );
          await prisma.paymentRefund.deleteMany({
            where: { payment: { orderId } },
          });
          await prisma.disputeEvidence.deleteMany({
            where: { dispute: { orderId } },
          });
          await prisma.disputeResponse.deleteMany({
            where: { dispute: { orderId } },
          });
          await prisma.disputeTimelineEvent.deleteMany({
            where: { dispute: { orderId } },
          });
          await prisma.disputeAffectedEarning.deleteMany({
            where: { dispute: { orderId } },
          });
          await prisma.orderDispute.deleteMany({ where: { orderId } });
          await prisma.providerEarningLedgerEntry.deleteMany({
            where: { orderId },
          });
          await prisma.providerEarning.deleteMany({ where: { orderId } });
          await prisma.payment.deleteMany({ where: { orderId } });
          await prisma.orderRevisionPurchase.deleteMany({
            where: { orderId },
          });
          await prisma.review.deleteMany({ where: { orderId } });
          await prisma.order.deleteMany({ where: { id: orderId } });
        }
        if (revisionWebhookEventId)
          await prisma.paymentWebhookEvent.deleteMany({
            where: { providerEventId: revisionWebhookEventId },
          });
        if (serviceId)
          await prisma.service.deleteMany({ where: { id: serviceId } });
        if (verificationRequestId)
          await prisma.verificationRequest.deleteMany({
            where: { id: verificationRequestId },
          });
        await prisma.user.deleteMany({
          where: { email: { in: [providerEmail, clientEmail, adminEmail] } },
        });
        if (fixtureSchoolId)
          await prisma.school.deleteMany({ where: { id: fixtureSchoolId } });
        if (fixtureCategoryId)
          await prisma.category.deleteMany({
            where: { id: fixtureCategoryId },
          });
        const remainingUsers = await prisma.user.count({
          where: { email: { in: [providerEmail, clientEmail, adminEmail] } },
        });
        assert.equal(
          remainingUsers,
          0,
          "Disposable E2E accounts were not fully removed",
        );
      } finally {
        await prisma.$disconnect();
      }
    }
  },
);
