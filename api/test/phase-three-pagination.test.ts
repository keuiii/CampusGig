import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { AdminService } from "../src/modules/admin/admin.service";
import { DisputesService } from "../src/modules/disputes/disputes.service";
import {
  decodeConversationCursor,
  encodeConversationCursor,
} from "../src/modules/messages/conversation-cursor";
import { MessagesService } from "../src/modules/messages/messages.service";
import { ListConversationsDto } from "../src/modules/messages/dto/list-conversations.dto";
import { VerificationService } from "../src/modules/profile/verification.service";

const userId = "00000000-0000-0000-0000-000000000001";
const otherId = "00000000-0000-0000-0000-000000000002";

test("conversation cursors preserve pin, activity, and id tie-breakers", () => {
  const cursor = {
    pinned: true,
    updatedAt: new Date("2026-10-01T01:02:03.000Z"),
    id: "00000000-0000-0000-0000-000000000003",
    snapshotAt: new Date("2026-10-01T01:03:00.000Z"),
  };
  assert.deepEqual(
    decodeConversationCursor(encodeConversationCursor(cursor)),
    cursor,
  );
  assert.throws(() => decodeConversationCursor("invalid"), BadRequestException);
});

test("conversation query defaults, explicit limits, and maximum limits validate", async () => {
  const defaultQuery = plainToInstance(ListConversationsDto, {});
  const explicitQuery = plainToInstance(ListConversationsDto, {
    limit: "7",
    archived: "true",
  });
  const excessiveQuery = plainToInstance(ListConversationsDto, {
    limit: "101",
  });

  assert.equal(defaultQuery.limit, 20);
  assert.equal(explicitQuery.limit, 7);
  assert.equal(explicitQuery.archived, true);
  assert.deepEqual(await validate(explicitQuery), []);
  assert.equal((await validate(excessiveQuery)).length, 1);
});

test("conversation inbox uses a fixed two-query page without per-row counts", async () => {
  const createdAt = new Date("2026-10-01T01:00:00.000Z");
  const firstId = "00000000-0000-0000-0000-000000000004";
  const secondId = "00000000-0000-0000-0000-000000000003";
  let rawQueries = 0;
  let findManyQueries = 0;
  const service = new MessagesService({
    $queryRaw: async (query: { strings: string[]; values: unknown[] }) => {
      rawQueries++;
      assert.match(
        query.strings.join(" "),
        /ORDER BY.*isPinned.*updatedAt.*id/s,
      );
      const rows = [
        {
          id: firstId,
          isPinned: true,
          updatedAt: createdAt,
          unreadCount: 2n,
          totalUnreadCount: 3n,
        },
        {
          id: secondId,
          isPinned: false,
          updatedAt: createdAt,
          unreadCount: 1n,
          totalUnreadCount: 3n,
        },
      ];
      return rawQueries === 1 ? rows : rows.slice(1);
    },
    conversation: {
      findMany: async (query: any) => {
        findManyQueries++;
        return query.where.id.in.map((id: string) => ({
          id,
          kind: "INQUIRY",
          clientId: userId,
          createdAt,
          participants: [
            { lastReadAt: null, pinnedAt: createdAt, archivedAt: null },
          ],
          order: null,
          client: {
            id: userId,
            displayName: "Client",
            avatarPath: null,
            updatedAt: createdAt,
          },
          provider: {
            id: otherId,
            displayName: "Provider",
            avatarPath: null,
            updatedAt: createdAt,
          },
          messages: [],
        }));
      },
    },
    message: {
      count: async () =>
        assert.fail("inbox must not issue per-conversation counts"),
    },
  } as never);

  const first = await service.inbox(userId, false, undefined, 1);
  const second = await service.inbox(
    userId,
    false,
    first.pagination.nextCursor ?? undefined,
    1,
  );

  assert.equal(rawQueries, 2);
  assert.equal(findManyQueries, 2);
  assert.equal(first.pagination.hasMore, true);
  assert.equal(first.data[0].id, firstId);
  assert.equal(first.data[0].unreadCount, 2);
  assert.equal(first.unreadCount, 3);
  assert.equal(second.pagination.hasMore, false);
  assert.equal(second.data[0].id, secondId);
  assert.notEqual(first.data[0].id, second.data[0].id);
});

