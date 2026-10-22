export const serviceFieldLimits = {
  title: { min: 10, max: 120 },
  description: { min: 50, max: 3000 },
} as const;

export function getCharacterProgress(
  value: string,
  limits: { min: number; max: number },
) {
  const count = value.length;
  const meaningfulCount = value.trim().length;
  const remaining = Math.max(0, limits.min - meaningfulCount);

  return {
    count,
    remaining,
    ready: remaining === 0 && count <= limits.max,
  };
}
