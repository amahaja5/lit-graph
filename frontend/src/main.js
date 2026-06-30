import { createApiClient } from "./apiClient.js";
import {
  buildBibtexDocument,
  extractOrBuildBibtexEntry,
  getBibtexSortLabel,
  normalizeBibtexSort,
  sortReviewNodesForBibtex,
} from "./bibtex.js";
import { buildIdentifiersText, extractPaperIdentifiers } from "./identifiers.js";
import {
  DEFAULT_EXPANSION_PAPERS_PER_SIDE,
  normalizeExpansionCount,
} from "./expansionSettings.js";
import { GraphStore } from "./graphStore.js";
import { normalizeCitationBatch, normalizeReferenceBatch, toPaperNode } from "./normalize.js";
import {
  createInitialReviewDraftState,
  getReviewGenerationGate,
  markReviewDraftStale,
} from "./reviewDraftState.js";
import {
  EXPANSION_MODE_RELEVANCE,
  getExpansionModeLabel,
  selectCandidatesForMode,
} from "./rank.js";
import { createGraphRenderer } from "./graphRenderer.js";
import { createReviewDraft } from "./ui/reviewDraft.js";
import { createSearchBar } from "./ui/searchBar.js";
import { createSidecar } from "./ui/sidecar.js";
import { createReviewCart } from "./ui/reviewCart.js";

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
  yearBarsBtn: document.querySelector("#year-bars-btn"),
  expansionModeSelect: document.querySelector("#expansion-mode-select"),
  expansionCountInput: document.querySelector("#expansion-count-input"),
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
  exportSortSelect: document.querySelector("#export-bibtex-sort"),
  exportBibtexBtn: document.querySelector("#export-bibtex-btn"),
  exportIdentifiersBtn: document.querySelector("#export-identifiers-btn"),
  reviewDraftBadge: document.querySelector("#review-draft-badge"),
  reviewDraftStatus: document.querySelector("#review-draft-status"),
  reviewDraftWarnings: document.querySelector("#review-draft-warnings"),
  reviewDraftEmpty: document.querySelector("#review-draft-empty"),
  reviewDraftContent: document.querySelector("#review-draft-content"),
  generateReviewBtn: document.querySelector("#generate-review-btn"),
};

const store = new GraphStore();
const api = createApiClient();
const renderer = createGraphRenderer({
  svgEl: elements.graphSvg,
  onNodeClick: handleNodeClick,
  onNodeHover: (node) => renderer.setHoveredNode(node?.paperId ?? null),
  initialYearBarsEnabled: true,
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
  exportBibtexBtnEl: elements.exportBibtexBtn,
  exportIdentifiersBtnEl: elements.exportIdentifiersBtn,
  exportSortEl: elements.exportSortSelect,
  onExportBibtex: exportReviewCartBibtex,
  onExportIdentifiers: exportReviewIdentifiersText,
  onSelectNode: selectNode,
});

const reviewDraft = createReviewDraft({
  buttonEl: elements.generateReviewBtn,
  badgeEl: elements.reviewDraftBadge,
  emptyEl: elements.reviewDraftEmpty,
  contentEl: elements.reviewDraftContent,
  statusEl: elements.reviewDraftStatus,
  warningsEl: elements.reviewDraftWarnings,
  onGenerate: generateReviewDraft,
  onSelectReference: handleReviewReferenceSelect,
});

let activeSeedRequestId = 0;
const pendingNodeDetailFetches = new Set();
const completedNodeDetailFetches = new Set();
let reviewDraftState = createInitialReviewDraftState();

elements.resetViewBtn.addEventListener("click", () => renderer.resetView());
elements.layoutModeBtn.addEventListener("click", toggleLayoutMode);
elements.yearBarsBtn.addEventListener("click", toggleYearBars);
elements.expansionModeSelect.addEventListener("change", handleExpansionModeChange);
elements.expansionCountInput.addEventListener("change", handleExpansionCountChange);
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
    reviewDraftState = createInitialReviewDraftState();
    renderApp();
    setStatus("Loaded seed paper. Building the first-hop citation neighborhood...");
    await expandNode(rootNode.paperId, {
      isBootstrap: true,
      requestId,
      topNPerSide: getSelectedExpansionCount(),
    });
    if (requestId !== activeSeedRequestId) return;
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

