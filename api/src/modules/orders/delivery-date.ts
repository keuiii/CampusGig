import { BadRequestException } from "@nestjs/common";

const dayMilliseconds = 24 * 60 * 60 * 1000;
const manilaOffsetMilliseconds = 8 * 60 * 60 * 1000;
export const maximumAdvanceBookingDays = 365;

function manilaCalendarDayUtc(date: Date) {
  const manila = new Date(date.getTime() + manilaOffsetMilliseconds);
  return Date.UTC(
    manila.getUTCFullYear(),
    manila.getUTCMonth(),
    manila.getUTCDate(),
  );
}

function parseDateOnly(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match)
    throw new BadRequestException(
      "Requested delivery date must use YYYY-MM-DD format",
    );

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new BadRequestException("Requested delivery date is invalid");
  }
  return timestamp;
}

export function resolveRequestedDeliveryDate(
  requestedDate: string | undefined,
  deliveryDays: number,
  now = new Date(),
) {
  const today = manilaCalendarDayUtc(now);
  const earliest = today + deliveryDays * dayMilliseconds;
  const latest = today + maximumAdvanceBookingDays * dayMilliseconds;
  const requested = requestedDate ? parseDateOnly(requestedDate) : earliest;

  if (requested < earliest) {
    throw new BadRequestException(
      `Requested delivery date must allow at least ${deliveryDays} delivery day${deliveryDays === 1 ? "" : "s"}`,
    );
  }
  if (requested > latest) {
    throw new BadRequestException(
      `Requested delivery date cannot be more than ${maximumAdvanceBookingDays} days ahead`,
    );
  }

  // Persist the deadline at 23:59:59.999 in Asia/Manila so a date-only
  // selection remains valid for the entire requested calendar day.
  return new Date(requested + dayMilliseconds - 1 - manilaOffsetMilliseconds);
}
