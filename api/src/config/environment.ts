type Environment = "development" | "test" | "production";

type EnvironmentValues = Record<string, unknown>;

const value = (config: EnvironmentValues, key: string) => {
  const candidate = config[key];
  return typeof candidate === "string" ? candidate.trim() : "";
};

export function validateEnvironment(
  config: EnvironmentValues,
): EnvironmentValues {
  const errors: string[] = [];
  const nodeEnvironment = (value(config, "NODE_ENV") ||
    "development") as Environment;

  if (!["development", "test", "production"].includes(nodeEnvironment))
    errors.push("NODE_ENV must be development, test, or production");

  requireValue(config, "DATABASE_URL", errors);
  validateUrl(config, "DATABASE_URL", errors, ["postgres:", "postgresql:"]);

  requireSecret(config, "JWT_SECRET", 32, errors);
  if (nodeEnvironment === "production")
    requireSecret(config, "MFA_ENCRYPTION_KEY", 32, errors);
  else if (value(config, "MFA_ENCRYPTION_KEY"))
    requireSecret(config, "MFA_ENCRYPTION_KEY", 32, errors);
  if (nodeEnvironment === "production")
    requireSecret(config, "PAYOUT_DESTINATION_ENCRYPTION_KEY", 32, errors);
  else if (value(config, "PAYOUT_DESTINATION_ENCRYPTION_KEY"))
    requireSecret(config, "PAYOUT_DESTINATION_ENCRYPTION_KEY", 32, errors);

  validateInteger(config, "PORT", 1, 65_535, errors);
  validateInteger(config, "ACCESS_TOKEN_TTL_SECONDS", 300, 3_600, errors);
  validateInteger(config, "REFRESH_TOKEN_IDLE_DAYS", 1, 30, errors);
  validateInteger(config, "REFRESH_TOKEN_ABSOLUTE_DAYS", 1, 90, errors);
  validateInteger(config, "REFRESH_TOKEN_REPLAY_GRACE_SECONDS", 5, 60, errors);
  const idleDays = optionalInteger(config, "REFRESH_TOKEN_IDLE_DAYS", 7);
  const absoluteDays = optionalInteger(
    config,
    "REFRESH_TOKEN_ABSOLUTE_DAYS",
    30,
  );
  if (
    idleDays !== undefined &&
    absoluteDays !== undefined &&
    absoluteDays < idleDays
  )
    errors.push(
      "REFRESH_TOKEN_ABSOLUTE_DAYS must be greater than or equal to REFRESH_TOKEN_IDLE_DAYS",
    );

  const origins = value(config, "WEB_ORIGIN");
  if (nodeEnvironment === "production" && !origins)
    errors.push("WEB_ORIGIN is required in production");
  for (const origin of origins
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean))
    validateAbsoluteUrl("WEB_ORIGIN", origin, errors, ["http:", "https:"]);
  validateUrl(config, "EMAIL_ACTION_BASE_URL", errors, ["http:", "https:"]);

  validateEmail(config, nodeEnvironment, errors);
  validateOauth(config, errors);
  validatePayments(config, nodeEnvironment, errors);
  validatePayouts(config, errors);
  validateStorage(config, nodeEnvironment, errors);
  validateMalwareScanner(config, nodeEnvironment, errors);
  validateMonitoring(config, nodeEnvironment, errors);

  validateInteger(config, "PLATFORM_FEE_BASIS_POINTS", 0, 3_000, errors);
  validateInteger(
    config,
    "PLATFORM_FEE_MIN_CENTAVOS",
    0,
    Number.MAX_SAFE_INTEGER,
    errors,
  );
  for (const key of [
    "RUSH_24_HOURS_BASIS_POINTS",
    "RUSH_12_HOURS_BASIS_POINTS",
    "RUSH_6_HOURS_BASIS_POINTS",
    "RUSH_3_HOURS_BASIS_POINTS",
  ])
    validateInteger(config, key, 0, 10_000, errors);

  validateBoolean(config, "ORDER_REVIEW_RECONCILER_ENABLED", errors);
  validateInteger(
    config,
    "ORDER_REVIEW_POLL_INTERVAL_MS",
    5_000,
    3_600_000,
    errors,
  );
  validateInteger(config, "ORDER_REVIEW_BATCH_SIZE", 1, 100, errors);

  if (errors.length)
    throw new Error(
      `Environment validation failed:\n${errors.map((error) => `- ${error}`).join("\n")}`,
    );

  return {
    ...config,
    NODE_ENV: nodeEnvironment,
    PAYMONGO_MODE: (value(config, "PAYMONGO_MODE") || "test").toLowerCase(),
    PAYOUT_PROVIDER: (
      value(config, "PAYOUT_PROVIDER") || "disabled"
    ).toLowerCase(),
  };
}

function validatePayouts(config: EnvironmentValues, errors: string[]) {
  const provider = (
    value(config, "PAYOUT_PROVIDER") || "disabled"
  ).toLowerCase();
  if (provider !== "disabled")
    errors.push(
      "PAYOUT_PROVIDER must remain disabled until a verified payout adapter is implemented",
    );
}

