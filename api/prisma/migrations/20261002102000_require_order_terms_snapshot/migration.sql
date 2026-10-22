BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Order" WHERE "termsSnapshot" IS NULL) THEN
    RAISE EXCEPTION 'Cannot require order terms snapshots before backfill verification';
  END IF;
END
$$;

ALTER TABLE "Order"
ALTER COLUMN "termsSnapshot" SET NOT NULL;

COMMIT;
