import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

const STATE_COLORS = {
  unexplored: "#8b8b8b",
  loading: "#dd6b20",
  expanded: "#2563eb",
  error: "#c53030",
};

const LAYOUT_MODE_FORCE = "force";
const LAYOUT_MODE_YEAR = "year";
const LINK_DISTANCE = 68;
const LINK_STRENGTH = 0.26;
const DEFAULT_CHARGE = -120;
const ROOT_CHARGE = -180;
const COLLIDE_PADDING = 2;
const CENTERING_X_STRENGTH = 0.18;
const CENTERING_Y_STRENGTH = 0.14;

export function createGraphRenderer({ svgEl, onNodeClick, onNodeHover, initialLayoutMode = LAYOUT_MODE_YEAR } = {}) {
  if (!svgEl) throw new Error("svgEl is required");

  const svg = d3.select(svgEl);
  let width = Math.max(640, svgEl.clientWidth || 640);
  let height = Math.max(360, svgEl.clientHeight || 360);
  let layoutMode = normalizeLayoutMode(initialLayoutMode);
  let currentYearRange = null;

  svg.attr("viewBox", `0 0 ${width} ${height}`);

  const defs = svg.append("defs");
  defs
    .append("marker")
    .attr("id", "arrowhead")
    .attr("viewBox", "0 -5 10 10")
    .attr("refX", 16)
    .attr("refY", 0)
    .attr("markerWidth", 6)
    .attr("markerHeight", 6)
    .attr("orient", "auto")
    .append("path")
    .attr("d", "M0,-5L10,0L0,5")
    .attr("fill", "#b9b1a2");

  const zoomLayer = svg.append("g").attr("class", "zoom-layer");
  const guideLayer = zoomLayer.append("g").attr("class", "year-guides");
  const linkLayer = zoomLayer.append("g").attr("class", "links");
  const nodeLayer = zoomLayer.append("g").attr("class", "nodes");

  const zoom = d3
    .zoom()
    .scaleExtent([0.2, 4])
    .on("zoom", (event) => {
      zoomLayer.attr("transform", event.transform);
    });

  svg.call(zoom);

  const simulation = d3
    .forceSimulation([])
    .force("link", d3.forceLink([]).id((d) => d.id).distance(LINK_DISTANCE).strength(LINK_STRENGTH))
    .force("charge", d3.forceManyBody().strength((d) => (d?.isRoot ? ROOT_CHARGE : DEFAULT_CHARGE)))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collide", d3.forceCollide((d) => radiusForNode(d) + COLLIDE_PADDING))
    .force("xpos", d3.forceX(width / 2).strength(CENTERING_X_STRENGTH))
    .force("ypos", d3.forceY(height / 2).strength(CENTERING_Y_STRENGTH));

  let simNodesById = new Map();
  let hoverNodeId = null;
  let selectedNodeId = null;
  let currentNodeSelection = nodeLayer.selectAll("g.node");
  let currentLinkSelection = linkLayer.selectAll("line.link-line");

  simulation.on("tick", () => {
    currentLinkSelection
      .attr("x1", (d) => d.source?.x ?? 0)
      .attr("y1", (d) => d.source?.y ?? 0)
      .attr("x2", (d) => d.target?.x ?? 0)
      .attr("y2", (d) => d.target?.y ?? 0);

    currentNodeSelection.attr("transform", (d) => `translate(${d.x ?? width / 2},${d.y ?? height / 2})`);
  });

  function render({ nodes = [], links = [], selectedNodeId: nextSelectedNodeId = null } = {}) {
    resizeIfNeeded();
    selectedNodeId = nextSelectedNodeId;

    const simNodes = materializeSimNodes(nodes);
    const simLinks = links.map((link) => ({ ...link }));

    simulation.nodes(simNodes);
    simulation.force("link").links(simLinks);
    simulation.force("collide").radius((d) => radiusForNode(d) + COLLIDE_PADDING);
    applyLayoutForces(simNodes);

    currentLinkSelection = linkLayer
      .selectAll("line.link-line")
      .data(simLinks, (d) => d.id)
      .join(
        (enter) => enter.append("line").attr("class", "link-line"),
        (update) => update,
        (exit) => exit.remove(),
      )
      .classed("is-highlighted", (d) => isLinkHighlighted(d))
      .classed("is-faded", (d) => isLinkFaded(d));

    currentNodeSelection = nodeLayer
      .selectAll("g.node")
      .data(simNodes, (d) => d.id)
      .join(
        (enter) => {
          const g = enter.append("g").attr("class", "node");
          g.append("circle").attr("class", "node-circle");
          g.append("text").attr("class", "node-label").attr("dx", 10).attr("dy", 4);
          return g;
        },
        (update) => update,
        (exit) => exit.remove(),
      );

    currentNodeSelection
      .on("click", (_event, d) => onNodeClick?.(toPublicNode(d)))
      .on("mouseenter", (_event, d) => {
        setHoveredNode(d.id);
        onNodeHover?.(toPublicNode(d));
      })
      .on("mouseleave", () => {
        setHoveredNode(null);
        onNodeHover?.(null);
      })
      .call(
        d3
          .drag()
          .on("start", dragStarted)
          .on("drag", dragged)
          .on("end", dragEnded),
      );

    currentNodeSelection
      .select("circle.node-circle")
      .attr("r", (d) => radiusForNode(d))
      .attr("fill", (d) => colorForNode(d))
      .classed("is-selected", (d) => d.id === selectedNodeId)
      .classed("is-faded", (d) => isNodeFaded(d.id));

    currentNodeSelection
      .select("text.node-label")
      .text((d) => shortTitle(d.title))
      .classed("is-faded", (d) => isNodeFaded(d.id));

    simulation.alpha(0.95).restart();
    updateClasses();
  }

  function materializeSimNodes(nodes) {
    const nextMap = new Map();
    const materialized = nodes.map((node) => {
      const existing = simNodesById.get(node.id);
      if (existing) {
        Object.assign(existing, node);
        nextMap.set(node.id, existing);
        return existing;
      }

      const fresh = {
        ...node,
        x: width / 2 + (Math.random() - 0.5) * 24,
        y: height / 2 + (Math.random() - 0.5) * 24,
      };
      nextMap.set(node.id, fresh);
      return fresh;
    });
    simNodesById = nextMap;
    return materialized;
  }

  function setHoveredNode(nodeId) {
    hoverNodeId = nodeId;
    updateClasses();
  }

  function updateClasses() {
    currentLinkSelection
      .classed("is-highlighted", (d) => isLinkHighlighted(d))
      .classed("is-faded", (d) => isLinkFaded(d));

    currentNodeSelection
      .select("circle.node-circle")
      .classed("is-selected", (d) => d.id === selectedNodeId)
      .classed("is-faded", (d) => isNodeFaded(d.id));

    currentNodeSelection.select("text.node-label").classed("is-faded", (d) => isNodeFaded(d.id));
  }

  function isNodeFaded(nodeId) {
    if (!hoverNodeId) return false;
    if (nodeId === hoverNodeId) return false;
    return !isNeighbor(nodeId, hoverNodeId);
  }

  function isLinkHighlighted(link) {
    if (!hoverNodeId) return false;
    return getNodeId(link.source) === hoverNodeId || getNodeId(link.target) === hoverNodeId;
  }

  function isLinkFaded(link) {
    if (!hoverNodeId) return false;
    return !isLinkHighlighted(link);
  }

  function isNeighbor(candidateId, focusId) {
    for (const link of currentLinkSelection.data()) {
      const sourceId = getNodeId(link.source);
      const targetId = getNodeId(link.target);
      if ((sourceId === focusId && targetId === candidateId) || (targetId === focusId && sourceId === candidateId)) {
        return true;
      }
    }
    return false;
  }

  function applyLayoutForces(nodes) {
    const xForce = simulation.force("xpos");
    const yForce = simulation.force("ypos");
    const validYears = nodes.map((node) => node.year).filter((year) => Number.isInteger(year));

    if (layoutMode === LAYOUT_MODE_YEAR && validYears.length > 0) {
      const minYear = Math.min(...validYears);
      const maxYear = Math.max(...validYears);
      currentYearRange = { minYear, maxYear };

      xForce
        .x((node) => (hasValidYear(node?.year) ? yearToX(node?.year, currentYearRange, width) : unknownYearX(node, width)))
        .strength(validYears.length === 1 ? CENTERING_X_STRENGTH : 0.6);
      yForce.y((node) => laneY(node, height)).strength(CENTERING_Y_STRENGTH);
      drawYearGuides(currentYearRange);
    } else {
      currentYearRange = validYears.length > 0
        ? { minYear: Math.min(...validYears), maxYear: Math.max(...validYears) }
        : null;

      xForce.x(width / 2).strength(CENTERING_X_STRENGTH);
      yForce.y(height / 2).strength(CENTERING_Y_STRENGTH);
      clearYearGuides();
    }
  }

  function drawYearGuides(range) {
    const ticks = buildYearTicks(range.minYear, range.maxYear, 7);
    const topY = 18;
    const bottomY = height - 22;
    const unknownX = Math.max(46, Math.round(width * 0.08));

    guideLayer
      .selectAll("line.year-guide")
      .data(ticks, (d) => String(d))
      .join(
        (enter) => enter.append("line").attr("class", "year-guide"),
        (update) => update,
        (exit) => exit.remove(),
      )
      .attr("x1", (year) => yearToX(year, range, width))
      .attr("x2", (year) => yearToX(year, range, width))
      .attr("y1", topY)
      .attr("y2", bottomY);

    guideLayer
      .selectAll("text.year-guide-label")
      .data(ticks, (d) => String(d))
      .join(
        (enter) => enter.append("text").attr("class", "year-guide-label"),
        (update) => update,
        (exit) => exit.remove(),
      )
      .attr("x", (year) => yearToX(year, range, width))
      .attr("y", 14)
      .text((year) => String(year));

    guideLayer
      .selectAll("line.year-guide-unknown")
      .data([unknownX])
      .join(
        (enter) => enter.append("line").attr("class", "year-guide year-guide-unknown"),
        (update) => update,
        (exit) => exit.remove(),
      )
      .attr("x1", (x) => x)
      .attr("x2", (x) => x)
      .attr("y1", topY)
      .attr("y2", bottomY);

    guideLayer
      .selectAll("text.year-guide-unknown-label")
      .data([unknownX])
      .join(
        (enter) => enter.append("text").attr("class", "year-guide-label year-guide-unknown-label"),
        (update) => update,
        (exit) => exit.remove(),
      )
      .attr("x", (x) => x)
      .attr("y", 14)
      .text("Unknown");
  }

  function clearYearGuides() {
    guideLayer.selectAll("line.year-guide").remove();
    guideLayer.selectAll("text.year-guide-label").remove();
  }

  function resizeIfNeeded() {
    const nextWidth = Math.max(640, svgEl.clientWidth || 640);
    const nextHeight = Math.max(360, svgEl.clientHeight || 360);
    if (nextWidth === width && nextHeight === height) return;
    width = nextWidth;
    height = nextHeight;
    svg.attr("viewBox", `0 0 ${width} ${height}`);
    simulation.force("center", d3.forceCenter(width / 2, height / 2));
    applyLayoutForces(simulation.nodes() || []);
    simulation.alpha(0.4).restart();
  }

  function resetView() {
    svg.transition().duration(220).call(zoom.transform, d3.zoomIdentity);
  }

  function setLayoutMode(nextMode) {
    const normalized = normalizeLayoutMode(nextMode);
    if (normalized === layoutMode) return false;
    layoutMode = normalized;
    applyLayoutForces(simulation.nodes() || []);
    simulation.alpha(0.85).restart();
    return true;
  }

  function getLayoutMode() {
    return layoutMode;
  }

  function getLayoutMetadata() {
    return {
      mode: layoutMode,
      yearRange: currentYearRange ? { ...currentYearRange } : null,
    };
  }

  function destroy() {
    simulation.stop();
  }

  function dragStarted(event) {
    if (!event.active) simulation.alphaTarget(0.25).restart();
    event.subject.fx = event.subject.x;
    event.subject.fy = event.subject.y;
  }

  function dragged(event) {
    event.subject.fx = event.x;
    event.subject.fy = event.y;
  }

  function dragEnded(event) {
    if (!event.active) simulation.alphaTarget(0);
    event.subject.fx = null;
    event.subject.fy = null;
  }

  return {
    render,
    resetView,
    destroy,
    setHoveredNode,
    setLayoutMode,
    getLayoutMode,
    getLayoutMetadata,
  };
}

