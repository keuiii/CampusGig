import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ServicesService } from "../src/modules/services/services.service";

test("service pages filter and sort in SQL before applying a bounded offset", async () => {
  const queries: { strings: string[]; values: unknown[] }[] = [];
  const service = new ServicesService({
    $queryRaw: async (query: { strings: string[]; values: unknown[] }) => {
      queries.push(query);
      return queries.length === 1 ? [{ total: 43n }] : [];
    },
    service: { findMany: async () => [] },
  } as never);

  const result = await service.findAll({
    query: "tutor",
    schoolId: "00000000-0000-0000-0000-000000000001",
    category: "Tutoring",
    budgetRange: "500-999",
    minimumRating: 4.5,
    maximumDeliveryDays: 3,
    sort: "price-low",
    page: 2,
  });

  assert.deepEqual(result, {
    data: [],
    page: 2,
    pageSize: 20,
    total: 43,
    hasMore: false,
  });
  assert.equal(queries.length, 2);
  const sql = queries[1].strings.join(" ");
  assert.match(sql, /minimumPrice.*ASC NULLS LAST.*LIMIT.*OFFSET/s);
  assert.match(sql, /minimumDeliveryMinutes.*<=/s);
  for (const value of ["tutor", "Tutoring", 50000, 100000, 4.5, 4320, 20, 20])
    assert.ok(
      queries[1].values.includes(value),
      `missing bound value ${value}`,
    );
});

test("marketplace search ranks normalized full-text and typo-tolerant matches", async () => {
  const queries: { strings: string[]; values: unknown[] }[] = [];
  const service = new ServicesService({
    $queryRaw: async (query: { strings: string[]; values: unknown[] }) => {
      queries.push(query);
      return queries.length === 1 ? [{ total: 0n }] : [];
    },
  } as never);

  await service.findAll({ query: "  LOGGO   Design  ", sort: "recommended" });

  assert.equal(queries.length, 2);
  const countSql = queries[0].strings.join(" ");
  const pageSql = queries[1].strings.join(" ");
  assert.match(countSql, /websearch_to_tsquery/);
  assert.match(countSql, /word_similarity/);
  assert.match(countSql, /unnest\(pp\."skills"\)/);
  assert.match(pageSql, /ORDER BY.*ts_rank_cd.*DESC.*ratingAverage.*DESC/s);
  assert.ok(
    queries.every((query) => query.values.includes("loggo design")),
    "every search query must use the whitespace-normalized lowercase term",
  );

  const migration = readFileSync(
    new URL(
      "../prisma/migrations/20260928010000_add_marketplace_search_indexes/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(migration, /CREATE EXTENSION IF NOT EXISTS pg_trgm/);
  assert.match(migration, /Service_full_text_search_idx/);
  assert.match(migration, /gin_trgm_ops/g);
});

test("unfiltered marketplace pages avoid search ranking work", async () => {
  const queries: { strings: string[]; values: unknown[] }[] = [];
  const service = new ServicesService({
    $queryRaw: async (query: { strings: string[]; values: unknown[] }) => {
      queries.push(query);
      return queries.length === 1 ? [{ total: 0n }] : [];
    },
  } as never);

  await service.findAll({ page: 1 });

  assert.equal(queries.length, 2);
  const sql = queries.map((query) => query.strings.join(" ")).join(" ");
  assert.doesNotMatch(sql, /websearch_to_tsquery|word_similarity|ts_rank_cd/);
});
