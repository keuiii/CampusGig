import assert from "node:assert/strict";
import test from "node:test";
import {
  applySchoolStatusUpdate,
  retainActiveSchoolSelection,
} from "../../app/lib/school-state";
import { CategoriesService } from "../src/modules/categories/categories.service";
import { SchoolsService } from "../src/modules/schools/schools.service";
import { ServicesService } from "../src/modules/services/services.service";
import { ProviderService } from "../src/modules/provider/provider.service";

const activeSchool = {
  id: "school-a",
  name: "Alpha University",
  shortName: "AU",
  city: "Manila",
  status: "ACTIVE" as const,
};

test("disabling a school removes it and clears its preferred-school selection", () => {
  const disabled = { ...activeSchool, status: "DISABLED" as const };
  const schools = applySchoolStatusUpdate([activeSchool], disabled);

  assert.deepEqual(schools, []);
  assert.equal(retainActiveSchoolSelection(activeSchool.id, schools), "");
});

test("activating a school inserts it into the public list in name order", () => {
  const beta = {
    ...activeSchool,
    id: "school-b",
    name: "Beta College",
    shortName: "BC",
  };
  const schools = applySchoolStatusUpdate([beta], activeSchool);

  assert.deepEqual(
    schools.map((school) => school.id),
    ["school-a", "school-b"],
  );
});

test("the public school query returns active schools only", async () => {
  let query: unknown;
  const service = new SchoolsService({
    school: {
      findMany: async (input: unknown) => {
        query = input;
        return [];
      },
    },
  } as never);

  await service.findAll();

  assert.deepEqual(query, {
    where: { status: "ACTIVE" },
    select: { id: true, name: true, shortName: true, city: true },
    orderBy: { name: "asc" },
  });
});

test("public services require an active provider school", async () => {
  const queries: any[] = [];
  const service = new ServicesService({
    $queryRaw: async (query: unknown) => {
      queries.push(query);
      return queries.length === 1 ? [{ total: 0n }] : [];
    },
    service: {
      findMany: async () => [],
    },
  } as never);

  await service.findAll({ schoolId: "school-a" });

  assert.equal(queries.length, 2);
  assert.ok(queries.every((query) => query.values.includes("school-a")));
  assert.match(
    queries[0].strings.join(" "),
    /pp\."isAvailable" = TRUE.*school\."status" = 'ACTIVE'/s,
  );
});

test("public marketplace services expose their authoritative publication date", async () => {
  const publishedAt = new Date("2026-09-25T02:00:00.000Z");
  const service = new ServicesService({
    $queryRaw: async (query: { strings: string[] }) =>
      query.strings.join(" ").includes("COUNT(*)")
        ? [{ total: 1n }]
        : [{ id: "service-1" }],
    service: {
      findMany: async () => [
        {
          id: "service-1",
          title: "Campus app",
          description: "A student-built application",
          publishedAt,
          category: { name: "Programming" },
          provider: {
            id: "provider-1",
            displayName: "Campus Provider",
            avatarPath: null,
            updatedAt: publishedAt,
            studentProfile: {
              schoolId: "school-a",
              program: "BSIT",
              ratingAverage: 4.8,
              reviewCount: 5,
              school: activeSchool,
            },
          },
          packages: [
            {
              id: "package-1",
              tier: "BASIC",
              name: "Basic",
              description: "Basic package",
              priceCentavos: 50000,
              deliveryDays: 3,
              revisionLimit: 1,
            },
          ],
          media: [],
        },
      ],
    },
    order: { groupBy: async () => [] },
  } as never);

  const result = await service.findAll();

  assert.equal(result.data[0]?.publishedAt, publishedAt);
  assert.equal(result.total, 1);
  assert.equal(result.hasMore, false);
});

test("category service counts include active-school services only", async () => {
  let query: any;
  const service = new CategoriesService({
    category: {
      findMany: async (input: unknown) => {
        query = input;
        return [];
      },
    },
  } as never);

  await service.findAll();

  assert.deepEqual(
    query.include._count.select.services.where.provider.studentProfile.school,
    { status: "ACTIVE" },
  );
  assert.deepEqual(
    query.include._count.select.services.where.provider.providerProfile,
    { isAvailable: true },
  );
});

test("provider availability is persisted independently from profile edits", async () => {
  let updateInput: any;
  const service = new ProviderService(
    {
      studentProfile: {
        findUnique: async () => ({ verificationStatus: "APPROVED" }),
      },
      providerProfile: {
        findUnique: async () => ({ id: "profile-1" }),
        update: async (input: unknown) => {
          updateInput = input;
          return { userId: "provider-1", isAvailable: false };
        },
      },
    } as never,
    {} as never,
    {
      publishAccountChanged: () => undefined,
    } as never,
  );

  const result = await service.updateAvailability("provider-1", false);

  assert.deepEqual(updateInput, {
    where: { userId: "provider-1" },
    data: { isAvailable: false },
  });
  assert.equal(result.data.isAvailable, false);
  assert.match(result.message, /offline/);
});