function radiusForNode(node) {
  const citations = Number(node?.citationCount) || 0;
  const raw = 5 + Math.log10(citations + 1) * 5.2;
  return Math.max(5, Math.min(22, raw));
}

function colorForNode(node) {
  if (node?.isRoot) return "#c99500";
  return STATE_COLORS[node?.state] || "#8b8b8b";
}

function shortTitle(title, max = 28) {
  if (!title) return "Untitled";
  return title.length > max ? `${title.slice(0, max - 1)}…` : title;
}

function getNodeId(nodeRef) {
  if (!nodeRef) return null;
  if (typeof nodeRef === "string") return nodeRef;
  return nodeRef.id ?? nodeRef.paperId ?? null;
}

function toPublicNode(node) {
  return { ...node };
}

function normalizeLayoutMode(mode) {
  return mode === LAYOUT_MODE_FORCE ? LAYOUT_MODE_FORCE : LAYOUT_MODE_YEAR;
}

function yearToX(year, range, width) {
  const sidePad = Math.max(120, Math.min(220, width * 0.16));
  const leftPad = sidePad;
  const rightPad = sidePad;
  const usableWidth = Math.max(1, width - leftPad - rightPad);
  if (!range || !Number.isInteger(range.minYear) || !Number.isInteger(range.maxYear)) {
    return width / 2;
  }

  if (!Number.isInteger(year)) return width / 2;
  if (range.minYear === range.maxYear) return width / 2;

  const clampedYear = Math.max(range.minYear, Math.min(range.maxYear, year));
  const ratio = (clampedYear - range.minYear) / (range.maxYear - range.minYear);
  return leftPad + ratio * usableWidth;
}