function validateEmail(
  config: EnvironmentValues,
  environment: Environment,
  errors: string[],
) {
  const smtpUser = value(config, "SMTP_USER");
  const smtpPassword = value(config, "SMTP_APP_PASSWORD").replace(/\s/g, "");
  const resendKey = value(config, "RESEND_API_KEY");
  const from = value(config, "EMAIL_FROM");

  if (Boolean(smtpUser) !== Boolean(smtpPassword))
    errors.push("SMTP_USER and SMTP_APP_PASSWORD must be configured together");
  if (smtpPassword && smtpPassword.length < 16)
    errors.push("SMTP_APP_PASSWORD must contain at least 16 characters");
  if (resendKey && !from)
    errors.push("EMAIL_FROM is required when RESEND_API_KEY is configured");
  if (
    environment === "production" &&
    !(smtpUser && smtpPassword) &&
    !(resendKey && from)
  )
    errors.push(
      "production requires either SMTP_USER with SMTP_APP_PASSWORD or RESEND_API_KEY with EMAIL_FROM",
    );
}

function validateOauth(config: EnvironmentValues, errors: string[]) {
  for (const key of [
    "GOOGLE_WEB_CLIENT_ID",
    "GOOGLE_ANDROID_CLIENT_ID",
    "GOOGLE_IOS_CLIENT_ID",
  ]) {
    const clientId = value(config, key);
    if (clientId && !clientId.endsWith(".apps.googleusercontent.com"))
      errors.push(`${key} must be a Google OAuth client ID`);
  }
}

function validatePayments(
  config: EnvironmentValues,
  environment: Environment,
  errors: string[],
) {
  const configuredMode = value(config, "PAYMONGO_MODE").toLowerCase();
  const mode = configuredMode || "test";
  const secret = value(config, "PAYMONGO_SECRET_KEY");
  const webhook = value(config, "PAYMONGO_WEBHOOK_SECRET");
  if (environment === "production" && !configuredMode)
    errors.push("PAYMONGO_MODE is required in production");
  if (!new Set(["test", "live"]).has(mode))
    errors.push("PAYMONGO_MODE must be test or live");
  if (mode === "live" && environment !== "production")
    errors.push("PAYMONGO_MODE=live requires NODE_ENV=production");
  if (environment === "production" && !secret)
    errors.push("PAYMONGO_SECRET_KEY is required in production");
  if (environment === "production" && !webhook)
    errors.push("PAYMONGO_WEBHOOK_SECRET is required in production");
  if (environment !== "production" && Boolean(secret) !== Boolean(webhook))
    errors.push(
      "PAYMONGO_SECRET_KEY and PAYMONGO_WEBHOOK_SECRET must be configured together",
    );
  const expectedSecretPrefix = mode === "live" ? "sk_live_" : "sk_test_";
  if (secret && !secret.startsWith(expectedSecretPrefix))
    errors.push(`PAYMONGO_SECRET_KEY must be a PayMongo ${mode}-mode key`);
  if (webhook && webhook.length < 12)
    errors.push("PAYMONGO_WEBHOOK_SECRET must contain at least 12 characters");

  const returnUrlKeys = [
    "PAYMONGO_SUCCESS_URL",
    "PAYMONGO_CANCEL_URL",
    "PAYMONGO_MOBILE_SUCCESS_URL",
    "PAYMONGO_MOBILE_CANCEL_URL",
  ];
  for (const key of returnUrlKeys) {
    validateTemplatedUrl(config, key, errors);
    const url = value(config, key);
    if (
      mode === "live" &&
      url &&
      urlProtocol(url.replaceAll("{orderId}", "validation-order")) !== "https:"
    )
      errors.push(`${key} must use HTTPS in PayMongo live mode`);
  }

  if (mode === "live") {
    for (const origin of value(config, "WEB_ORIGIN")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean))
      if (urlProtocol(origin) !== "https:")
        errors.push("WEB_ORIGIN must use HTTPS in PayMongo live mode");
  }

  const mobileOrigin = value(config, "PAYMONGO_MOBILE_RETURN_ORIGIN");
  if (environment === "production" && !mobileOrigin)
    errors.push("PAYMONGO_MOBILE_RETURN_ORIGIN is required in production");
  if (mobileOrigin) {
    validateAbsoluteUrl("PAYMONGO_MOBILE_RETURN_ORIGIN", mobileOrigin, errors, [
      "http:",
      "https:",
    ]);
    if (
      (environment === "production" || mode === "live") &&
      urlProtocol(mobileOrigin) !== "https:"
    )
      errors.push("PAYMONGO_MOBILE_RETURN_ORIGIN must use HTTPS in production");
  }
}

