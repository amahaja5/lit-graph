// Starts the scale-to-zero GROBID service before the user extracts a PDF, so the
// cold start overlaps with sign-in and file selection instead of the Extract click.
const STORAGE_KEY = 'litgraph-grobid-warmed-at';
export const WARM_INTERVAL_MS = 5 * 60 * 1000;

export function createGrobidWarmer({ fetchImpl = (...a) => fetch(...a), storage = safeSessionStorage(), now = Date.now } = {}) {
  let pending = null;
  return function warmGrobid() {
    if (pending) return pending;
    const last = storage.getItem(STORAGE_KEY);
    if (last !== null && now() - Number(last) < WARM_INTERVAL_MS) return Promise.resolve(null);
    pending = fetchImpl('/api/import/warm', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: '{}' })
      .then(async response => {
        if (!response.ok) return null; // Signed out or not allowed: try again after sign-in.
        const data = await response.json();
        if (data?.state === 'ready' || data?.state === 'starting') storage.setItem(STORAGE_KEY, String(now()));
        return data;
      })
      .catch(() => null)
      .finally(() => { pending = null; });
    return pending;
  };
}

function safeSessionStorage() {
  try { if (window.sessionStorage) return window.sessionStorage; } catch { /* storage blocked */ }
  const memory = new Map();
  return { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
}

export const warmGrobid = createGrobidWarmer();

// Warm on app load for an existing session, and right after a Zotero sign-in from any workspace.
export function installGrobidWarmup() {
  fetch('/api/zotero/status', { headers: { Accept: 'application/json' } })
    .then(response => response.ok ? response.json() : null)
    .then(status => { if (status && (status.connected || !status.appLogin)) warmGrobid(); })
    .catch(() => {});
  window.addEventListener('message', event => {
    if (event.origin === location.origin && event.data?.type === 'litgraph-zotero' && event.data.success) warmGrobid();
  });
}
