import assert from "node:assert/strict";
import test from "node:test";
import "reflect-metadata";
import { BadRequestException, ParseUUIDPipe } from "@nestjs/common";
import { ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { AdminController } from "../src/modules/admin/admin.controller";
import { AuthController } from "../src/modules/auth/auth.controller";
import { AdminDisputesController } from "../src/modules/disputes/admin-disputes.controller";
import { DisputesController } from "../src/modules/disputes/disputes.controller";
import { ConversationInboxController } from "../src/modules/messages/conversation-inbox.controller";
import { MessagesController } from "../src/modules/messages/messages.controller";
import { NotificationsController } from "../src/modules/notifications/notifications.controller";
import { OrdersController } from "../src/modules/orders/orders.controller";
import { PaymentsController } from "../src/modules/payments/payments.controller";
import { AdminRefundsController } from "../src/modules/payments/admin-refunds.controller";
import { AdminPayoutsController } from "../src/modules/payments/admin-payouts.controller";
import { ProviderPayoutsController } from "../src/modules/payments/provider-payouts.controller";
import {
  AccountProfileController,
  ProfileController,
} from "../src/modules/profile/profile.controller";
import { ProviderController } from "../src/modules/provider/provider.controller";
import { PublicProviderController } from "../src/modules/provider/public-provider.controller";
import {
  AdminSchoolsController,
  SchoolsController,
} from "../src/modules/schools/schools.controller";
import { ServicesController } from "../src/modules/services/services.controller";

type ControllerType = { prototype: object; name: string };
type RouteArgumentMetadata = {
  data?: unknown;
  pipes?: unknown[];
};

const controllers: ControllerType[] = [
  AdminController,
  AuthController,
  AdminDisputesController,
  DisputesController,
  ConversationInboxController,
  MessagesController,
  NotificationsController,
  OrdersController,
  PaymentsController,
  AdminRefundsController,
  AdminPayoutsController,
  ProviderPayoutsController,
  AccountProfileController,
  ProfileController,
  ProviderController,
  PublicProviderController,
  AdminSchoolsController,
  SchoolsController,
  ServicesController,
];
const uuidParameterNames = new Set([
  "conversationId",
  "fileId",
  "id",
  "mediaId",
  "orderId",
  "revisionId",
  "revisionPurchaseId",
  "disputeId",
  "destinationId",
  "payoutId",
  "userId",
]);

test("malformed UUID route parameters produce a safe 400 before handler work", async () => {
  const pipe = new ParseUUIDPipe();
  let handlerInvoked = false;
  const invoke = async (value: string) => {
    const id = await pipe.transform(value, { type: "param", data: "id" });
    handlerInvoked = true;
    return id;
  };

  await assert.rejects(invoke("not-a-uuid"), (error: unknown) => {
    assert.ok(error instanceof BadRequestException);
    assert.equal(error.getStatus(), 400);
    assert.doesNotMatch(
      JSON.stringify(error.getResponse()),
      /prisma|postgres|sql|stack|database/i,
    );
    return true;
  });
  assert.equal(handlerInvoked, false);

  const validId = "9c3f7862-17f2-4ce7-99b1-d94982169cf2";
  assert.equal(await invoke(validId), validId);
  assert.equal(handlerInvoked, true);
});

test("every UUID controller parameter is protected by ParseUUIDPipe", () => {
  const validatedParameters: string[] = [];

  for (const controller of controllers) {
    for (const methodName of Object.getOwnPropertyNames(controller.prototype)) {
      if (methodName === "constructor") continue;
      const metadata = Reflect.getMetadata(
        ROUTE_ARGS_METADATA,
        controller,
        methodName,
      ) as Record<string, RouteArgumentMetadata> | undefined;
      for (const argument of Object.values(metadata ?? {})) {
        if (
          typeof argument.data !== "string" ||
          !uuidParameterNames.has(argument.data)
        ) {
          continue;
        }
        const hasUuidPipe = argument.pipes?.some(
          (pipe) => pipe === ParseUUIDPipe || pipe instanceof ParseUUIDPipe,
        );
        assert.ok(
          hasUuidPipe,
          `${controller.name}.${methodName} parameter ${argument.data} must use ParseUUIDPipe`,
        );
        validatedParameters.push(
          `${controller.name}.${methodName}:${argument.data}`,
        );
      }
    }
  }

  assert.equal(validatedParameters.length, 89);
});
