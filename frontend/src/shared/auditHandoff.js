// Carries an imported manuscript and its saved Zotero items from the Import workspace to
// the audit workspace. Kept in memory: a PDF can exceed sessionStorage limits, and the
// hand-off only needs to survive a workspace switch within the page.
let pending = null;
export function offerAuditHandoff(handoff) {
  pending = handoff;
  window.dispatchEvent(new CustomEvent('litgraph-audit-handoff'));
}
export function takeAuditHandoff() {
  const handoff = pending;
  pending = null;
  return handoff;
}
