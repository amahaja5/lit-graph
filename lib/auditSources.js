import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { extractPdf, normalizeText } from "./auditDocument.js";

const keyPattern = /^[A-Z0-9]{8}$/;
const normalizedTitle = (value) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
export const arxivId = (value) =>
  String(value || "").match(/\b(\d{4}\.\d{4,5}(?:v\d+)?)\b/i)?.[1] || "";
const doi = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "")
    .replace(/^doi:\s*/, "")
    .trim();

export function matchReference(reference, items) {
  const wantedArxiv = arxivId(
    reference.arxiv || reference.doi || reference.bibliography,
  );
  const wantedDoi = doi(reference.doi);
  return items.filter((item) => {
    const d = item.data || {};
    if (["attachment", "note"].includes(d.itemType)) return false;
    const actualArxiv = arxivId(
      `${d.url || ""} ${d.DOI || ""} ${d.extra || ""} ${d.archiveID || ""}`,
    );
    if (wantedArxiv && actualArxiv)
      return (
        wantedArxiv.replace(/v\d+$/, "") === actualArxiv.replace(/v\d+$/, "")
      );
    if (wantedDoi && d.DOI) return wantedDoi === doi(d.DOI);
    // An explicit identifier must not silently degrade to a title match.
    if (wantedArxiv || wantedDoi) return false;
    return (
      reference.title &&
      normalizedTitle(reference.title).length > 10 &&
      normalizedTitle(reference.title) === normalizedTitle(d.title)
    );
  });
}

