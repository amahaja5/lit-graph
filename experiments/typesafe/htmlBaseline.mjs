// Readable-text extraction from HTML, used as the baseline in the TypeSafe HTML experiments.
// Copied from the app's former review-evidence module so the experiments stay reproducible.
const MIN_EXTRACTED_TEXT_LENGTH = 150;

export function extractReadableTextFromHtml(html, { maxChars = 12_000 } = {}) {
  const source = typeof html === "string" ? html : "";
  if (!source) return "";

  let region = pickLikelyContentRegion(source);
  region = stripElements(region, ["script", "style", "noscript", "svg", "nav", "footer", "header", "aside", "form", "button"]);
  region = region
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|main|li|ul|ol|h1|h2|h3|h4|h5|h6|blockquote|tr)>/gi, "\n\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, " ");

  const text = normalizeWhitespace(htmlDecode(region), { preserveParagraphs: true });
  if (text.length < MIN_EXTRACTED_TEXT_LENGTH) {
    return "";
  }
  return clampText(text, maxChars);
}

function pickLikelyContentRegion(html) {
  const article = firstTagContents(html, "article");
  if (article) return article;
  const main = firstTagContents(html, "main");
  if (main) return main;
  const body = firstTagContents(html, "body");
  if (body) return body;
  return html;
}

function stripElements(html, tagNames) {
  let result = html;
  for (const tagName of tagNames) {
    const pattern = new RegExp(`<${tagName}\\b[^>]*>[\\s\\S]*?<\\/${tagName}>`, "gi");
    result = result.replace(pattern, " ");
  }
  return result;
}

function normalizeWhitespace(value, { preserveParagraphs = false } = {}) {
  const text = typeof value === "string" ? value : "";
  if (!text) return "";

  if (!preserveParagraphs) {
    return text.replace(/\s+/g, " ").trim();
  }

  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function htmlDecode(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'");
}

function clampText(text, maxChars) {
  if (!maxChars || text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  const boundary = slice.lastIndexOf(" ");
  return `${(boundary > maxChars * 0.7 ? slice.slice(0, boundary) : slice).trim()}…`;
}

function firstTagContents(html, tagName) {
  const match = html.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? match[1] : "";
}
