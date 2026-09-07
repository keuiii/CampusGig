const ANDROID_CONFIGURATION_MESSAGE =
  "This Android build is not registered correctly in Google Cloud. " +
  "Use package com.campusgig.app and the SHA-1 fingerprint documented in README.md, then rebuild the app.";

type GoogleSignInErrorLike = {
  code?: string | number;
  message?: string;
};

export function getGoogleSignInErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "Please try again.";

  const candidate = error as GoogleSignInErrorLike;
  const code = String(candidate.code ?? "").toUpperCase();
  const message = candidate.message ?? "";

  if (
    code === "10" ||
    code === "DEVELOPER_ERROR" ||
    message.toUpperCase().includes("DEVELOPER_ERROR")
  ) {
    return ANDROID_CONFIGURATION_MESSAGE;
  }

  return message || "Please try again.";
}
