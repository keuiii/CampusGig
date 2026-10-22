import { BadRequestException } from "@nestjs/common";

export type ProviderEarningCursor = { pendingAt: Date; id: string };

export function encodeProviderEarningCursor(cursor: ProviderEarningCursor) {
  return Buffer.from(
    JSON.stringify({
      pendingAt: cursor.pendingAt.toISOString(),
      id: cursor.id,
    }),
    "utf8",
  ).toString("base64url");
}

export function decodeProviderEarningCursor(
  value: string,
): ProviderEarningCursor {
  try {
    const decoded = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as { pendingAt?: unknown; id?: unknown };
    if (typeof decoded.pendingAt !== "string" || typeof decoded.id !== "string")
      throw new Error("Invalid cursor shape");
    const pendingAt = new Date(decoded.pendingAt);
    if (Number.isNaN(pendingAt.getTime()) || !decoded.id)
      throw new Error("Invalid cursor values");
    return { pendingAt, id: decoded.id };
  } catch {
    throw new BadRequestException("Invalid provider earnings cursor");
  }
}
