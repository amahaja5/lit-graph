import {
  AUDIT_LABELS,
  auditSummary,
  buildAuditExport,
  auditMarkdown,
} from "./auditState.js";
import { linkImportedSources } from "./importLink.js";
import { takeAuditHandoff } from "../shared/auditHandoff.js";
import { onZoteroChange } from "../shared/zoteroAccount.js";

const $ = (id) => document.getElementById(id);
const text = (tag, content, className = "") => {
  const el = document.createElement(tag);
  el.textContent = content;
  el.className = className;
  return el;
};
let inventory = null,
  results = {},
  busy = false,
  controller = null,
  modelReady = false;
let zoteroStatus = null, zoteroBusy = false, zoteroIdentity = null;
let handoff = null;
function clearHandoff() {
  handoff = null;
  $("audit-handoff").hidden = true;
}
const inputs = () => [
  ...document.querySelectorAll(
    "#manuscript-audit input, #manuscript-audit textarea, #manuscript-audit select",
  ),
];

function message(content, error = false) {
  $("audit-status").textContent = content;
  $("audit-status").classList.toggle("audit-error", error);
}
function updateControls() {
  const locked = busy || zoteroBusy;
  $("audit-extract").disabled = locked || !modelReady;
  $("audit-run").disabled = locked || !modelReady || !inventory?.claims.length;
  const complete =
    inventory?.claims.length &&
    inventory.claims.every((c) => results[c.id] && !results[c.id].error);
  $("audit-run").textContent = complete
    ? "Run audit again"
    : Object.keys(results).length
      ? "Resume / retry audit"
      : "Check cited claims";
  $("audit-stop").hidden = !busy;
  $("audit-connect").disabled = locked;
  $("audit-add-reference").disabled =
    locked || !inventory || inventory.references.length >= 80;
  $("audit-add-passage").disabled =
    locked || !inventory || inventory.claims.length >= 150;
  for (const el of inputs()) el.disabled = locked;
  $("audit-download").disabled = !inventory;
  $("audit-download-json").disabled = !inventory;
}
function invalidateInventory() {
  inventory = null;
  results = {};
  $("audit-inventory").replaceChildren();
  $("audit-results").replaceChildren();
  $("audit-review").hidden = true;
  updateControls();
}
function invalidateResults() {
  const open = new Set(
    [...document.querySelectorAll(".audit-mapping[open]")].map(
      (el) => el.dataset.claimId,
    ),
  );
  results = {};
  renderResults();
  for (const el of document.querySelectorAll(".audit-mapping"))
    el.open = open.has(el.dataset.claimId);
  message("Inventory changed. Run the audit again.");
  updateControls();
}
async function request(action, body, namespace = 'audit') {
  const headers = { accept: "application/json" };
  if (body) headers["content-type"] = "application/json";
  const response = await fetch(`/api/${namespace}/${action}`, {
    method: body ? "POST" : "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: namespace === 'audit' && ['extract', 'check'].includes(action) ? controller?.signal : undefined,
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(
      data?.error?.message || `Request failed (${response.status}).`,
    );
    error.code = data?.error?.code;
    throw error;
  }
  return data;
}
async function connect() {
  if (busy) return;
  modelReady = false;
  updateControls();
  $("audit-connect").disabled = true;
  try {
    zoteroStatus = await request('status', undefined, 'zotero');
    renderZoteroConnection();
    if (zoteroStatus.appLogin && !zoteroStatus.connected) {
      $("audit-connection").textContent = 'Sign in with Zotero to begin.';
      message('Sign in with an allowed Zotero account to unlock the app.');
      return;
    }
    const status = await request("status");
    modelReady = status.modelConfigured;
    $("audit-connection").textContent = status.zoteroError
      ? "Zotero unavailable · public arXiv fallback"
      : `Zotero ${status.zoteroMode} connected`;
    $("audit-setup").hidden = modelReady;
    $("audit-setup").textContent = modelReady
      ? ""
      : `To check citations, set ${[!status.extractionConfigured && "GROBID_API_URL and EXTRACTION_API_KEY", !status.checkerConfigured && "TYPESAFE_API_KEY"].filter(Boolean).join(" and ") || "the GROBID and TypeSafe settings"} in the server environment and restart the app.`;
    const select = $("audit-collection");
    const old = select.value;
    select.replaceChildren(new Option("Search the whole library", ""));
    for (const c of status.collections) select.add(new Option(c.name, c.key));
    select.value = Array.from(select.options).some((o) => o.value === old)
      ? old
      : "";
    if (select.value !== old) invalidateResults();
    if (status.zoteroError) message(status.zoteroError, true);
    else
      message(
        modelReady
          ? "Ready. Add your manuscript and bibliography."
          : "Zotero is connected. Model setup is required before citation extraction.",
      );
  } catch (e) {
    modelReady = false;
    $("audit-connection").textContent = "Connection needs attention";
    $("zotero-connection-status").textContent = e.message;
    message(e.message, true);
  } finally {
    $("audit-connect").disabled = false;
    updateControls();
  }
}
function renderZoteroConnection() {
  const s = zoteroStatus;
  const identity = s.connected ? `oauth:${s.userId}` : s.mode;
  if (zoteroIdentity !== null && zoteroIdentity !== identity) invalidateResults();
  zoteroIdentity = identity;
  $("zotero-manage").hidden = s.mode === 'local' && !s.connected;
  $("zotero-connection-status").textContent = s.connected
    ? `Connected as ${s.username || `Zotero user ${s.userId}`}. This browser’s connection expires after 8 hours.`
    : s.mode === 'local'
      ? 'Local mode: keep Zotero Desktop open on this computer. No Zotero API key is needed.'
      : s.configured
        ? 'Sign in with Zotero (top right) to read your personal library and synced PDFs.'
        : 'Zotero sign-in has not been enabled on this server. Ask the app administrator to finish setup.';
}
async function uploadPayload() {
  const file = $("audit-file").files[0];
  if (!file && handoff?.manuscript?.file) return { file: handoff.manuscript.file };
  if (!file) {
    if ($("audit-arxiv").value.trim()) return { arxiv: $("audit-arxiv").value.trim() };
    throw new Error("Choose the manuscript PDF or enter an arXiv link.");
  }
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf")
    throw new Error("Choose the manuscript as a PDF.");
  if (file.size > 3 * 1024 * 1024)
    throw new Error("Choose a PDF no larger than 3 MB.");
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () =>
      reject(new Error("Could not read the selected file."));
    reader.readAsDataURL(file);
  });
  return { file: { name: file.name, base64 } };
}
async function extract() {
  busy = true;
  controller = new AbortController();
  updateControls();
  message("Extracting citations and the bibliography with GROBID…");
  try {
    const data = await request("extract", await uploadPayload());
    inventory = data;
    results = {};
    const linked = handoff ? linkImportedSources(data.references, handoff.references) : 0;
    renderInventory();
    renderResults();
    message(
      `Found ${data.claims.length} cited passages and ${data.references.length} bibliography entries.${handoff ? ` Linked ${linked} to the Zotero items you imported.` : ""} Review the inventory before checking claims.`,
    );
  } catch (e) {
    message(
      e.name === "AbortError" ? "Extraction stopped." : e.message,
      e.name !== "AbortError",
    );
  } finally {
    busy = false;
    controller = null;
    updateControls();
  }
}
function renderInventory() {
  $("audit-review").hidden = false;
  $("audit-inventory-note").textContent = [
    inventory.coverageNotice,
    ...inventory.warnings,
  ].join(" ");
  const root = $("audit-inventory");
  root.replaceChildren();
  const used = new Set(inventory.claims.flatMap((c) => c.referenceIds));
  for (const ref of inventory.references) {
    const details = document.createElement("details");
    details.className = "audit-reference";
    details.append(
      text(
        "summary",
        `${ref.label} · ${ref.title || "Unresolved reference"}${used.has(ref.id) ? "" : " · uncited"}${ref.zoteroKey ? " · linked to imported Zotero item" : ""}`,
      ),
    );
    details.append(
      text(
        "p",
        ref.bibliography ||
          "No bibliography entry was found for this citation.",
        "muted",
      ),
    );
    for (const [field, label] of [
      ["title", "Source title"],
      ["doi", "DOI"],
      ["arxiv", "arXiv ID and version"],
    ]) {
      const wrapper = text("label", label);
      const input = document.createElement("input");
      input.value = ref[field] || "";
      input.maxLength = field === "title" ? 500 : 200;
      input.addEventListener("change", () => {
        ref.originalSource ??= {
          title: ref.title,
          doi: ref.doi,
          arxiv: ref.arxiv,
        };
        ref.manuallyEdited = true;
        ref[field] = input.value.trim();
        delete ref.zoteroKey; // An edited identity is no longer the imported item.
        details.querySelector("summary").textContent =
          `${ref.label} · ${ref.title || "Unresolved reference"}`;
        invalidateResults();
      });
      wrapper.append(input);
      details.append(wrapper);
    }
    root.append(details);
  }
}
function safeLink(url, label) {
  try {
    const u = new URL(url);
    if (!["http:", "https:"].includes(u.protocol)) return null;
    const a = text("a", label);
    a.href = u.href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    return a;
  } catch {
    return null;
  }
}
function renderResults() {
  const root = $("audit-results");
  root.replaceChildren();
  if (!inventory) return;
  const counts = auditSummary(inventory, results);
  $("audit-summary").textContent =
    `${counts.checked}/${counts.total} checked · ${counts.supported} supported · ${counts.partially_supported} partial · ${counts.contradicted} contradicted · ${counts.insufficient_evidence} insufficient · ${counts.pending} pending · ${counts.errors} failed`;
  for (const claim of inventory.claims) {
    const result = results[claim.id];
    const card = document.createElement("article");
    card.className = "audit-claim";
    const heading = document.createElement("div");
    heading.className = "audit-claim-heading";
    heading.append(text("h3", claim.id));
    const status = result?.error
      ? "Failed"
      : result
        ? AUDIT_LABELS[result.combined.status]
        : "Not checked";
    heading.append(
      text("span", status, `audit-badge ${result?.combined?.status || ""}`),
    );
    card.append(heading, text("blockquote", claim.text));
    const mapping = document.createElement("details");
    mapping.className = "audit-mapping";
    mapping.dataset.claimId = claim.id;
    mapping.append(text("summary", "Edit passage or citation mapping"));
    const passageLabel = text("label", "Passage text");
    const passage = document.createElement("textarea");
    passage.value = claim.text;
    passage.maxLength = 5000;
    passage.rows = 3;
    passage.addEventListener("change", () => {
      claim.originalText ??= claim.text;
      claim.text = passage.value.trim();
      claim.manuallyEdited = true;
      invalidateResults();
    });
    passageLabel.append(passage);
    mapping.append(passageLabel);
    const sourcesLabel = text("p", "Cited sources (up to eight)");
    mapping.append(sourcesLabel);
    for (const ref of inventory.references) {
      const label = document.createElement("label");
      label.className = "audit-source-choice";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = claim.referenceIds.includes(ref.id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked && claim.referenceIds.length >= 8) {
          checkbox.checked = false;
          message("Select at most eight sources for one passage.", true);
          return;
        }
        claim.referenceIds = checkbox.checked
          ? [...claim.referenceIds, ref.id]
          : claim.referenceIds.filter((id) => id !== ref.id);
        claim.manuallyEdited = true;
        invalidateResults();
      });
      label.append(
        checkbox,
        document.createTextNode(
          `${ref.label} · ${ref.title || "Unresolved source"}`,
        ),
      );
      mapping.append(label);
    }
    card.append(mapping);
    card.append(
      text(
        "p",
        `Cites: ${claim.referenceIds.map((id) => inventory.references.find((r) => r.id === id)?.label || id).join("; ") || "No source resolved"}`,
        "muted",
      ),
    );
    if (result?.error) card.append(text("p", result.error, "audit-error"));
    else if (result) {
      card.append(text("p", result.combined.explanation));
      for (const a of result.assessments) {
        const detail = document.createElement("details");
        detail.className = "audit-evidence";
        detail.open = a.status !== "supported";
        detail.append(
          text(
            "summary",
            `${AUDIT_LABELS[a.status]} · ${a.source.title || a.referenceId}`,
          ),
        );
        detail.append(text("p", a.explanation));
        for (const e of a.evidence) {
          detail.append(text("blockquote", e.quote));
          const link = safeLink(
            e.sourceUrl ? `${e.sourceUrl.split("#")[0]}#page=${e.page}` : "",
            `Open source · PDF page ${e.page}`,
          );
          detail.append(link || text("p", `PDF page ${e.page}`));
        }
        if (a.suggestedRevision)
          detail.append(
            text(
              "p",
              `Suggested revision: ${a.suggestedRevision}`,
              "audit-revision",
            ),
          );
        if (a.source.retrieval)
          detail.append(
            text(
              "p",
              `${a.source.retrieval} · reviewed PDF pages ${a.source.pagesConsidered.join(", ") || "none"}`,
              "muted",
            ),
          );
        for (const w of a.source.warnings) detail.append(text("p", w, "muted"));
        card.append(detail);
      }
    }
    root.append(card);
  }
}
async function run() {
  if (!inventory) return;
  if (inventory.claims.every((c) => results[c.id] && !results[c.id].error)) {
    results = {};
    renderResults();
  }
  busy = true;
  controller = new AbortController();
  updateControls();
  try {
    for (let i = 0; i < inventory.claims.length; i++) {
      if (controller.signal.aborted) break;
      const claim = inventory.claims[i];
      if (results[claim.id] && !results[claim.id].error) continue;
      message(
        `Checking passage ${i + 1} of ${inventory.claims.length}: retrieving ${claim.referenceIds.length} cited source(s)…`,
      );
      try {
        results[claim.id] = await request("check", {
          claim,
          references: inventory.references,
          collectionKey: $("audit-collection").value,
        });
      } catch (e) {
        if (e.name === "AbortError") break;
        results[claim.id] = { error: e.message };
      }
      renderResults();
      updateControls();
    }
    message(
      controller.signal.aborted
        ? "Stopped. Completed findings are retained; resume to continue."
        : "Audit pass finished. Review the evidence and any unresolved or failed passages.",
    );
  } finally {
    busy = false;
    controller = null;
    updateControls();
  }
}
function download(json = false) {
  if (!inventory) return;
  const report = buildAuditExport(inventory, results);
  const blob = new Blob(
    [json ? JSON.stringify(report, null, 2) : auditMarkdown(report)],
    { type: json ? "application/json" : "text/markdown" },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `manuscript-citation-audit.${json ? "json" : "md"}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("audit-add-reference").addEventListener("click", () => {
  if (!inventory || inventory.references.length >= 80) return;
  let n = inventory.references.length + 1;
  while (inventory.references.some((r) => r.id === `M${n}`)) n++;
  inventory.references.push({
    id: `M${n}`,
    label: `Added reference ${n}`,
    title: "",
    bibliography: "",
    doi: "",
    arxiv: "",
    manuallyAdded: true,
  });
  renderInventory();
  invalidateResults();
  const last = $("audit-inventory").lastElementChild;
  if (last) {
    last.closest(".audit-inventory-wrap").open = true;
    last.open = true;
    last.querySelector("input")?.focus();
  }
});
$("audit-add-passage").addEventListener("click", () => {
  if (!inventory || inventory.claims.length >= 150) return;
  let n = inventory.claims.length + 1;
  while (inventory.claims.some((c) => c.id === `C${n}`)) n++;
  inventory.claims.push({
    id: `C${n}`,
    text: "Enter the omitted cited passage here.",
    marker: "",
    referenceIds: [],
    manuallyAdded: true,
  });
  invalidateResults();
  const detail =
    $("audit-results").lastElementChild?.querySelector(".audit-mapping");
  if (detail) {
    detail.open = true;
    detail.querySelector("textarea")?.focus();
  }
});
$("audit-extract").addEventListener("click", extract);
$("audit-run").addEventListener("click", run);
$("audit-stop").addEventListener("click", () => controller?.abort());
$("audit-connect").addEventListener("click", connect);
$("audit-download").addEventListener("click", () => download());
$("audit-download-json").addEventListener("click", () => download(true));
$("audit-arxiv").addEventListener("input", () => {
  clearHandoff();
  $("audit-file").value = "";
  invalidateInventory();
});
$("audit-file").addEventListener("change", () => {
  clearHandoff();
  $("audit-arxiv").value = "";
  invalidateInventory();
  if ($("audit-file").files.length)
    message("PDF selected. Extract citations to begin.");
});
$("audit-collection").addEventListener("change", invalidateResults);
// Arriving from an import: same manuscript, its new collection, and the saved Zotero items.
async function acceptHandoff() {
  const next = takeAuditHandoff();
  if (!next || busy) return;
  $("audit-connection").dataset.loaded = 'true';
  $("audit-arxiv").value = "";
  $("audit-file").value = "";
  invalidateInventory();
  handoff = next;
  $("audit-handoff").textContent = `Using the manuscript you just imported${next.manuscript?.file ? ` (${next.manuscript.file.name})` : ""}, with ${next.references.length} linked Zotero items from "${next.collection.name}".`;
  $("audit-handoff").hidden = false;
  await connect();
  const select = $("audit-collection");
  if (!Array.from(select.options).some(o => o.value === next.collection.key))
    select.add(new Option(next.collection.name, next.collection.key));
  select.value = next.collection.key;
  if (modelReady && handoff === next) await extract();
}
window.addEventListener('litgraph-audit-handoff', acceptHandoff);
// The header sign-in changed: reload this workspace's connection if it has been opened.
onZoteroChange(() => { if ($("audit-connection").dataset.loaded && !busy) connect(); });
window.addEventListener('litgraph-workspace', (event) => {
  if (event.detail === 'audit' && !$("audit-connection").dataset.loaded) {
    $("audit-connection").dataset.loaded = 'true';
    connect();
  }
});
updateControls();
