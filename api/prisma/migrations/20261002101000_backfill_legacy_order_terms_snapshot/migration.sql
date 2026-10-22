BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Order"
    WHERE jsonb_typeof("packageSnapshot") IS DISTINCT FROM 'object'
       OR jsonb_typeof("packageSnapshot" -> 'tier') IS DISTINCT FROM 'string'
       OR jsonb_typeof("packageSnapshot" -> 'name') IS DISTINCT FROM 'string'
       OR jsonb_typeof("packageSnapshot" -> 'description') IS DISTINCT FROM 'string'
       OR jsonb_typeof("packageSnapshot" -> 'priceCentavos') IS DISTINCT FROM 'number'
       OR jsonb_typeof("packageSnapshot" -> 'deliveryDays') IS DISTINCT FROM 'number'
       OR jsonb_typeof("packageSnapshot" -> 'revisionLimit') IS DISTINCT FROM 'number'
  ) THEN
    RAISE EXCEPTION 'Legacy package snapshot is incomplete; historical terms were not guessed';
  END IF;
END
$$;

UPDATE "Order"
SET "termsSnapshot" = jsonb_build_object(
  'version', 1,
  'pricingModel', 'LEGACY_PACKAGE_V1',
  'service', jsonb_build_object(
    'title', "titleSnapshot"
  ),
  'package', "packageSnapshot" || jsonb_build_object(
    'id', "servicePackageId"::text
  ),
  'pricing', jsonb_build_object(
    'currency', "currency",
    'subtotalCentavos', "subtotalCentavos",
    'platformFeeCentavos', "platformFeeCentavos",
    'totalCentavos', "totalCentavos"
  ),
  'fulfillment', jsonb_build_object(
    'deliveryDays', "packageSnapshot" -> 'deliveryDays',
    'revisionLimit', "revisionLimit",
    'dueAt', to_jsonb("dueAt"),
    'deadlineBasis', 'STORED_DUE_AT'
  )
)
WHERE "termsSnapshot" IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Order"
    WHERE "termsSnapshot" IS NULL
       OR "termsSnapshot" -> 'version' IS DISTINCT FROM '1'::jsonb
       OR "termsSnapshot" -> 'pricingModel' IS DISTINCT FROM '"LEGACY_PACKAGE_V1"'::jsonb
  ) THEN
    RAISE EXCEPTION 'Legacy order terms snapshot backfill is incomplete';
  END IF;
END
$$;

COMMIT;
