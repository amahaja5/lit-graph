import { candidateToGraphLink, candidateToPaperNode } from "./normalize.js";

export class GraphStore {
  constructor() {
    this.reset();
  }

  reset() {
    this.nodes = new Map();
    this.links = [];
    this.linkIds = new Set();
    this.selectedNodeId = null;
    this.reviewCart = new Set();
    this.seedPaperId = null;
    this.notices = [];
  }

  setRoot(rootNode) {
    if (!rootNode?.paperId) {
      throw new Error("Root node requires a paperId");
    }
    this.reset();
    const node = this.upsertNode({
      ...rootNode,
      state: rootNode.state || "unexplored",
      isRoot: true,
      isSelected: true,
      isInReviewCart: false,
      errorMessage: null,
    });
    this.seedPaperId = node.paperId;
    this.selectedNodeId = node.paperId;
    return node;
  }

  upsertNode(nodeLike) {
    if (!nodeLike?.paperId) return null;
    const id = nodeLike.paperId;
    const existing = this.nodes.get(id);
    const merged = existing
      ? {
          ...existing,
          ...nodeLike,
          paperId: id,
          id,
          isRoot: Boolean(existing.isRoot || nodeLike.isRoot),
          isSelected: this.selectedNodeId === id,
          isInReviewCart: this.reviewCart.has(id),
          errorMessage: nodeLike.errorMessage ?? existing.errorMessage ?? null,
        }
      : {
          id,
          paperId: id,
          title: nodeLike.title || "Untitled paper",
          year: nodeLike.year ?? null,
          abstract: nodeLike.abstract ?? null,
          authors: Array.isArray(nodeLike.authors) ? nodeLike.authors : [],
          citationCount: Number(nodeLike.citationCount) || 0,
          influentialCitationCount: Number(nodeLike.influentialCitationCount) || 0,
          referenceCount: Number(nodeLike.referenceCount) || 0,
          url: nodeLike.url ?? null,
          venue: nodeLike.venue ?? null,
          state: nodeLike.state || "unexplored",
          isRoot: Boolean(nodeLike.isRoot),
          isSelected: this.selectedNodeId === id,
          isInReviewCart: this.reviewCart.has(id),
          errorMessage: nodeLike.errorMessage ?? null,
        };

    this.nodes.set(id, merged);
    return merged;
  }

  getNode(nodeId) {
    return this.nodes.get(nodeId) || null;
  }

  getNodes() {
    return [...this.nodes.values()];
  }

  getLinks() {
    return [...this.links];
  }

  setSelectedNode(nodeId) {
    if (nodeId != null && !this.nodes.has(nodeId)) return null;
    this.selectedNodeId = nodeId;
    for (const [id, node] of this.nodes.entries()) {
      node.isSelected = id === nodeId;
    }
    return this.getNode(nodeId);
  }

  canExpand(nodeId) {
    const node = this.getNode(nodeId);
    if (!node) return false;
    return node.state === "unexplored" || node.state === "error";
  }

  setNodeState(nodeId, state, { errorMessage = null } = {}) {
    const node = this.getNode(nodeId);
    if (!node) return null;
    node.state = state;
    node.errorMessage = errorMessage;
    return node;
  }

  mergeExpansion(sourcePaperId, candidates) {
    let nodesAdded = 0;
    let linksAdded = 0;

    for (const candidate of candidates) {
      const targetNode = candidateToPaperNode(candidate);
      if (!targetNode) continue;
      const existed = this.nodes.has(targetNode.paperId);
      this.upsertNode(targetNode);
      if (!existed) nodesAdded += 1;

      const link = candidateToGraphLink(candidate);
      if (!link || this.linkIds.has(link.id)) continue;
      this.linkIds.add(link.id);
      this.links.push(link);
      linksAdded += 1;
    }

    const sourceNode = this.getNode(sourcePaperId);
    if (sourceNode && sourceNode.state === "loading") {
      sourceNode.state = "expanded";
      sourceNode.errorMessage = null;
    }

    return { nodesAdded, linksAdded };
  }

  setExpansionNotice(sourcePaperId, { citationsTruncated = false, referencesTruncated = false } = {}) {
    this.notices = this.notices.filter((notice) => notice.sourcePaperId !== sourcePaperId);
    if (!citationsTruncated && !referencesTruncated) return;

    const pieces = [];
    if (citationsTruncated) pieces.push("citations");
    if (referencesTruncated) pieces.push("references");
    this.notices.push({
      sourcePaperId,
      kind: "truncation",
      message: `Expansion for ${sourcePaperId} was truncated to the first page for ${pieces.join(" and ")}.`,
    });
  }

  getNotices() {
    return [...this.notices];
  }

  toggleReviewCart(nodeId) {
    const node = this.getNode(nodeId);
    if (!node) return false;

    if (this.reviewCart.has(nodeId)) {
      this.reviewCart.delete(nodeId);
      node.isInReviewCart = false;
      return false;
    }

    this.reviewCart.add(nodeId);
    node.isInReviewCart = true;
    return true;
  }

  getReviewCartNodes() {
    return [...this.reviewCart]
      .map((id) => this.getNode(id))
      .filter(Boolean)
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  toReviewExport() {
    const selectedPaperIds = [...this.reviewCart].sort();
    const selectedSet = new Set(selectedPaperIds);
    const papers = selectedPaperIds
      .map((paperId) => this.getNode(paperId))
      .filter(Boolean)
      .map((node) => ({
        paperId: node.paperId,
        title: node.title,
        year: node.year,
        abstract: node.abstract,
        authors: node.authors,
        citationCount: node.citationCount,
        influentialCitationCount: node.influentialCitationCount,
        referenceCount: node.referenceCount,
        url: node.url,
        venue: node.venue,
      }));

    const links = this.links.filter((link) => selectedSet.has(link.source) || selectedSet.has(link.target));

    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      seedPaperId: this.seedPaperId,
      selectedPaperIds,
      papers,
      links,
    };
  }

  snapshot() {
    return {
      nodes: this.getNodes(),
      links: this.getLinks(),
      selectedNodeId: this.selectedNodeId,
      reviewCount: this.reviewCart.size,
      notices: this.getNotices(),
      seedPaperId: this.seedPaperId,
    };
  }
}
