import { createApiClient } from "./apiClient.js";
import { GraphStore } from "./graphStore.js";
import { normalizeCitationBatch, normalizeReferenceBatch, toPaperNode } from "./normalize.js";
import { selectTopCandidates } from "./rank.js";
import { createGraphRenderer } from "./graphRenderer.js";
import { createSearchBar } from "./ui/searchBar.js";
import { createSidecar } from "./ui/sidecar.js";
import { createReviewCart } from "./ui/reviewCart.js";

const TOP_N_PER_SIDE = 15;
const EXPANSION_LIMIT = 100;

const elements = {
  searchForm: document.querySelector("#search-form"),
  searchInput: document.querySelector("#paper-id-input"),
  searchSubmit: document.querySelector("#search-submit"),
  globalStatus: document.querySelector("#global-status"),
  globalError: document.querySelector("#global-error"),
  globalNotices: document.querySelector("#global-notices"),
  graphSvg: document.querySelector("#graph-svg"),
  graphEmpty: document.querySelector("#graph-empty"),
  graphSummary: document.querySelector("#graph-summary"),
  resetViewBtn: document.querySelector("#reset-view-btn"),
  layoutModeBtn: document.querySelector("#layout-mode-btn"),
  layoutHint: document.querySelector("#layout-hint"),
  sidecarEmpty: document.querySelector("#sidecar-empty"),
  sidecarContent: document.querySelector("#sidecar-content"),
  sidecarTitle: document.querySelector("#sidecar-title"),
  sidecarMeta: document.querySelector("#sidecar-meta"),
  sidecarAuthors: document.querySelector("#sidecar-authors"),
  sidecarAbstract: document.querySelector("#sidecar-abstract"),
  sidecarExpandBtn: document.querySelector("#sidecar-expand-btn"),
  sidecarReviewBtn: document.querySelector("#sidecar-review-btn"),
  sidecarSourceLink: document.querySelector("#sidecar-source-link"),
  sidecarState: document.querySelector("#sidecar-state"),
  reviewCount: document.querySelector("#review-count"),
  reviewList: document.querySelector("#review-list"),
  exportJsonBtn: document.querySelector("#export-json-btn"),
};

const store = new GraphStore();
const api = createApiClient();
const renderer = createGraphRenderer({
  svgEl: elements.graphSvg,
  onNodeClick: handleNodeClick,
  onNodeHover: (node) => renderer.setHoveredNode(node?.paperId ?? null),
});

const searchBar = createSearchBar({
  formEl: elements.searchForm,
  inputEl: elements.searchInput,
  submitBtnEl: elements.searchSubmit,
  statusEl: elements.globalStatus,
  errorEl: elements.globalError,
  onSubmit: loadSeedPaper,
});

const sidecar = createSidecar({
  emptyEl: elements.sidecarEmpty,
  contentEl: elements.sidecarContent,
  titleEl: elements.sidecarTitle,
  metaEl: elements.sidecarMeta,
  authorsEl: elements.sidecarAuthors,
  abstractEl: elements.sidecarAbstract,
  expandBtnEl: elements.sidecarExpandBtn,
  reviewBtnEl: elements.sidecarReviewBtn,
  sourceLinkEl: elements.sidecarSourceLink,
  stateEl: elements.sidecarState,
  onExpand: expandNode,
  onToggleReview: toggleReviewSelection,
});

const reviewCart = createReviewCart({
  countEl: elements.reviewCount,
  listEl: elements.reviewList,
  exportBtnEl: elements.exportJsonBtn,
  onExport: exportReviewCartJson,
  onSelectNode: selectNode,
});

let activeSeedRequestId = 0;
const pendingNodeDetailFetches = new Set();
const completedNodeDetailFetches = new Set();

elements.resetViewBtn.addEventListener("click", () => renderer.resetView());
elements.layoutModeBtn.addEventListener("click", toggleLayoutMode);
window.addEventListener("resize", () => renderApp());

renderApp();
searchBar.focus();

