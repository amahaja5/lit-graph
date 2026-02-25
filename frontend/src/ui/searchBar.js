export function createSearchBar({ formEl, inputEl, submitBtnEl, statusEl, errorEl, onSubmit }) {
  if (!formEl || !inputEl || !submitBtnEl) {
    throw new Error("Search bar elements are required");
  }

  formEl.addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = inputEl.value.trim();
    if (!value) {
      setError("Enter a Semantic Scholar paper identifier (DOI, ARXIV, or paperId).");
      return;
    }
    clearError();
    await onSubmit?.(value);
  });

  function setLoading(isLoading) {
    submitBtnEl.disabled = Boolean(isLoading);
    submitBtnEl.textContent = isLoading ? "Loading..." : "Load Seed";
    inputEl.disabled = Boolean(isLoading);
  }

  function setStatus(message = "") {
    if (statusEl) statusEl.textContent = message;
  }

  function setError(message = "") {
    if (errorEl) errorEl.textContent = message;
  }

  function clearError() {
    setError("");
  }

  return {
    setLoading,
    setStatus,
    setError,
    clearError,
    focus() {
      inputEl.focus();
    },
    setValue(value) {
      inputEl.value = value ?? "";
    },
    getValue() {
      return inputEl.value;
    },
  };
}
