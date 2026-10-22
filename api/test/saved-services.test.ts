import assert from "node:assert/strict";
import test from "node:test";
import { NotFoundException } from "@nestjs/common";
import { ServicesService } from "../src/modules/services/services.service";

const userId = "00000000-0000-0000-0000-000000000001";
const serviceId = "00000000-0000-0000-0000-000000000002";

test("saved-only pages filter in SQL before counting and pagination", async () => {
  const queries: { strings: string[]; values: unknown[] }[] = [];
  const service = new ServicesService({
    $queryRaw: async (query: { strings: string[]; values: unknown[] }) => {
      queries.push(query);
      return queries.length === 1 ? [{ total: 0n }] : [];
    },
  } as never);
  const result = await service.findAll({ page: 2 }, userId);
  assert.equal(result.total, 0);
  assert.equal(result.page, 2);
  assert.match(
    queries[0].strings.join(" "),
    /EXISTS.*SavedService.*serviceId.*userId/s,
  );
  assert.ok(queries[0].values.includes(userId));
});

test("saving validates public visibility and uses a race-safe insert", async () => {
  let visible = false;
  let inserted = false;
  const service = new ServicesService({
    savedService: {
      createMany: async (input: unknown) => {
        inserted = true;
        assert.deepEqual(input, {
          data: [{ userId, serviceId }],
          skipDuplicates: true,
        });
      },
    },
  } as never);
  service.findOne = async () => {
    if (!visible) throw new NotFoundException("Service not found");
    return { id: serviceId } as never;
  };
  await assert.rejects(service.save(userId, serviceId), NotFoundException);
  assert.equal(inserted, false);
  visible = true;
  assert.deepEqual(await service.save(userId, serviceId), { saved: true });
  assert.equal(inserted, true);
});

test("unsaving is idempotent and scoped to the authenticated user", async () => {
  const service = new ServicesService({
    savedService: {
      deleteMany: async (input: unknown) => {
        assert.deepEqual(input, { where: { userId, serviceId } });
      },
    },
  } as never);
  assert.deepEqual(await service.unsave(userId, serviceId), { saved: false });
});

test("saved IDs are read only for the authenticated user", async () => {
  const service = new ServicesService({
    savedService: {
      findMany: async (input: unknown) => {
        assert.deepEqual(input, {
          where: { userId },
          select: { serviceId: true },
        });
        return [{ serviceId }];
      },
    },
  } as never);
  assert.deepEqual(await service.savedIds(userId), { data: [serviceId] });
});
