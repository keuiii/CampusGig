import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateEnvironment } from "../src/config/environment";

const development = () => ({
  NODE_ENV: "development",
  DATABASE_URL: "postgresql://campusgig:campusgig@localhost:5432/campusgig",
  JWT_SECRET: "j".repeat(32),
});

const production = () => ({
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://campusgig:password@postgres:5432/campusgig",
  JWT_SECRET: "j".repeat(64),
  MFA_ENCRYPTION_KEY: "m".repeat(64),
  PAYOUT_DESTINATION_ENCRYPTION_KEY: "p".repeat(64),
  WEB_ORIGIN: "https://campusgig.example",
  RESEND_API_KEY: "re_test_key",
  EMAIL_FROM: "CampusGig <accounts@campusgig.example>",
  PAYMONGO_MODE: "test",
  PAYMONGO_SECRET_KEY: "sk_test_production_validation",
  PAYMONGO_WEBHOOK_SECRET: "whsk_production_validation",
  PAYMONGO_MOBILE_RETURN_ORIGIN: "https://campusgig.example",
  STORAGE_DRIVER: "s3",
  S3_BUCKET: "campusgig-private",
  S3_REGION: "ap-southeast-1",
  MALWARE_SCANNER_DRIVER: "clamav",
  CLAMAV_HOST: "clamav",
  METRICS_TOKEN: "t".repeat(32),
});

function errorFor(config: Record<string, unknown>) {
  try {
    validateEnvironment(config);
    assert.fail("Expected environment validation to fail");
  } catch (error) {
    return String(error);
  }
}

test("valid development and production configurations pass", () => {
  assert.equal(validateEnvironment(development()).NODE_ENV, "development");
  assert.equal(validateEnvironment(production()).NODE_ENV, "production");
});

test("production requires a separate payout destination encryption key", () => {
  assert.match(
    errorFor({ ...production(), PAYOUT_DESTINATION_ENCRYPTION_KEY: "" }),
    /PAYOUT_DESTINATION_ENCRYPTION_KEY/,
  );
});

test("automated payout providers fail closed until an adapter is verified", () => {
  assert.equal(
    validateEnvironment({ ...development(), PAYOUT_PROVIDER: "disabled" })
      .PAYOUT_PROVIDER,
    "disabled",
  );
  assert.match(
    errorFor({ ...development(), PAYOUT_PROVIDER: "paymongo" }),
    /PAYOUT_PROVIDER must remain disabled/,
  );
});

test("database, authentication, URL, number, and enum failures are explicit", () => {
  assert.match(
    errorFor({ ...development(), DATABASE_URL: "" }),
    /DATABASE_URL is required/,
  );
  assert.match(
    errorFor({ ...development(), JWT_SECRET: "weak" }),
    /JWT_SECRET/,
  );
  assert.match(
    errorFor({ ...development(), WEB_ORIGIN: "not-a-url" }),
    /WEB_ORIGIN/,
  );
  assert.match(
    errorFor({ ...development(), PORT: "4.5" }),
    /PORT must be an integer/,
  );
  assert.match(
    errorFor({ ...development(), ORDER_REVIEW_RECONCILER_ENABLED: "yes" }),
    /ORDER_REVIEW_RECONCILER_ENABLED must be true or false/,
  );
  assert.match(
    errorFor({ ...development(), ORDER_REVIEW_POLL_INTERVAL_MS: "1000" }),
    /ORDER_REVIEW_POLL_INTERVAL_MS must be between 5000 and 3600000/,
  );
  assert.match(
    errorFor({ ...development(), ORDER_REVIEW_BATCH_SIZE: "101" }),
    /ORDER_REVIEW_BATCH_SIZE must be between 1 and 100/,
  );
  assert.match(
    errorFor({ ...development(), STORAGE_DRIVER: "filesystem" }),
    /STORAGE_DRIVER must be local or s3/,
  );
});

test("local storage remains usable without S3 while selected S3 is complete", () => {
  assert.doesNotThrow(() =>
    validateEnvironment({ ...development(), STORAGE_DRIVER: "local" }),
  );
  const message = errorFor({ ...development(), STORAGE_DRIVER: "s3" });
  assert.match(message, /S3_BUCKET/);
  assert.match(message, /S3_REGION/);
});

test("payment and OAuth dependency rules reject partial or malformed setup", () => {
  assert.match(
    errorFor({ ...development(), PAYMONGO_SECRET_KEY: "sk_test_only" }),
    /PAYMONGO_SECRET_KEY and PAYMONGO_WEBHOOK_SECRET/,
  );
  assert.match(
    errorFor({ ...development(), GOOGLE_WEB_CLIENT_ID: "wrong-client-id" }),
    /GOOGLE_WEB_CLIENT_ID/,
  );
});

test("production fails fast when the required payment integration is absent", () => {
  const config: Record<string, unknown> = production();
  delete config.PAYMONGO_SECRET_KEY;
  delete config.PAYMONGO_WEBHOOK_SECRET;
  const message = errorFor(config);
  assert.match(message, /PAYMONGO_SECRET_KEY is required in production/);
  assert.match(message, /PAYMONGO_WEBHOOK_SECRET is required in production/);
});

test("production requires the public mobile payment-return origin", () => {
  const config = production();
  delete config.PAYMONGO_MOBILE_RETURN_ORIGIN;
  assert.match(
    errorFor(config),
    /PAYMONGO_MOBILE_RETURN_ORIGIN is required in production/,
  );
});

test("PayMongo live mode is explicit, production-only, and key-prefix safe", () => {
  const live = {
    ...production(),
    PAYMONGO_MODE: "live",
    PAYMONGO_SECRET_KEY: "sk_live_production_validation",
    PAYMONGO_SUCCESS_URL:
      "https://campusgig.example/?payment=success&orderId={orderId}",
    PAYMONGO_CANCEL_URL:
      "https://campusgig.example/?payment=cancelled&orderId={orderId}",
    PAYMONGO_MOBILE_RETURN_ORIGIN: "https://campusgig.example",
  };
  assert.equal(validateEnvironment(live).PAYMONGO_MODE, "live");
  assert.match(
    errorFor({ ...live, NODE_ENV: "development" }),
    /PAYMONGO_MODE=live requires NODE_ENV=production/,
  );
  assert.match(
    errorFor({ ...live, PAYMONGO_SECRET_KEY: "sk_test_wrong_mode" }),
    /PayMongo live-mode key/,
  );
  assert.match(
    errorFor({ ...live, PAYMONGO_SUCCESS_URL: "http://campusgig.example" }),
    /PAYMONGO_SUCCESS_URL must use HTTPS/,
  );
});

test("production requires an explicit PayMongo mode", () => {
  const config = production();
  delete config.PAYMONGO_MODE;
  assert.match(errorFor(config), /PAYMONGO_MODE is required in production/);
});

test("validation errors never echo supplied secrets", () => {
  const suppliedSecret = "do-not-print-this-secret";
  const message = errorFor({
    ...development(),
    JWT_SECRET: suppliedSecret,
    PAYMONGO_SECRET_KEY: suppliedSecret,
  });
  assert.equal(message.includes(suppliedSecret), false);
});

test("ConfigModule runs validation during application configuration", async () => {
  const source = await readFile(
    new URL("../src/app.module.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /ConfigModule\.forRoot\(\{ isGlobal: true, validate: validateEnvironment \}\)/,
  );
});
