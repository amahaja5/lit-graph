function sectionTitle(label) {
  const heading = document.createElement("h3");
  heading.className = "review-draft-section-title";
  heading.textContent = label;
  return heading;
}

function renderCitationList(citations, { onSelectReference } = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "review-citations";
  for (const citation of Array.isArray(citations) ? citations : []) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "review-citation";
    button.textContent = citation;
    if (typeof onSelectReference === "function") {
      button.addEventListener("click", () => onSelectReference(citation));
    } else {
      button.disabled = true;
    }
    wrapper.append(button);
  }
  return wrapper;
}

function renderParagraph(text) {
  const p = document.createElement("p");
  p.className = "review-draft-copy";
  p.textContent = text;
  return p;
}

function renderObjectList(items, { key, keyLabel = "", onSelectReference } = {}) {
  const list = document.createElement("ul");
  list.className = "review-draft-list";

  for (const item of Array.isArray(items) ? items : []) {
    const li = document.createElement("li");
    li.className = "review-draft-item";

    const body = document.createElement("div");
    body.className = "review-draft-item-body";

    if (key && item[key]) {
      const strong = document.createElement("strong");
      strong.className = "review-draft-item-heading";
      strong.textContent = keyLabel ? `${keyLabel}: ${item[key]}` : item[key];
      body.append(strong);
    }

    const summaryKey = item.summary ? "summary" : item.claim ? "claim" : item.suggestion ? "suggestion" : item.limitation ? "limitation" : "";
    if (summaryKey) {
      body.append(renderParagraph(item[summaryKey]));
    }

    body.append(renderCitationList(item.citations, { onSelectReference }));
    li.append(body);
    list.append(li);
  }

  return list;
}

export function createReviewDraft({
  buttonEl,
  badgeEl,
  emptyEl,
  contentEl,
  statusEl,
  warningsEl,
  onGenerate,
  onSelectReference,
} = {}) {
  buttonEl?.addEventListener("click", () => {
    onGenerate?.();
  });

  function render({ state, gate, referencesById } = {}) {
    const reviewState = state || {};
    const canGenerate = Boolean(gate?.canGenerate) && reviewState.status !== "loading";
    if (buttonEl) {
      buttonEl.disabled = !canGenerate;
      buttonEl.textContent = reviewState.status === "loading"
        ? "Generating Review..."
        : reviewState.payload
          ? "Regenerate Review"
          : "Generate Review";
    }

    if (badgeEl) {
      badgeEl.hidden = !reviewState.stale;
      badgeEl.textContent = reviewState.stale ? "Stale" : "";
    }

    if (statusEl) {
      statusEl.textContent = reviewState.status === "loading"
        ? "Generating structured synthesis from the review cart..."
        : reviewState.errorMessage
          ? reviewState.errorMessage
          : reviewState.payload
            ? `${reviewState.payload.references.length} paper${reviewState.payload.references.length === 1 ? "" : "s"} synthesized via ${reviewState.payload.model}.`
            : gate?.reason || "Generate a literature synthesis from the current review cart.";
      statusEl.classList.toggle("review-draft-error", Boolean(reviewState.errorMessage));
    }

    if (warningsEl) {
      warningsEl.replaceChildren();
      for (const warning of Array.isArray(reviewState.payload?.warnings) ? reviewState.payload.warnings : []) {
        const div = document.createElement("div");
        div.className = "review-warning";
        div.textContent = warning;
        warningsEl.append(div);
      }
    }

    if (!reviewState.payload) {
      if (emptyEl) {
        emptyEl.hidden = false;
        emptyEl.textContent = gate?.reason || "Generate a literature synthesis from the current review cart.";
      }
      if (contentEl) {
        contentEl.hidden = true;
        contentEl.replaceChildren();
      }
      return;
    }

    if (emptyEl) emptyEl.hidden = true;
    if (contentEl) contentEl.hidden = false;
    contentEl.replaceChildren(
      renderOverview(reviewState.payload.review, onSelectReference),
      renderSection("Themes", reviewState.payload.review.themes, { key: "title", onSelectReference }),
      renderSection("Methods / Evidence", reviewState.payload.review.methodsEvidence, { key: "title", onSelectReference }),
      renderSection("Agreements", reviewState.payload.review.agreements, { onSelectReference }),
      renderSection("Disagreements", reviewState.payload.review.disagreements, { onSelectReference }),
      renderSection("Gaps", reviewState.payload.review.gaps, { onSelectReference }),
      renderSection("Suggested Next Reads", reviewState.payload.review.suggestedNextReads, { onSelectReference }),
      renderSection("Evidence Limitations", reviewState.payload.review.evidenceLimitations, { onSelectReference }),
      renderReferences(reviewState.payload.references, referencesById, onSelectReference),
    );
  }

  return { render };
}

function renderOverview(review, onSelectReference) {
  const section = document.createElement("section");
  section.className = "review-draft-section";
  section.append(
    sectionTitle("Corpus Overview"),
    renderParagraph(review.corpusOverview.summary),
    renderCitationList(review.corpusOverview.citations, { onSelectReference }),
  );
  return section;
}

function renderSection(label, items, { key = "", onSelectReference } = {}) {
  const section = document.createElement("section");
  section.className = "review-draft-section";
  section.append(sectionTitle(label));

  if (!Array.isArray(items) || items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = `No ${label.toLowerCase()} surfaced in this pass.`;
    section.append(empty);
    return section;
  }

  section.append(renderObjectList(items, { key, onSelectReference }));
  return section;
}

function renderReferences(references, referencesById, onSelectReference) {
  const section = document.createElement("section");
  section.className = "review-draft-section";
  section.append(sectionTitle("References"));

  const list = document.createElement("ul");
  list.className = "review-reference-list";
  for (const reference of Array.isArray(references) ? references : []) {
    const li = document.createElement("li");
    li.className = "review-reference-item";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary review-reference-button";
    button.textContent = `${reference.refId} · ${reference.title} (${reference.year ?? "Unknown"})`;
    button.addEventListener("click", () => {
      const selectedRef = referencesById?.[reference.refId];
      onSelectReference?.(reference.refId, selectedRef?.paperId || reference.paperId);
    });

    const meta = document.createElement("div");
    meta.className = "review-reference-meta";
    meta.textContent = `${reference.coverage} • ${reference.sourceUrl || "Source unavailable"}`;

    li.append(button, meta);
    list.append(li);
  }

  section.append(list);
  return section;
}
