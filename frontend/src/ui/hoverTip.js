const DEFAULT_OFFSET_X = 16;
const DEFAULT_OFFSET_Y = 18;
const DEFAULT_STATUS_HIDE_MS = 2400;
const DEFAULT_ERROR_HIDE_MS = 4200;
const DEFAULT_NOTICE_HIDE_MS = 3600;

export function createHoverTip({ tipEl, trackTarget = window } = {}) {
  if (!tipEl) {
    throw new Error("tipEl is required");
  }

  let pointerX = null;
  let pointerY = null;
  let timeoutId = null;
  let currentTone = null;

  const moveHandler = (event) => {
    if (typeof event?.clientX !== "number" || typeof event?.clientY !== "number") return;
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (!tipEl.hidden) {
      placeTip();
    }
  };

  trackTarget.addEventListener("pointermove", moveHandler);

  function show(message, { tone = "status", autoHideMs = defaultHideMsForTone(tone) } = {}) {
    const text = String(message || "").trim();
    if (!text) {
      clear({ tone });
      return;
    }

    clearTimer();
    currentTone = tone;
    tipEl.hidden = false;
    tipEl.textContent = text;
    tipEl.dataset.tone = tone;
    placeTip();

    if (autoHideMs > 0) {
      timeoutId = window.setTimeout(() => {
        if (currentTone === tone) {
          clear({ tone });
        }
      }, autoHideMs);
    }
  }

  function clear({ tone = null } = {}) {
    if (tone && currentTone !== tone) return;

    clearTimer();
    currentTone = null;
    tipEl.hidden = true;
    tipEl.textContent = "";
    delete tipEl.dataset.tone;
  }

  function placeTip() {
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1280;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 800;

    const rect = tipEl.getBoundingClientRect();
    const baseX = pointerX ?? viewportWidth / 2;
    const baseY = pointerY ?? 92;

    const nextLeft = clamp(baseX + DEFAULT_OFFSET_X, 12, Math.max(12, viewportWidth - rect.width - 12));
    const nextTop = clamp(baseY + DEFAULT_OFFSET_Y, 12, Math.max(12, viewportHeight - rect.height - 12));

    tipEl.style.left = `${nextLeft}px`;
    tipEl.style.top = `${nextTop}px`;
  }

  function clearTimer() {
    if (timeoutId != null) {
      window.clearTimeout(timeoutId);
      timeoutId = null;
    }
  }

  function destroy() {
    clear();
    trackTarget.removeEventListener("pointermove", moveHandler);
  }

  return {
    show,
    clear,
    destroy,
    getCurrentTone() {
      return currentTone;
    },
  };
}

function defaultHideMsForTone(tone) {
  if (tone === "error") return DEFAULT_ERROR_HIDE_MS;
  if (tone === "notice") return DEFAULT_NOTICE_HIDE_MS;
  return DEFAULT_STATUS_HIDE_MS;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
