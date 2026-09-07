import assert from "node:assert/strict";
import test from "node:test";
import {
  applySchoolStatusUpdate,
  retainActiveSchoolSelection,
} from "../../app/lib/school-state";
import { CategoriesService } from "../src/modules/categories/categories.service";
import { SchoolsService } from "../src/modules/schools/schools.service";
import { ServicesService } from "../src/modules/services/services.service";

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
  let query: any;
  const service = new ServicesService({
    service: {
      findMany: async (input: unknown) => {
        query = input;
        return [];
      },
    },
  } as never);

  await service.findAll(undefined, undefined, "school-a");

  assert.deepEqual(query.where.provider, {
    studentProfile: {
      schoolId: "school-a",
      school: { status: "ACTIVE" },
    },
  });
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
});