async function expandNode(nodeId, { isBootstrap = false, requestId = null, topNPerSide = null } = {}) {
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
  setStatus(
    isBootstrap && node.isRoot
      ? `Bootstrapping ${node.title} with a denser first-hop neighborhood...`
      : `Expanding ${node.title}...`,
  );
  renderApp();

  try {
    const expansionMode = getSelectedExpansionMode();
    const { citations, references } = await api.fetchExpansion(nodeId, {
      limit: EXPANSION_LIMIT,
      offset: 0,
    });
    if (requestId != null && requestId !== activeSeedRequestId) {
      return;
    }

    const citationBatch = normalizeCitationBatch(nodeId, citations);
    const referenceBatch = normalizeReferenceBatch(nodeId, references);
    const selectionLimit = normalizeExpansionCount(topNPerSide ?? getSelectedExpansionCount(), {
      fallback: DEFAULT_EXPANSION_PAPERS_PER_SIDE,
      max: EXPANSION_LIMIT,
    });

    const topCitations = selectCandidatesForMode(citationBatch.candidates, selectionLimit, {
      mode: expansionMode,
    });
    const topReferences = selectCandidatesForMode(referenceBatch.candidates, selectionLimit, {
      mode: expansionMode,
    });
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
        `${isBootstrap ? "Bootstrap " : ""}${getExpansionModeLabel(expansionMode)} expansion complete: added up to ${topCitations.length} citation nodes and ${topReferences.length} reference nodes.`,
      );
    }
  } catch (error) {
    if (requestId != null && requestId !== activeSeedRequestId) {
      return;
    }
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
  reviewDraftState = markReviewDraftStale(reviewDraftState);
  clearError();
  renderApp();
}

async function generateReviewDraft() {
  const reviewNodes = store.getReviewCartNodes();
  const gate = getReviewGenerationGate(reviewNodes.length);
  if (!gate.canGenerate) {
    setError(gate.reason);
    renderApp();
    return;
  }

  reviewDraftState = {
    ...reviewDraftState,
    status: "loading",
    stale: false,
    errorMessage: "",
  };
  clearError();
  setStatus("Generating structured literature synthesis...");
  renderApp();

  try {
    const payload = await api.generateReview(reviewNodes.map((node) => node.paperId), {
      mode: "html",
      outputShape: "structured_synthesis",
    });
    reviewDraftState = {
      status: "ready",
      stale: false,
      errorMessage: "",
      payload,
    };
    setStatus(`Review generated from ${payload.references.length} paper(s).`);
  } catch (error) {
    reviewDraftState = {
      ...reviewDraftState,
      status: "error",
      errorMessage: `Could not generate review: ${formatErrorMessage(error)}`,
    };
    setError(formatErrorMessage(error));
    setStatus("");
  } finally {
    renderApp();
  }
}

async function exportReviewCartBibtex({ sortBy = "author" } = {}) {
  const reviewNodes = store.getReviewCartNodes();
  if (!reviewNodes.length) {
    setError("Add at least one paper to the review cart before exporting.");
    return;
  }

  const sortMode = normalizeBibtexSort(sortBy);
  const sortedNodes = sortReviewNodesForBibtex(reviewNodes, sortMode);
  setStatus(`Preparing BibTeX export (${getBibtexSortLabel(sortMode)} order)...`);
  clearError();

  const entries = [];
  let fallbackCount = 0;

  for (const node of sortedNodes) {
    try {
      const paper = await api.fetchPaperBibtex(node.paperId);
      const entry = extractOrBuildBibtexEntry(paper, node);
      if (!paper?.citationStyles?.bibtex) {
        fallbackCount += 1;
      }
      entries.push(entry);
    } catch {
      fallbackCount += 1;
      entries.push(extractOrBuildBibtexEntry(null, node));
    }
  }

  const payload = buildBibtexDocument(entries);
  const seedFragment = safeFileFragment(store.seedPaperId || "litgraph");
  const fileName = `litgraph-review-${seedFragment}-${getBibtexSortLabel(sortMode)}-${buildUniqueExportSuffix()}.bib`;
  downloadText(payload, fileName, "application/x-bibtex;charset=utf-8");
  const fallbackSuffix = fallbackCount > 0 ? ` (${fallbackCount} fallback entr${fallbackCount === 1 ? "y" : "ies"})` : "";
  setStatus(`Exported ${reviewNodes.length} paper(s) to ${fileName}${fallbackSuffix}`);
}

async function exportReviewIdentifiersText({ sortBy = "author" } = {}) {
  const reviewNodes = store.getReviewCartNodes();
  if (!reviewNodes.length) {
    setError("Add at least one paper to the review cart before exporting.");
    return;
  }

  const sortMode = normalizeBibtexSort(sortBy);
  const sortedNodes = sortReviewNodesForBibtex(reviewNodes, sortMode);
  setStatus(`Preparing identifier export (${getBibtexSortLabel(sortMode)} order)...`);
  clearError();

  const rows = [];
  let fallbackCount = 0;
  for (const node of sortedNodes) {
    try {
      const paper = await api.fetchPaperIdentifiers(node.paperId);
      rows.push(extractPaperIdentifiers(paper, node));
    } catch {
      fallbackCount += 1;
      rows.push(extractPaperIdentifiers(null, node));
    }
  }

  const payload = buildIdentifiersText(rows);
  const seedFragment = safeFileFragment(store.seedPaperId || "litgraph");
  const fileName = `litgraph-identifiers-${seedFragment}-${getBibtexSortLabel(sortMode)}-${buildUniqueExportSuffix()}.txt`;
  downloadText(payload, fileName, "text/plain;charset=utf-8");
  const fallbackSuffix = fallbackCount > 0 ? ` (${fallbackCount} partial entr${fallbackCount === 1 ? "y" : "ies"})` : "";
  setStatus(`Exported identifiers for ${reviewNodes.length} paper(s) to ${fileName}${fallbackSuffix}`);
}

