import type { School } from "../types";

export function applySchoolStatusUpdate(
  current: readonly School[],
  updated: School,
) {
  const remaining = current.filter((school) => school.id !== updated.id);
  if (updated.status !== "ACTIVE") return remaining;
  return [...remaining, updated].sort((a, b) => a.name.localeCompare(b.name));
}

export function retainActiveSchoolSelection(
  selectedSchoolId: string,
  activeSchools: readonly School[],
) {
  return activeSchools.some((school) => school.id === selectedSchoolId)
    ? selectedSchoolId
    : "";
}
