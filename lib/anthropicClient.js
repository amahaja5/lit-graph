import { ProxyHttpError } from "./errors.js";

const ANTHROPIC_API_BASE_URL = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";

export function createAnthropicClient({
  apiKey = process.env.ANTHROPIC_API_KEY,
  model = process.env.ANTHROPIC_MODEL,
  fetchImpl = globalThis.fetch,
  logger = console,
  maxTokens = 4096,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required");
  }

  async function generateStructuredSynthesis({
    corpusPacket,
    allowedReferenceIds,
  }) {
    if (!apiKey || !model) {
      throw new ProxyHttpError({
        code: "review_not_configured",
        message: "Review generation is not configured (missing ANTHROPIC_API_KEY or ANTHROPIC_MODEL).",
        status: 500,
      });
    }

    const response = await fetchImpl(`${ANTHROPIC_API_BASE_URL}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: buildSystemPrompt(allowedReferenceIds),
        messages: [{
          role: "user",
          content: [{
            type: "text",
            text: buildUserPrompt(corpusPacket),
          }],
        }],
      }),
    });

    const bodyText = await response.text();
    if (!response.ok) {
      throw mapAnthropicError(response.status, bodyText);
    }

    let payload;
    try {
      payload = JSON.parse(bodyText);
    } catch {
      throw new ProxyHttpError({
        code: "review_upstream_invalid_json",
        message: "Anthropic returned invalid JSON.",
        status: 502,
        upstreamStatus: response.status,
      });
    }

    const text = extractTextContent(payload);
    if (!text) {
      throw new ProxyHttpError({
        code: "invalid_model_response",
        message: "Anthropic returned no review text.",
        status: 502,
      });
    }

    let parsedReview;
    try {
      parsedReview = parseJsonObject(text);
    } catch (error) {
      logger?.debug?.(`review json parse failed: ${error?.message || error}`);
      throw new ProxyHttpError({
        code: "invalid_model_response",
        message: "Anthropic did not return valid JSON for the review draft.",
        status: 502,
      });
    }

    return {
      model,
      review: validateStructuredReview(parsedReview, allowedReferenceIds),
    };
  }

  return {
    model,
    generateStructuredSynthesis,
  };
}

export function validateStructuredReview(review, allowedReferenceIds) {
  const refSet = new Set(Array.isArray(allowedReferenceIds) ? allowedReferenceIds : []);
  const source = review && typeof review === "object" ? review : null;
  if (!source) {
    throw new ProxyHttpError({
      code: "invalid_model_response",
      message: "Review payload is not an object.",
      status: 502,
    });
  }

  const normalized = {
    corpusOverview: normalizeOverview(source.corpusOverview, refSet),
    themes: normalizeTitledItems(source.themes, "theme", refSet),
    methodsEvidence: normalizeTitledItems(source.methodsEvidence, "methods/evidence item", refSet),
    agreements: normalizeClaimItems(source.agreements, "agreement", refSet),
    disagreements: normalizeClaimItems(source.disagreements, "disagreement", refSet),
    gaps: normalizeClaimItems(source.gaps, "gap", refSet),
    suggestedNextReads: normalizeSuggestionItems(source.suggestedNextReads, refSet),
    evidenceLimitations: normalizeLimitationItems(source.evidenceLimitations, refSet),
  };

  return normalized;
}

function normalizeOverview(value, refSet) {
  const source = value && typeof value === "object" ? value : {};
  const summary = asNonEmptyString(source.summary);
  if (!summary) {
    throw invalidModelResponse("corpusOverview.summary must be a non-empty string.");
  }
  return {
    summary,
    citations: normalizeCitations(source.citations, refSet, "corpusOverview"),
  };
}

function normalizeTitledItems(value, label, refSet) {
  return normalizeArray(value, label).map((item, index) => {
    const title = asNonEmptyString(item.title);
    const summary = asNonEmptyString(item.summary);
    if (!title || !summary) {
      throw invalidModelResponse(`${label} ${index + 1} must include title and summary.`);
    }
    return {
      title,
      summary,
      citations: normalizeCitations(item.citations, refSet, `${label} ${index + 1}`),
    };
  });
}

function normalizeClaimItems(value, label, refSet) {
  return normalizeArray(value, label).map((item, index) => {
    const claim = asNonEmptyString(item.claim);
    if (!claim) {
      throw invalidModelResponse(`${label} ${index + 1} must include claim.`);
    }
    return {
      claim,
      citations: normalizeCitations(item.citations, refSet, `${label} ${index + 1}`),
    };
  });
}

function normalizeSuggestionItems(value, refSet) {
  return normalizeArray(value, "suggested next read").map((item, index) => {
    const suggestion = asNonEmptyString(item.suggestion);
    if (!suggestion) {
      throw invalidModelResponse(`suggested next read ${index + 1} must include suggestion.`);
    }
    return {
      suggestion,
      citations: normalizeCitations(item.citations, refSet, `suggested next read ${index + 1}`),
    };
  });
}

function normalizeLimitationItems(value, refSet) {
  return normalizeArray(value, "evidence limitation").map((item, index) => {
    const limitation = asNonEmptyString(item.limitation);
    if (!limitation) {
      throw invalidModelResponse(`evidence limitation ${index + 1} must include limitation.`);
    }
    return {
      limitation,
      citations: normalizeCitations(item.citations, refSet, `evidence limitation ${index + 1}`),
    };
  });
}

function normalizeCitations(value, refSet, label) {
  const list = Array.isArray(value) ? value : [];
  if (!list.length) {
    throw invalidModelResponse(`${label} must include at least one citation.`);
  }

  const citations = [...new Set(list.map((item) => asNonEmptyString(item)).filter(Boolean))];
  if (!citations.length) {
    throw invalidModelResponse(`${label} citations must contain valid reference IDs.`);
  }
  for (const citation of citations) {
    if (!refSet.has(citation)) {
      throw invalidModelResponse(`${label} cited unknown reference ID: ${citation}.`);
    }
  }
  return citations;
}

function normalizeArray(value, label) {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw invalidModelResponse(`${label} section must be an array.`);
  }
  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => item);
}

function extractTextContent(payload) {
  const content = Array.isArray(payload?.content) ? payload.content : [];
  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function parseJsonObject(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    throw new Error("empty text");
  }
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return JSON.parse(trimmed);
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("no JSON object found");
  }
  return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
}

function mapAnthropicError(status, bodyText = "") {
  const parsedMessage = extractUpstreamMessage(bodyText);
  if (status === 400) {
    return new ProxyHttpError({
      code: "review_bad_request",
      message: parsedMessage || "Anthropic rejected the review request.",
      status: 502,
      upstreamStatus: status,
    });
  }
  if (status === 401 || status === 403) {
    return new ProxyHttpError({
      code: "review_unauthorized",
      message: parsedMessage || "Anthropic authentication failed.",
      status: 502,
      upstreamStatus: status,
    });
  }
  if (status === 429) {
    return new ProxyHttpError({
      code: "review_rate_limited",
      message: parsedMessage || "Anthropic rate limit reached.",
      status: 429,
      upstreamStatus: status,
    });
  }
  return new ProxyHttpError({
    code: "review_upstream_unavailable",
    message: parsedMessage || "Anthropic is temporarily unavailable.",
    status: 502,
    upstreamStatus: status,
  });
}

function buildSystemPrompt(allowedReferenceIds) {
  return [
    "You are generating a structured literature synthesis from a supplied paper corpus.",
    "Use only the supplied corpus packet. Do not use outside knowledge, outside sources, or invented papers.",
    `Allowed citation IDs: ${allowedReferenceIds.join(", ")}.`,
    "Return JSON only. Do not wrap it in markdown fences or prose.",
    "Every substantive statement must cite one or more allowed reference IDs.",
    "If the corpus is sparse or conflicting, say so explicitly in evidenceLimitations.",
    "suggestedNextReads must only recommend papers that already exist in the supplied corpus.",
  ].join(" ");
}

function buildUserPrompt(corpusPacket) {
  return [
    "Return a JSON object with this exact top-level shape:",
    "{",
    '  "corpusOverview": { "summary": string, "citations": string[] },',
    '  "themes": [{ "title": string, "summary": string, "citations": string[] }],',
    '  "methodsEvidence": [{ "title": string, "summary": string, "citations": string[] }],',
    '  "agreements": [{ "claim": string, "citations": string[] }],',
    '  "disagreements": [{ "claim": string, "citations": string[] }],',
    '  "gaps": [{ "claim": string, "citations": string[] }],',
    '  "suggestedNextReads": [{ "suggestion": string, "citations": string[] }],',
    '  "evidenceLimitations": [{ "limitation": string, "citations": string[] }]',
    "}",
    "",
    "Corpus packet:",
    corpusPacket,
  ].join("\n");
}

function extractUpstreamMessage(bodyText) {
  if (!bodyText) return "";
  try {
    const parsed = JSON.parse(bodyText);
    return parsed?.error?.message || parsed?.message || "";
  } catch {
    return bodyText.length > 300 ? `${bodyText.slice(0, 300)}…` : bodyText;
  }
}

function invalidModelResponse(message) {
  return new ProxyHttpError({
    code: "invalid_model_response",
    message,
    status: 502,
  });
}

function asNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}