function validateStorage(
  config: EnvironmentValues,
  environment: Environment,
  errors: string[],
) {
  const driver = (value(config, "STORAGE_DRIVER") || "local").toLowerCase();
  if (!new Set(["local", "s3"]).has(driver))
    errors.push("STORAGE_DRIVER must be local or s3");
  if (environment === "production" && driver !== "s3")
    errors.push("production requires STORAGE_DRIVER=s3");

  validateInteger(config, "STORAGE_SIGNED_URL_TTL_SECONDS", 60, 900, errors);
  validateBoolean(config, "S3_FORCE_PATH_STYLE", errors);
  validateUrl(config, "S3_ENDPOINT", errors, ["http:", "https:"]);

  if (driver === "s3") {
    requireValue(config, "S3_BUCKET", errors);
    requireValue(config, "S3_REGION", errors);
  }
  if (
    Boolean(value(config, "S3_ACCESS_KEY_ID")) !==
    Boolean(value(config, "S3_SECRET_ACCESS_KEY"))
  )
    errors.push(
      "S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be configured together",
    );
}

function validateMalwareScanner(
  config: EnvironmentValues,
  environment: Environment,
  errors: string[],
) {
  const driver = (
    value(config, "MALWARE_SCANNER_DRIVER") || "disabled"
  ).toLowerCase();
  if (!new Set(["disabled", "clamav"]).has(driver))
    errors.push("MALWARE_SCANNER_DRIVER must be disabled or clamav");
  if (environment === "production" && driver !== "clamav")
    errors.push("production requires MALWARE_SCANNER_DRIVER=clamav");
  if (driver === "clamav" && !value(config, "CLAMAV_HOST"))
    errors.push("CLAMAV_HOST is required when MALWARE_SCANNER_DRIVER=clamav");
  validateInteger(config, "CLAMAV_PORT", 1, 65_535, errors);
  validateInteger(config, "CLAMAV_TIMEOUT_MS", 1_000, 120_000, errors);
}

function validateMonitoring(
  config: EnvironmentValues,
  environment: Environment,
  errors: string[],
) {
  const token = value(config, "METRICS_TOKEN");
  const tokenFile = value(config, "METRICS_TOKEN_FILE");
  if (token && tokenFile)
    errors.push("configure only one of METRICS_TOKEN or METRICS_TOKEN_FILE");
  if (token && token.length < 32)
    errors.push("METRICS_TOKEN must contain at least 32 characters");
  if (environment === "production" && !token && !tokenFile)
    errors.push("production requires METRICS_TOKEN or METRICS_TOKEN_FILE");
  validateInteger(config, "READINESS_TIMEOUT_MS", 500, 15_000, errors);
}

function requireValue(
  config: EnvironmentValues,
  key: string,
  errors: string[],
) {
  if (!value(config, key)) errors.push(`${key} is required`);
}

function requireSecret(
  config: EnvironmentValues,
  key: string,
  minimumLength: number,
  errors: string[],
) {
  const secret = value(config, key);
  if (!secret) errors.push(`${key} is required`);
  else if (secret.length < minimumLength)
    errors.push(`${key} must contain at least ${minimumLength} characters`);
}

function validateInteger(
  config: EnvironmentValues,
  key: string,
  minimum: number,
  maximum: number,
  errors: string[],
) {
  const raw = value(config, key);
  if (!raw) return;
  if (!/^-?\d+$/.test(raw)) {
    errors.push(`${key} must be an integer`);
    return;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum)
    errors.push(`${key} must be between ${minimum} and ${maximum}`);
}

function optionalInteger(
  config: EnvironmentValues,
  key: string,
  fallback: number,
) {
  const raw = value(config, key);
  if (!raw) return fallback;
  if (!/^-?\d+$/.test(raw)) return undefined;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function validateBoolean(
  config: EnvironmentValues,
  key: string,
  errors: string[],
) {
  const raw = value(config, key);
  if (raw && raw !== "true" && raw !== "false")
    errors.push(`${key} must be true or false`);
}

function validateUrl(
  config: EnvironmentValues,
  key: string,
  errors: string[],
  protocols: string[],
) {
  const raw = value(config, key);
  if (raw) validateAbsoluteUrl(key, raw, errors, protocols);
}

function validateTemplatedUrl(
  config: EnvironmentValues,
  key: string,
  errors: string[],
) {
  const raw = value(config, key);
  if (raw)
    validateAbsoluteUrl(
      key,
      raw.replaceAll("{orderId}", "validation-order"),
      errors,
      ["http:", "https:"],
    );
}

function validateAbsoluteUrl(
  key: string,
  raw: string,
  errors: string[],
  protocols: string[],
) {
  try {
    const parsed = new URL(raw);
    if (!protocols.includes(parsed.protocol) || !parsed.hostname)
      errors.push(`${key} must be an absolute ${protocols.join(" or ")} URL`);
  } catch {
    errors.push(`${key} must be a valid absolute URL`);
  }
}

function urlProtocol(raw: string) {
  try {
    return new URL(raw).protocol;
  } catch {
    return "";
  }
}
