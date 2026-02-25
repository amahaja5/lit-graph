import { formatAuthorNames } from "../normalize.js";

export function createSidecar({
  emptyEl,
  contentEl,
  titleEl,
  metaEl,
  authorsEl,
  abstractEl,
  expandBtnEl,
  reviewBtnEl,
  sourceLinkEl,
  stateEl,
  onExpand,
  onToggleReview,
} = {}) {
  let currentNodeId = null;

  expandBtnEl?.addEventListener("click", () => {
    if (currentNodeId) onExpand?.(currentNodeId);
  });

  reviewBtnEl?.addEventListener("click", () => {
    if (currentNodeId) onToggleReview?.(currentNodeId);
  });

  function clear() {
    currentNodeId = null;
    if (emptyEl) emptyEl.hidden = false;
    if (contentEl) contentEl.hidden = true;
  }

  function render(node, { canExpand = false } = {}) {
    if (!node) {
      clear();
      return;
    }

    currentNodeId = node.paperId;
    if (emptyEl) emptyEl.hidden = true;
    if (contentEl) contentEl.hidden = false;

    titleEl.textContent = node.title || "Untitled paper";
    metaEl.replaceChildren(...buildMetaChips(node));
    authorsEl.textContent = formatAuthorNames(node.authors, { max: 10 });
    abstractEl.textContent = node.abstract || "Abstract unavailable.";

    const hasUrl = Boolean(node.url);
    sourceLinkEl.hidden = !hasUrl;
    if (hasUrl) {
      sourceLinkEl.href = node.url;
    } else {
      sourceLinkEl.removeAttribute("href");
    }

    const stateLabel = formatState(node);
    stateEl.textContent = stateLabel;

    expandBtnEl.disabled = !canExpand;
    expandBtnEl.textContent = node.state === "loading" ? "Expanding..." : node.state === "expanded" ? "Expanded" : "Expand Node";

    reviewBtnEl.disabled = false;
    reviewBtnEl.textContent = node.isInReviewCart ? "Remove from Review" : "Add to Review";
  }

  return { clear, render };
}

function buildMetaChips(node) {
  const chips = [
    ["Year", node.year ?? "Unknown"],
    ["Venue", node.venue || "Unknown"],
    ["Citations", numberOrDash(node.citationCount)],
    ["Influential", numberOrDash(node.influentialCitationCount)],
    ["References", numberOrDash(node.referenceCount)],
    ["Node State", node.state],
  ];

  return chips.map(([label, value]) => {
    const div = document.createElement("div");
    div.className = "meta-chip";

    const strong = document.createElement("strong");
    strong.textContent = label;

    const span = document.createElement("span");
    span.textContent = String(value);

    div.append(strong, span);
    return div;
  });
}

function formatState(node) {
  if (node.state === "error") {
    return node.errorMessage ? `Expansion failed: ${node.errorMessage}` : "Expansion failed.";
  }
  if (node.state === "expanded") {
    return "Node expanded (MVP does not refetch expanded nodes).";
  }
  if (node.state === "loading") {
    return "Loading citations and references...";
  }
  if (node.state === "unexplored") {
    return "Unexplored node. Click Expand Node to fetch first-page citations and references.";
  }
  return "";
}

function numberOrDash(value) {
  return Number.isFinite(value) ? String(value) : "-";
}