async function loadSeedPaper(rawPaperId) {
  const paperId = String(rawPaperId || "").trim();
  if (!paperId) return;

  const requestId = ++activeSeedRequestId;
  searchBar.setLoading(true);
  setStatus(`Loading seed paper: ${paperId}`);
  clearError();

  try {
    const paper = await api.fetchPaper(paperId);
    if (requestId !== activeSeedRequestId) return;

    const rootNode = toPaperNode(paper, { isRoot: true, state: "unexplored" });
    if (!rootNode) {
      throw new Error("Semantic Scholar API returned an invalid paper payload.");
    }

    store.setRoot(rootNode);
    pendingNodeDetailFetches.clear();
    completedNodeDetailFetches.clear();
    setStatus("Loaded seed paper. Click a node to view details, then use Expand Node.");
    renderApp();
  } catch (error) {
    if (requestId !== activeSeedRequestId) return;
    setError(formatErrorMessage(error));
    setStatus("");
  } finally {
    if (requestId === activeSeedRequestId) {
      searchBar.setLoading(false);
      renderApp();
    }
  }
}

async function handleNodeClick(node) {
  if (!node?.paperId) return;
  selectNode(node.paperId);
  setStatus("Node selected. Review the abstract, then click Expand Node to expand.");
  await hydrateNodeDetailsIfNeeded(node.paperId);
}

function selectNode(nodeId) {
  store.setSelectedNode(nodeId);
  clearError();
  renderApp();
}

async function hydrateNodeDetailsIfNeeded(nodeId) {
  const node = store.getNode(nodeId);
  if (!node) return;

  // Skip if we already have an abstract or previously completed a details fetch
  // for this node in the current session.
  if (node.abstract || completedNodeDetailFetches.has(nodeId) || pendingNodeDetailFetches.has(nodeId)) {
    return;
  }

  pendingNodeDetailFetches.add(nodeId);
  setStatus(`Loading paper details for ${node.title}...`);
  renderApp();

  try {
    const paper = await api.fetchPaper(nodeId);
    const latest = store.getNode(nodeId);
    if (!latest) return;

    const hydratedNode = toPaperNode(paper, {
      state: latest.state,
      isRoot: latest.isRoot,
      errorMessage: latest.errorMessage,
    });
    if (!hydratedNode) {
      throw new Error("Semantic Scholar API returned an invalid paper payload.");
    }

    store.upsertNode({
      ...hydratedNode,
      state: latest.state,
      isRoot: latest.isRoot,
      errorMessage: latest.errorMessage,
    });
    completedNodeDetailFetches.add(nodeId);

    const updatedNode = store.getNode(nodeId);
    if (updatedNode?.isSelected) {
      if (updatedNode.abstract) {
        setStatus("Node details loaded. Click Expand Node when you want to expand.");
      } else {
        setStatus("Node selected. Abstract unavailable for this paper in Semantic Scholar.");
      }
    }
  } catch (error) {
    const currentNode = store.getNode(nodeId);
    if (currentNode?.isSelected) {
      setError(`Could not load paper details: ${formatErrorMessage(error)}`);
    }
  } finally {
    pendingNodeDetailFetches.delete(nodeId);
    renderApp();
  }
}

async function expandNode(nodeId) {
  const node = store.getNode(nodeId);
  if (!node) return;
  if (!store.canExpand(nodeId)) {
    setStatus(node.state === "expanded" ? "Node already expanded in MVP (no refetch)." : "Node expansion already in progress.");
    renderApp();
    return;
  }

  store.setNodeState(nodeId, "loading");
  store.setSelectedNode(nodeId);
  clearError();
  setStatus(`Expanding ${node.title}...`);
  renderApp();

  try {
    const { citations, references } = await api.fetchExpansion(nodeId, {
      limit: EXPANSION_LIMIT,
      offset: 0,
    });

    const citationBatch = normalizeCitationBatch(nodeId, citations);
    const referenceBatch = normalizeReferenceBatch(nodeId, references);

    const topCitations = selectTopCandidates(citationBatch.candidates, TOP_N_PER_SIDE);
    const topReferences = selectTopCandidates(referenceBatch.candidates, TOP_N_PER_SIDE);
    const mergedCandidates = [...topCitations, ...topReferences];

    store.mergeExpansion(nodeId, mergedCandidates);
    store.setExpansionNotice(nodeId, {
      citationsTruncated: citationBatch.truncated,
      referencesTruncated: referenceBatch.truncated,
    });

    if (mergedCandidates.length === 0) {
      setStatus("Expansion completed, but no eligible citation/reference nodes were returned for rendering.");
    } else {
      setStatus(
        `Expansion complete: added up to ${topCitations.length} citation nodes and ${topReferences.length} reference nodes.`,
      );
    }
  } catch (error) {
    store.setNodeState(nodeId, "error", { errorMessage: formatErrorMessage(error) });
    setError(formatErrorMessage(error));
    setStatus("");
  }

  renderApp();
}

