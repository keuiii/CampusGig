import { Prisma } from "@prisma/client";

export async function lockOrderReview(
  database: Prisma.TransactionClient,
  orderId: string,
) {
  await database.$queryRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${orderId}::text, 1)) IS NULL AS "locked"`,
  );
}
