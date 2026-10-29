export const DEFAULT_EXPANSION_PAPERS_PER_SIDE = 15;
export const MAX_EXPANSION_PAPERS_PER_SIDE = 100;

export function normalizeExpansionCount(value, {
  fallback = DEFAULT_EXPANSION_PAPERS_PER_SIDE,
  max = MAX_EXPANSION_PAPERS_PER_SIDE,
} = {}) {
  if (value == null) return fallback;
  if (typeof value === "string" && !value.trim()) return fallback;
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(num)));
}
