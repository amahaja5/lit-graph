const BREAKPOINT_MOBILE = 640;
const BREAKPOINT_TABLET = 980;

const GRAPH_SIZE_PRESETS = {
  mobile: {
    minHeight: 360,
    viewportHeightRatio: 0.58,
    viewportHeightCap: 560,
    growthStartNodes: 14,
    nodesPerStep: 8,
    growthPerStep: 90,
    maxHeight: 1120,
  },
  tablet: {
    minHeight: 460,
    viewportHeightRatio: 0.62,
    viewportHeightCap: 720,
    growthStartNodes: 18,
    nodesPerStep: 10,
    growthPerStep: 110,
    maxHeight: 1360,
  },
  desktop: {
    minHeight: 560,
    viewportHeightRatio: 0.7,
    viewportHeightCap: 860,
    growthStartNodes: 24,
    nodesPerStep: 10,
    growthPerStep: 125,
    maxHeight: 1720,
  },
};

export function computeGraphPanelHeight(nodeCount, {
  viewportWidth = 1280,
  viewportHeight = 800,
} = {}) {
  const normalizedNodeCount = Math.max(0, Math.floor(Number(nodeCount) || 0));
  const preset = selectPreset(viewportWidth);

  const baseHeight = clamp(
    viewportHeight * preset.viewportHeightRatio,
    preset.minHeight,
    preset.viewportHeightCap,
  );

  if (normalizedNodeCount <= preset.growthStartNodes) {
    return Math.round(baseHeight);
  }

  const overflowNodes = normalizedNodeCount - preset.growthStartNodes;
  const growthSteps = Math.ceil(overflowNodes / preset.nodesPerStep);
  const expandedHeight = baseHeight + growthSteps * preset.growthPerStep;
  return Math.round(Math.min(preset.maxHeight, expandedHeight));
}

function selectPreset(viewportWidth) {
  const width = Number(viewportWidth) || 1280;
  if (width <= BREAKPOINT_MOBILE) return GRAPH_SIZE_PRESETS.mobile;
  if (width <= BREAKPOINT_TABLET) return GRAPH_SIZE_PRESETS.tablet;
  return GRAPH_SIZE_PRESETS.desktop;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
