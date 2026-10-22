import assert from "node:assert/strict";
import test from "node:test";
import { HttpException, HttpStatus } from "@nestjs/common";
import { SupportService } from "../src/modules/support/support.service";

test("support tickets are trimmed, persisted, and return a stable reference", async () => {
  let createInput: unknown;
  const prisma = {
    supportTicket: {
      count: async () => 0,
      create: async (input: unknown) => {
        createInput = input;
        return {
          id: "12345678-aaaa-bbbb-cccc-123456789012",
          category: "TECHNICAL",
          status: "OPEN",
          subject: "App freezes",
          createdAt: new Date("2026-09-24T00:00:00Z"),
        };
      },
    },
  };

  const result = await new SupportService(prisma as never).create(
    "user-1",
    "TECHNICAL",
    "  App freezes  ",
    "  The app freezes after opening the order workspace.  ",
    "MOBILE",
  );

  assert.equal(result.reference, "CG-SUPPORT-12345678");
  assert.match(JSON.stringify(createInput), /"subject":"App freezes"/);
  assert.match(JSON.stringify(createInput), /"source":"MOBILE"/);
});

test("support ticket submission is rate limited per account", async () => {
  const prisma = {
    supportTicket: {
      count: async () => 5,
      create: async () => {
        throw new Error("must not create");
      },
    },
  };

  await assert.rejects(
    () =>
      new SupportService(prisma as never).create(
        "user-1",
        "OTHER",
        "Need support",
        "A sufficiently detailed support request message.",
        "WEB",
      ),
    (error: unknown) =>
      error instanceof HttpException &&
      error.getStatus() === HttpStatus.TOO_MANY_REQUESTS,
  );
});
