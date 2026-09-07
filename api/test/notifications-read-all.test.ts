import assert from "node:assert/strict";
import test from "node:test";
import { NotificationsService } from "../src/modules/notifications/notifications.service";

test("read all updates only unread notifications owned by the authenticated user", async () => {
  let update: any;
  const prisma = {
    notification: {
      updateMany: async (input: unknown) => {
        update = input;
        return { count: 3 };
      },
    },
  };
  const service = new NotificationsService(prisma as never);
  const result = await service.markAllRead("user-1");

  assert.deepEqual(update.where, { recipientId: "user-1", readAt: null });
  assert.ok(update.data.readAt instanceof Date);
  assert.equal(result.updated, 3);
  assert.equal(result.message, "3 notifications marked as read.");
});
