const MIN_SIDE_PAD_PX = 120;
const MAX_SIDE_PAD_PX = 220;
const SIDE_PAD_RATIO = 0.16;
const MIN_TICK_LABEL_GAP_PX = 78;
const MIN_UNKNOWN_GAP_PX = 44;
const MAX_UNKNOWN_GAP_PX = 108;

export function buildYearLayout(years, width, { minTickGapPx = MIN_TICK_LABEL_GAP_PX } = {}) {
  const knownYears = [...new Set((Array.isArray(years) ? years : []).filter(hasValidYear))]
    .sort((a, b) => a - b);

  if (!knownYears.length) return null;

  const sidePad = Math.max(MIN_SIDE_PAD_PX, Math.min(MAX_SIDE_PAD_PX, width * SIDE_PAD_RATIO));
  const leftPad = sidePad;
  const rightPad = sidePad;
  const usableWidth = Math.max(1, width - leftPad - rightPad);
  const positions = new Map();

  if (knownYears.length === 1) {
    positions.set(knownYears[0], width / 2);
  } else {
    const step = usableWidth / (knownYears.length - 1);
    knownYears.forEach((year, index) => {
      positions.set(year, leftPad + index * step);
    });
  }

  const firstYearX = positions.get(knownYears[0]) ?? width / 2;
  const gap = knownYears.length > 1
    ? Math.abs((positions.get(knownYears[1]) ?? firstYearX) - firstYearX)
    : Math.max(80, Math.min(140, usableWidth * 0.25));
  const unknownX = Math.max(
    54,
    firstYearX - Math.max(MIN_UNKNOWN_GAP_PX, Math.min(MAX_UNKNOWN_GAP_PX, gap * 0.9)),
  );
  const maxTickCount = Math.max(2, Math.floor(usableWidth / minTickGapPx) + 1);

  return {
    minYear: knownYears[0],
    maxYear: knownYears[knownYears.length - 1],
    knownYears,
    positions,
    tickYears: selectVisibleTickYears(knownYears, maxTickCount),
    unknownX,
    gap,
  };
}

export function yearToX(year, layout, width) {
  if (!layout) return width / 2;
  if (!hasValidYear(year)) return layout.unknownX ?? width / 2;

  const direct = layout.positions?.get?.(year);
  if (typeof direct === "number") return direct;

  const years = Array.isArray(layout.knownYears) ? layout.knownYears : [];
  if (!years.length) return width / 2;
  if (year <= years[0]) return layout.positions.get(years[0]) ?? width / 2;
  if (year >= years[years.length - 1]) return layout.positions.get(years[years.length - 1]) ?? width / 2;

  for (let index = 1; index < years.length; index += 1) {
    const upperYear = years[index];
    if (year > upperYear) continue;

    const lowerYear = years[index - 1];
    const lowerX = layout.positions.get(lowerYear) ?? width / 2;
    const upperX = layout.positions.get(upperYear) ?? width / 2;
    const ratio = upperYear === lowerYear ? 0 : (year - lowerYear) / (upperYear - lowerYear);
    return lowerX + ratio * (upperX - lowerX);
  }

  return width / 2;
}

export function hasValidYear(value) {
  return Number.isInteger(value) && value > 0;
}

export function buildYearHistogram(nodes, layout, width) {
  if (!layout) return [];

  const counts = new Map(layout.knownYears.map((year) => [year, 0]));
  let unknownCount = 0;

  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (hasValidYear(node?.year)) {
      counts.set(node.year, (counts.get(node.year) || 0) + 1);
    } else {
      unknownCount += 1;
    }
  }

  const bars = layout.knownYears.map((year) => ({
    key: `year:${year}`,
    label: String(year),
    x: yearToX(year, layout, width),
    count: counts.get(year) || 0,
    isUnknown: false,
  }));

  if (unknownCount > 0) {
    bars.unshift({
      key: "year:unknown",
      label: "Unknown",
      x: layout.unknownX ?? width / 2,
      count: unknownCount,
      isUnknown: true,
    });
  }

  return bars.filter((bar) => bar.count > 0);
}

function selectVisibleTickYears(knownYears, maxTickCount) {
  if (knownYears.length <= maxTickCount) return knownYears;

  const indexSet = new Set();
  for (let slot = 0; slot < maxTickCount; slot += 1) {
    const ratio = maxTickCount === 1 ? 0 : slot / (maxTickCount - 1);
    indexSet.add(Math.round(ratio * (knownYears.length - 1)));
  }

  return [...indexSet]
    .sort((a, b) => a - b)
    .map((index) => knownYears[index]);
}
