import { BadRequestException } from "@nestjs/common";

export type ConversationCursor = {
  pinned: boolean;
  updatedAt: Date;
  id: string;
  snapshotAt: Date;
};

export function encodeConversationCursor(cursor: ConversationCursor) {
  return Buffer.from(
    JSON.stringify({
      pinned: cursor.pinned,
      updatedAt: cursor.updatedAt.toISOString(),
      id: cursor.id,
      snapshotAt: cursor.snapshotAt.toISOString(),
    }),
    "utf8",
  ).toString("base64url");
}

export function decodeConversationCursor(value: string): ConversationCursor {
  try {
    const decoded = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as {
      pinned?: unknown;
      updatedAt?: unknown;
      id?: unknown;
      snapshotAt?: unknown;
    };
    if (
      typeof decoded.pinned !== "boolean" ||
      typeof decoded.updatedAt !== "string" ||
      typeof decoded.id !== "string" ||
      typeof decoded.snapshotAt !== "string"
    )
      throw new Error("Invalid cursor shape");
    const updatedAt = new Date(decoded.updatedAt);
    const snapshotAt = new Date(decoded.snapshotAt);
    if (
      Number.isNaN(updatedAt.getTime()) ||
      Number.isNaN(snapshotAt.getTime()) ||
      !decoded.id
    )
      throw new Error("Invalid cursor values");
    return { pinned: decoded.pinned, updatedAt, id: decoded.id, snapshotAt };
  } catch {
    throw new BadRequestException("Invalid conversation cursor");
  }
}
