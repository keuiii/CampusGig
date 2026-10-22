const campusDateFormatter = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function formatCampusDate(value: string | Date) {
  return campusDateFormatter.format(
    typeof value === "string" ? new Date(value) : value,
  );
}