function toggleReviewSelection(nodeId) {
  const selected = store.toggleReviewCart(nodeId);
  const node = store.getNode(nodeId);
  if (node) {
    setStatus(selected ? `Added to review cart: ${node.title}` : `Removed from review cart: ${node.title}`);
  }
  clearError();
  renderApp();
}

function exportReviewCartJson() {
  const reviewNodes = store.getReviewCartNodes();
  if (!reviewNodes.length) {
    setError("Add at least one paper to the review cart before exporting.");
    return;
  }

  const payload = store.toReviewExport();
  const seedFragment = safeFileFragment(store.seedPaperId || "litgraph");
  const fileName = `litgraph-review-${seedFragment}.json`;
  downloadJson(payload, fileName);
  setStatus(`Exported ${reviewNodes.length} paper(s) to ${fileName}`);
  clearError();
}

function renderApp() {
  const snapshot = store.snapshot();
  const selectedNode = snapshot.selectedNodeId ? store.getNode(snapshot.selectedNodeId) : null;

  renderer.render(snapshot);
  updateLayoutControls(snapshot.nodes);

  elements.graphEmpty.hidden = snapshot.nodes.length > 0;
  elements.graphSummary.textContent = snapshot.nodes.length
    ? `${snapshot.nodes.length} node${snapshot.nodes.length === 1 ? "" : "s"} • ${snapshot.links.length} link${snapshot.links.length === 1 ? "" : "s"}`
    : "No graph loaded";

  sidecar.render(selectedNode, {
    canExpand: selectedNode ? store.canExpand(selectedNode.paperId) : false,
  });

  reviewCart.render(store.getReviewCartNodes());
  renderNotices(snapshot.notices);
}

function toggleLayoutMode() {
  const nextMode = renderer.getLayoutMode() === "year" ? "force" : "year";
  const changed = renderer.setLayoutMode(nextMode);
  if (!changed) return;

  setStatus(
    nextMode === "year"
      ? "Year layout enabled (older papers left, newer papers right)."
      : "Free layout enabled.",
  );
  renderApp();
}

function updateLayoutControls(nodes) {
  const mode = renderer.getLayoutMode();
  const metadata = renderer.getLayoutMetadata();
  const yearRange = metadata?.yearRange;

  elements.layoutModeBtn.setAttribute("aria-pressed", String(mode === "year"));
  elements.layoutModeBtn.textContent = mode === "year" ? "Year Layout: On" : "Year Layout: Off";

  if (mode === "year") {
    if (yearRange?.minYear != null && yearRange?.maxYear != null) {
      const suffix = yearRange.minYear === yearRange.maxYear
        ? ` (${yearRange.minYear})`
        : ` (${yearRange.minYear} → ${yearRange.maxYear})`;
      elements.layoutHint.textContent = `Older ← Year → Newer${suffix}`;
    } else if ((nodes || []).length > 0) {
      elements.layoutHint.textContent = "Older ← Year → Newer (waiting for year data)";
    } else {
      elements.layoutHint.textContent = "Older ← Year → Newer";
    }
  } else {
    elements.layoutHint.textContent = "Free force layout";
  }
}

function renderNotices(notices) {
  elements.globalNotices.replaceChildren();
  for (const notice of notices) {
    const div = document.createElement("div");
    div.className = "notice";
    div.textContent = notice.message;
    elements.globalNotices.append(div);
  }
}

function setStatus(message) {
  searchBar.setStatus(message || "");
}

function setError(message) {
  searchBar.setError(message || "");
}

function clearError() {
  searchBar.clearError();
}

function formatErrorMessage(error) {
  if (!error) return "Unknown error";
  const base = error.message || String(error);
  if (error.retryAfterSeconds != null) {
    return `${base} (retry in ~${error.retryAfterSeconds}s)`;
  }
  return base;
}

function downloadJson(data, fileName) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function safeFileFragment(value) {
  return String(value || "litgraph")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "litgraph";
}
