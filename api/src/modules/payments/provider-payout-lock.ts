import { Prisma } from "@prisma/client";

export async function lockProviderPayout(
  database: Pick<Prisma.TransactionClient, "$queryRaw">,
  providerId: string,
) {
  await database.$queryRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${providerId}::text, 2)) IS NULL AS "locked"`,
  );
}
