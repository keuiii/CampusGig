import { BadRequestException } from "@nestjs/common";

export type DateCursor = { date: Date; id: string };

export function encodeDateCursor(cursor: DateCursor) {
  return Buffer.from(
    JSON.stringify({ date: cursor.date.toISOString(), id: cursor.id }),
    "utf8",
  ).toString("base64url");
}

export function decodeDateCursor(value: string, label: string): DateCursor {
  try {
    const decoded = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as { date?: unknown; id?: unknown };
    if (typeof decoded.date !== "string" || typeof decoded.id !== "string")
      throw new Error("Invalid cursor shape");
    const date = new Date(decoded.date);
    if (Number.isNaN(date.getTime()) || !decoded.id)
      throw new Error("Invalid cursor values");
    return { date, id: decoded.id };
  } catch {
    throw new BadRequestException(`Invalid ${label} cursor`);
  }
}