test("inbox query count stays constant as the page grows", async () => {
  const run = async (rowCount: number) => {
    const createdAt = new Date("2026-10-01T01:00:00.000Z");
    let queries = 0;
    const ranks = Array.from({ length: rowCount }, (_, index) => ({
      id: `00000000-0000-0000-0000-${String(index + 10).padStart(12, "0")}`,
      isPinned: false,
      updatedAt: createdAt,
      unreadCount: 0n,
      totalUnreadCount: 0n,
    }));
    const service = new MessagesService({
      $queryRaw: async () => {
        queries++;
        return ranks;
      },
      conversation: {
        findMany: async (query: any) => {
          queries++;
          return query.where.id.in.map((id: string) => ({
            id,
            kind: "INQUIRY",
            clientId: userId,
            createdAt,
            order: null,
            client: {
              id: userId,
              displayName: "Client",
              avatarPath: null,
              updatedAt: createdAt,
            },
            provider: {
              id: otherId,
              displayName: "Provider",
              avatarPath: null,
              updatedAt: createdAt,
            },
            messages: [],
          }));
        },
      },
    } as never);

    const result = await service.inbox(userId, false, undefined, 20);
    return { queries, rows: result.data.length };
  };

  assert.deepEqual(await run(1), { queries: 2, rows: 1 });
  assert.deepEqual(await run(10), { queries: 2, rows: 10 });
});

test("pending service moderation is bounded and uses a stable tie-breaker", async () => {
  const rows = [1, 2, 3].map((value) => ({
    id: `00000000-0000-0000-0000-00000000000${value}`,
    updatedAt: new Date(`2026-10-01T00:00:0${value}.000Z`),
  }));
  let query: any;
  const service = new AdminService(
    {
      service: {
        findMany: async (input: any) => {
          query = input;
          return rows;
        },
      },
    } as never,
    {} as never,
  );

  const result = await service.listPendingServices(undefined, 2);

  assert.equal(query.take, 3);
  assert.deepEqual(query.orderBy, [{ updatedAt: "asc" }, { id: "asc" }]);
  assert.equal(result.data.length, 2);
  assert.equal(result.pagination.hasMore, true);
  assert.ok(result.pagination.nextCursor);
});

test("school administrators, verifications, and disputes use bounded stable pages", async () => {
  const queries: Record<string, any> = {};
  const admin = new AdminService(
    {
      schoolAdminAssignment: {
        findMany: async (input: any) => {
          queries.schoolAdmins = input;
          return [];
        },
      },
    } as never,
    {} as never,
  );
  const verifications = new VerificationService(
    {
      schoolAdminAssignment: {
        findUnique: async () => ({ schoolId: "school-1" }),
      },
      verificationRequest: {
        findMany: async (input: any) => {
          queries.verifications = input;
          return [];
        },
      },
      user: { findMany: async () => [] },
    } as never,
    {} as never,
    {} as never,
  );
  const disputes = new DisputesService({
    orderDispute: {
      findMany: async (input: any) => {
        queries.disputes = input;
        return [];
      },
    },
  } as never);

  const [adminPage, verificationPage, disputePage] = await Promise.all([
    admin.listSchoolAdmins(undefined, 4),
    verifications.listPending(userId, false, undefined, 5),
    disputes.list("OPEN", undefined, 6),
  ]);

  assert.equal(queries.schoolAdmins.take, 5);
  assert.deepEqual(queries.schoolAdmins.orderBy, [
    { createdAt: "desc" },
    { userId: "desc" },
  ]);
  assert.equal(queries.verifications.take, 6);
  assert.equal(queries.verifications.where.schoolId, "school-1");
  assert.deepEqual(queries.verifications.orderBy, [
    { submittedAt: "asc" },
    { id: "asc" },
  ]);
  assert.equal(queries.disputes.take, 7);
  assert.equal(queries.disputes.where.status, "OPEN");
  assert.deepEqual(queries.disputes.orderBy, [
    { createdAt: "asc" },
    { id: "asc" },
  ]);
  for (const page of [adminPage, verificationPage, disputePage])
    assert.deepEqual(page.pagination, { hasMore: false, nextCursor: null });
});