async function boundedBytes(response, max = 20 * 1024 * 1024) {
  if (!response.ok)
    throw new Error(`Source retrieval failed (${response.status}).`);
  if (Number(response.headers.get("content-length")) > max) {
    await response.body?.cancel();
    throw new Error("Source exceeds download limit.");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > max) {
      throw new Error("Source exceeds download limit.");
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export function createAuditSources({
  fetchImpl = globalThis.fetch,
  mode = process.env.ZOTERO_MODE || (process.env.VERCEL ? "web" : "local"),
  apiKey = process.env.ZOTERO_API_KEY,
  userId = process.env.ZOTERO_USER_ID,
  groupId = process.env.ZOTERO_GROUP_ID,
} = {}) {
  const local = mode === "local";
  const base = local ? "http://127.0.0.1:23119/api" : "https://api.zotero.org";
  const library = groupId
    ? `groups/${groupId}`
    : `users/${local ? "0" : userId}`;
  const configured = local || Boolean(apiKey && (userId || groupId));
  const cache = new Map();
  async function request(route, query = {}) {
    if (!configured) throw new Error("Zotero Web API is not configured.");
    const url = new URL(`${base}/${library}/${route}`);
    Object.entries(query).forEach(([k, v]) =>
      url.searchParams.set(k, String(v)),
    );
    return fetchImpl(url, {
      redirect: "manual",
      headers: {
        "Zotero-API-Version": "3",
        ...(!local && apiKey ? { "Zotero-API-Key": apiKey } : {}),
      },
      signal: AbortSignal.timeout(12_000),
    });
  }
  async function all(route, query = {}) {
    const items = [];
    for (let start = 0; start < 10000; start += 100) {
      const response = await request(route, {
        ...query,
        format: "json",
        limit: 100,
        start,
      });
      if (!response.ok)
        throw new Error(
          `Zotero returned ${response.status}. Open Zotero and enable local API access, or check server credentials.`,
        );
      const page = await response.json();
      if (!Array.isArray(page)) throw new Error("Unexpected Zotero response.");
      items.push(...page);
      if (page.length < 100) return items;
    }
    throw new Error(
      "Collection exceeds 10,000 items. Choose a smaller collection.",
    );
  }
  async function collections() {
    return (await all("collections")).map((c) => ({
      key: c.key,
      name: c.data.name,
    }));
  }
  async function pdfForAttachment(attachment) {
    const response = await request(`items/${attachment.key}/file`);
    let bytes;
    if (local) {
      const location = response.headers.get("location");
      if (
        ![301, 302, 303, 307, 308].includes(response.status) ||
        !location?.startsWith("file://")
      )
        throw new Error("Zotero PDF is not available locally.");
      const file = fileURLToPath(location);
      // Path comes only from the configured loopback Zotero API, never from a client parameter.
      if ((await stat(file)).size > 20 * 1024 * 1024)
        throw new Error("Source PDF exceeds 20 MB.");
      bytes = await readFile(file);
    } else if (response.status === 302 || response.status === 303) {
      const url = new URL(response.headers.get("location"));
      if (
        url.protocol !== "https:" ||
        !(
          url.hostname.endsWith(".zotero.org") ||
          url.hostname.endsWith(".amazonaws.com")
        )
      )
        throw new Error("Unexpected Zotero storage redirect.");
      // Never forward the Zotero API key to storage.
      bytes = await boundedBytes(
        await fetchImpl(url, {
          redirect: "error",
          signal: AbortSignal.timeout(30_000),
        }),
      );
    } else bytes = await boundedBytes(response);
    return extractPdf(bytes);
  }
  async function resolve(reference, collectionKey = "") {
    if (collectionKey && !keyPattern.test(collectionKey))
      throw new Error("Invalid Zotero collection key.");
    const cacheKey = JSON.stringify([reference, collectionKey]);
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < 300_000) return hit.value;
    const warnings = [];
    let items = [];
    try {
      if (collectionKey)
        items = await all(`collections/${collectionKey}/items`);
      else {
        const query =
          reference.title ||
          reference.doi ||
          reference.arxiv ||
          reference.label;
        items = await all("items", { q: query, qmode: "everything" });
      }
    } catch (e) {
      warnings.push(e.message);
    }
    const matches = matchReference(reference, items);
    let result;
    if (matches.length > 1)
      result = {
        status: "ambiguous",
        title: reference.title,
        warnings: [
          ...warnings,
          "Multiple library records match. Narrow the collection or provide an unambiguous identifier.",
        ],
      };
    else if (matches.length === 1) {
      const item = matches[0];
      try {
        if (
          !reference.doi &&
          !arxivId(reference.arxiv || reference.bibliography)
        ) {
          const bibliography = normalizedTitle(reference.bibliography);
          const creator = item.data.creators?.[0];
          const surname = normalizedTitle(creator?.lastName || creator?.name);
          const year = String(item.data.date || "").match(/\b\d{4}\b/)?.[0];
          if (
            !surname ||
            !year ||
            !bibliography.includes(surname) ||
            !bibliography.includes(year)
          ) {
            throw new Error(
              "The title matches, but author and year could not be confirmed. Add a DOI or arXiv identifier to disambiguate the cited source.",
            );
          }
          const edition = String(item.data.edition || "").match(/\d+/)?.[0];
          if (
            edition &&
            !new RegExp(`${edition}(?:st|nd|rd|th)?\\s+ed`, "i").test(
              reference.bibliography || "",
            )
          ) {
            throw new Error(
              "The library record has an edition not confirmed in the citation. Resolve the edition before auditing this source.",
            );
          }
        }
        const children = await all(`items/${item.key}/children`);
        let attachments = children.filter(
          (c) => c.data.contentType === "application/pdf",
        );
        const wanted = arxivId(reference.arxiv || reference.bibliography);
        if (/v\d+$/.test(wanted))
          attachments = attachments.filter(
            (a) => arxivId(a.data.url) === wanted,
          );
        if (attachments.length !== 1)
          throw new Error(
            attachments.length
              ? "Multiple PDFs found. Specify the cited version or use a collection with an unambiguous attachment."
              : "No PDF attachment matching the cited version is available.",
          );
        const attachment = attachments[0];
        const pdf = await pdfForAttachment(attachment);
        const actualVersion = arxivId(pdf.pages[0]?.text);
        if (/v\d+$/.test(wanted) && actualVersion !== wanted)
          throw new Error(
            "The PDF text does not confirm the cited arXiv version.",
          );
        result = {
          ...pdf,
          status: "available",
          title: item.data.title,
          itemKey: item.key,
          attachmentKey: attachment.key,
          sourceUrl: safeSourceUrl(attachment.data.url || item.data.url),
          retrieval: local ? "Zotero local PDF" : "Zotero stored PDF",
          version: actualVersion || arxivId(attachment.data.url),
          warnings,
        };
      } catch (e) {
        warnings.push(e.message);
      }
    }
    if (!result) {
      const id = arxivId(
        reference.arxiv || reference.doi || reference.bibliography,
      );
      if (id) {
        try {
          const url = `https://arxiv.org/pdf/${id}`;
          const bytes = await boundedBytes(
            await fetchImpl(url, {
              redirect: "error",
              signal: AbortSignal.timeout(30_000),
            }),
          );
          const pdf = await extractPdf(bytes);
          const actualVersion = arxivId(pdf.pages[0]?.text);
          if (/v\d+$/.test(id) && actualVersion !== id)
            throw new Error(
              "The public PDF does not confirm the cited arXiv version.",
            );
          result = {
            ...pdf,
            status: "available",
            title: reference.title,
            sourceUrl: url,
            retrieval: "Public arXiv PDF",
            version: actualVersion || id,
            warnings,
          };
        } catch (e) {
          warnings.push(e.message);
        }
      }
    }
    result ||= {
      status: "unavailable",
      title: reference.title,
      warnings: [
        ...warnings,
        "Full text could not be retrieved. Add the cited PDF to Zotero or supply its arXiv identifier.",
      ],
    };
    if (cache.size >= 30) cache.delete(cache.keys().next().value);
    if (result.status === "available")
      cache.set(cacheKey, { at: Date.now(), value: result });
    return result;
  }
  return { mode, configured, collections, resolve };
}

export function safeSourceUrl(value) {
  try {
    const u = new URL(value);
    return ["http:", "https:"].includes(u.protocol) ? u.href : "";
  } catch {
    return "";
  }
}
