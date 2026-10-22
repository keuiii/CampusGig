import { BadRequestException } from "@nestjs/common";

export type OrderCursor = { createdAt: Date; id: string };

export function encodeOrderCursor(cursor: OrderCursor) {
  return Buffer.from(
    JSON.stringify({
      createdAt: cursor.createdAt.toISOString(),
      id: cursor.id,
    }),
    "utf8",
  ).toString("base64url");
}

export function decodeOrderCursor(value: string): OrderCursor {
  try {
    const decoded = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as { createdAt?: unknown; id?: unknown };
    if (typeof decoded.createdAt !== "string" || typeof decoded.id !== "string")
      throw new Error("Invalid cursor shape");
    const createdAt = new Date(decoded.createdAt);
    if (Number.isNaN(createdAt.getTime()) || !decoded.id)
      throw new Error("Invalid cursor values");
    return { createdAt, id: decoded.id };
  } catch {
    throw new BadRequestException("Invalid order cursor");
  }
}