function renderApp() {
  const snapshot = store.snapshot();
  const selectedNode = snapshot.selectedNodeId ? store.getNode(snapshot.selectedNodeId) : null;
  const reviewNodes = store.getReviewCartNodes();

  renderer.render(snapshot);
  updateLayoutControls(snapshot.nodes);

  elements.graphEmpty.hidden = snapshot.nodes.length > 0;
  elements.graphSummary.textContent = snapshot.nodes.length
    ? `${snapshot.nodes.length} node${snapshot.nodes.length === 1 ? "" : "s"} • ${snapshot.links.length} link${snapshot.links.length === 1 ? "" : "s"}`
    : "No graph loaded";

  sidecar.render(selectedNode, {
    canExpand: selectedNode ? store.canExpand(selectedNode.paperId) : false,
  });

  reviewCart.render(reviewNodes);
  reviewDraft.render({
    state: reviewDraftState,
    gate: getReviewGenerationGate(reviewNodes.length),
    referencesById: buildReviewReferenceIndex(reviewDraftState.payload?.references),
  });
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

function handleExpansionModeChange() {
  const mode = getSelectedExpansionMode();
  setStatus(`${getExpansionModeLabel(mode)} mode selected. Future expansions will use this strategy.`);
  clearError();
}

function handleExpansionCountChange() {
  const count = getSelectedExpansionCount();
  elements.expansionCountInput.value = String(count);
  setStatus(`Future expansions will keep up to ${count} papers per side.`);
  clearError();
}

function updateLayoutControls(nodes) {
  const mode = renderer.getLayoutMode();
  const metadata = renderer.getLayoutMetadata();
  const yearRange = metadata?.yearRange;
  const barsEnabled = metadata?.yearBarsEnabled !== false;

  elements.layoutModeBtn.setAttribute("aria-pressed", String(mode === "year"));
  elements.layoutModeBtn.textContent = mode === "year" ? "Year Layout: On" : "Year Layout: Off";
  elements.yearBarsBtn.setAttribute("aria-pressed", String(barsEnabled));
  elements.yearBarsBtn.textContent = barsEnabled ? "Year Bars: On" : "Year Bars: Off";
  elements.expansionCountInput.value = String(getSelectedExpansionCount());

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

function getSelectedExpansionMode() {
  const raw = elements.expansionModeSelect?.value;
  return raw || EXPANSION_MODE_RELEVANCE;
}

function getSelectedExpansionCount() {
  return normalizeExpansionCount(elements.expansionCountInput?.value, {
    fallback: DEFAULT_EXPANSION_PAPERS_PER_SIDE,
    max: EXPANSION_LIMIT,
  });
}

function toggleYearBars() {
  const nextEnabled = !renderer.getYearBarsEnabled();
  const changed = renderer.setYearBarsEnabled(nextEnabled);
  if (!changed) return;

  setStatus(nextEnabled ? "Year bar histogram enabled." : "Year bar histogram hidden.");
  clearError();
  renderApp();
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

function handleReviewReferenceSelect(refId, paperId = null) {
  const targetPaperId = paperId
    || reviewDraftState.payload?.references?.find((reference) => reference.refId === refId)?.paperId
    || null;
  if (!targetPaperId) return;

  selectNode(targetPaperId);
  const node = store.getNode(targetPaperId);
  if (node) {
    setStatus(`Selected ${refId}: ${node.title}`);
    hydrateNodeDetailsIfNeeded(targetPaperId);
  }
}

function formatErrorMessage(error) {
  if (!error) return "Unknown error";
  const base = error.message || String(error);
  if (error.retryAfterSeconds != null) {
    return `${base} (retry in ~${error.retryAfterSeconds}s)`;
  }
  return base;
}

function downloadText(text, fileName, contentType = "text/plain;charset=utf-8") {
  const blob = new Blob([String(text || "")], { type: contentType });
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

function buildUniqueExportSuffix() {
  const now = new Date();
  const stamp = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
    "-",
    String(now.getUTCHours()).padStart(2, "0"),
    String(now.getUTCMinutes()).padStart(2, "0"),
    String(now.getUTCSeconds()).padStart(2, "0"),
    String(now.getUTCMilliseconds()).padStart(3, "0"),
  ].join("");
  const randomToken = Math.random().toString(36).slice(2, 8);
  return `${stamp}-${randomToken}`;
}

function buildReviewReferenceIndex(references) {
  const index = {};
  for (const reference of Array.isArray(references) ? references : []) {
    if (!reference?.refId) continue;
    index[reference.refId] = reference;
  }
  return index;
}