function laneY(node, height) {
  if (!hasValidYear(node?.year)) {
    return unknownYearY(node, height);
  }

  const centerY = height / 2;
  if (node?.isRoot) return centerY;

  const laneCount = 5;
  const laneIndex = Math.abs(hashString(node?.id || "")) % laneCount;
  const laneOffset = laneIndex - (laneCount - 1) / 2;
  const spacing = Math.max(20, Math.min(36, height * 0.06));
  return centerY + laneOffset * spacing;
}

function unknownYearX(node, width) {
  const centerX = width / 2;
  const spread = Math.max(48, Math.min(132, width * 0.09));
  const laneCount = 5;
  const laneIndex = Math.abs(hashString(node?.id || "")) % laneCount;
  const laneOffset = laneIndex - (laneCount - 1) / 2;
  return centerX + laneOffset * (spread / 2.2);
}

function unknownYearY(node, height) {
  const topBandCenter = Math.max(70, Math.min(110, height * 0.18));
  const laneCount = 5;
  const laneIndex = Math.abs(hashString(`unknown:${node?.id || ""}`)) % laneCount;
  const laneOffset = laneIndex - (laneCount - 1) / 2;
  const spacing = 18;
  return topBandCenter + laneOffset * spacing;
}

function buildYearTicks(minYear, maxYear, maxTicks = 7) {
  if (!Number.isInteger(minYear) || !Number.isInteger(maxYear)) return [];
  if (minYear === maxYear) return [minYear];

  const rawTicks = d3.ticks(minYear, maxYear, maxTicks)
    .map((tick) => Math.round(tick))
    .filter((tick) => Number.isInteger(tick) && tick >= minYear && tick <= maxYear);

  const set = new Set([minYear, ...rawTicks, maxYear]);
  return [...set].sort((a, b) => a - b);
}

function hasValidYear(value) {
  return Number.isInteger(value) && value > 0;
}

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
