export function createReviewCart({ countEl, listEl, exportBtnEl, onExport, onSelectNode } = {}) {
  exportBtnEl?.addEventListener("click", () => onExport?.());

  listEl?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-paper-id]");
    if (!button) return;
    onSelectNode?.(button.dataset.paperId);
  });

  function render(nodes) {
    const items = Array.isArray(nodes) ? nodes : [];
    countEl.textContent = String(items.length);
    exportBtnEl.disabled = items.length === 0;

    listEl.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("li");
      empty.className = "review-empty";
      empty.textContent = "No papers selected yet.";
      listEl.append(empty);
      return;
    }

    for (const node of items) {
      const li = document.createElement("li");
      li.className = "review-item";

      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary";
      button.dataset.paperId = node.paperId;
      button.textContent = node.title;
      button.classList.add("review-item-title");

      const meta = document.createElement("div");
      meta.className = "review-item-meta";
      meta.textContent = `${node.year ?? "Unknown year"} • ${node.venue || "Unknown venue"}`;

      li.append(button, meta);
      listEl.append(li);
    }
  }

  return { render };
}
