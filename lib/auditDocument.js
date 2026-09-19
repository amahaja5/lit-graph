import { createHash } from "node:crypto";
import { badRequest } from "./errors.js";

export const MAX_MANUSCRIPT_CHARS = 100_000;
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export const normalizeText = (text) =>
  String(text || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();

export async function extractPdf(buffer) {
  if (buffer.length > 20 * 1024 * 1024)
    throw badRequest("Source PDF exceeds 20 MB.");
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: true,
    disableFontFace: true,
  });
  let doc;
  try {
    doc = await task.promise;
    if (doc.numPages > 300)
      throw badRequest(
        "PDF exceeds 300 pages. Use a chapter or shorter manuscript.",
      );
    const labels = await doc.getPageLabels();
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) =>
          typeof item.str === "string"
            ? item.str + (item.hasEOL ? "\n" : " ")
            : "",
        )
        .join("");
      pages.push({ page: i, label: labels?.[i - 1] || null, text });
      page.cleanup();
    }
    return {
      sha256: hash(buffer),
      pages,
      pageCount: pages.length,
      emptyPages: pages.filter((p) => !p.text.trim()).map((p) => p.page),
    };
  } finally {
    await task.destroy();
  }
}

export async function readManuscript(
  body,
  { fetchImpl = globalThis.fetch } = {},
) {
  if (body?.arxiv && !body.file) {
    const id = String(body.arxiv)
      .trim()
      .match(
        /^(?:https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\/)?(\d{4}\.\d{4,5}(?:v\d+)?)(?:\.pdf)?$/i,
      )?.[1];
    if (!id)
      throw badRequest(
        "Enter a modern arXiv identifier or an arxiv.org abstract/PDF URL.",
      );
    const response = await fetchImpl(`https://arxiv.org/pdf/${id}`, {
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok)
      throw badRequest(
        `Could not retrieve the arXiv manuscript (${response.status}). Upload its PDF instead.`,
      );
    let size = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > MAX_UPLOAD_BYTES)
        throw badRequest(
          "The arXiv manuscript exceeds 3 MB. Paste its text or audit a smaller section.",
        );
      chunks.push(Buffer.from(chunk));
    }
    body = {
      file: {
        name: `arxiv-${id}.pdf`,
        base64: Buffer.concat(chunks).toString("base64"),
      },
    };
  }
  let text = typeof body?.text === "string" ? body.text.trim() : "";
  let filename = "Pasted manuscript";
  let pages = [];
  if (body?.file) {
    const file = body.file;
    if (
      typeof file.base64 !== "string" ||
      file.base64.length > (MAX_UPLOAD_BYTES * 4) / 3 + 4 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64)
    )
      throw badRequest("Upload a valid file no larger than 3 MB.");
    const bytes = Buffer.from(file.base64, "base64");
    if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES)
      throw badRequest("Upload a nonempty file no larger than 3 MB.");
    filename = String(file.name || "manuscript").slice(0, 200);
    const extension = filename.split(".").at(-1).toLowerCase();
    if (extension === "pdf") {
      const pdf = await extractPdf(bytes);
      pages = pdf.pages;
      if (pdf.emptyPages.length)
        throw badRequest(
          `PDF pages ${pdf.emptyPages.join(", ")} have no readable text. OCR the manuscript first to avoid skipping citations.`,
        );
      text = pages.map((p) => p.text).join("\n\n");
    } else if (extension === "docx") {
      const mammoth = await import("mammoth");
      text = (await mammoth.extractRawText({ buffer: bytes })).value;
    } else if (["txt", "md"].includes(extension)) text = bytes.toString("utf8");
    else throw badRequest("Supported files: PDF, DOCX, TXT, or Markdown.");
  }
  if (text.length < 40)
    throw badRequest(
      "Include manuscript text and its bibliography (at least 40 characters).",
    );
  if (text.length > MAX_MANUSCRIPT_CHARS)
    throw badRequest(
      "Manuscript exceeds 100,000 characters. Audit a section with its bibliography.",
    );
  return {
    filename,
    text,
    sha256: hash(text),
    pages: pages.map((p) => ({ page: p.page, label: p.label })),
  };
}
