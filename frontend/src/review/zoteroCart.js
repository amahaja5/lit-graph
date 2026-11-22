// Saves the Explore review cart to a Zotero collection, for use as a reading list.
// Papers are identified by their Semantic Scholar ID; the server resolves their metadata.
const MAX_RETRIES = 5, SPACING_MS = 300;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function postJson(url, body) {
  const response = await fetch(url, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.error?.message || `Request failed (${response.status}).`);
    error.status = response.status; error.retryAfterSeconds = data?.error?.retryAfterSeconds;
    throw error;
  }
  return data;
}

export function createZoteroCartSaver({
  els, getNodes, getSeedTitle = () => '', account,
  post = postJson, sleep = wait, newId = () => crypto.randomUUID(),
} = {}) {
  // One collection per name: saving again adds new papers to it; renaming starts a new collection.
  let importId = newId(), collection = null, savedFor = '', busy = false, stop = false;
  const saved = new Set();
  const status = (text, error = false) => { els.status.textContent = text; els.status.classList.toggle('audit-error', error); };
  const name = () => els.name.value.trim().slice(0, 200);
  const unsaved = () => getNodes().filter(node => !saved.has(node.paperId));

  async function retrying(send) {
    for (let attempt = 0; ; attempt++) {
      try { return await send(); }
      catch (error) {
        if (error.status !== 429 || attempt >= MAX_RETRIES || stop) throw error;
        const seconds = Math.min(Math.max(Number(error.retryAfterSeconds) || 2, 1), 120);
        for (let left = seconds; left > 0 && !stop; left--) { status(`${error.message} Continuing in ${left} s…`); await sleep(1000); }
        if (stop) return null;
      }
    }
  }
  async function pauseAfter(result) {
    const seconds = Math.min(Number(result?.backoffSeconds) || 0, 120);
    for (let left = seconds; left > 0 && !stop; left--) { status(`Zotero asked for a pause. Continuing in ${left} s…`); await sleep(1000); }
    if (!seconds) await sleep(SPACING_MS);
  }

  async function save() {
    if (busy) { stop = true; status('Stopping after the current paper…'); return; }
    const s = account.status();
    if (!s?.connected) {
      try { if (!(await account.signIn())) return; }
      catch (error) { status(error.message, true); return; }
      return save();
    }
    if (!s.writeRequested) { status('Your Zotero sign-in is read-only. Sign out (top right) and sign in again to allow saving.', true); return; }
    if (!name()) { status('Name the Zotero collection first.', true); els.name.focus(); return; }
    if (collection && name() !== savedFor) { importId = newId(); collection = null; saved.clear(); }
    const todo = unsaved();
    if (!todo.length) { status(`All papers are already in "${savedFor}".`); return; }
    busy = true; stop = false; render();
    let done = 0, sources = { semanticscholar: 0 };
    try {
      if (!collection) {
        status('Creating the Zotero collection…');
        collection = await retrying(() => post('/api/import/collection', { importId, name: name() }));
        if (!collection) return;
        savedFor = name();
        await pauseAfter(collection);
      }
      els.open.href = collection.url; els.open.hidden = false;
      for (const node of todo) {
        if (stop) break;
        status(`Saving to Zotero… ${done + 1} of ${todo.length}`);
        const result = await retrying(() => post('/api/import/work', { importId, paperId: node.paperId }));
        if (!result) break;
        saved.add(node.paperId); done++;
        if (result.source === 'semanticscholar') sources.semanticscholar++;
        render();
        await pauseAfter(result);
      }
      const note = sources.semanticscholar ? ` ${sources.semanticscholar} had no DOI and used Semantic Scholar metadata.` : '';
      status(stop ? `Stopped. Saved ${done} of ${todo.length} to "${savedFor}".` : `Saved ${done} paper${done === 1 ? '' : 's'} to "${savedFor}".${note}`);
    } catch (error) {
      status(`${error.message}${done ? ` Saved ${done} before the error; save again to continue.` : ''}`, true);
    } finally { busy = false; stop = false; render(); }
  }

  function render() {
    const nodes = getNodes();
    if (!els.name.value && nodes.length) {
      const seed = String(getSeedTitle() || '').trim();
      els.name.value = (seed ? `Reading list · ${seed}` : `LitGraph reading list ${new Date().toISOString().slice(0, 10)}`).slice(0, 200);
    }
    const s = account.status();
    const remaining = unsaved().length;
    els.name.disabled = busy || !nodes.length;
    els.save.disabled = !nodes.length || (!busy && !remaining && Boolean(collection));
    els.save.textContent = busy ? 'Stop saving'
      : !s?.connected ? 'Sign in to save to Zotero'
      : collection && name() === savedFor ? (remaining ? `Save ${remaining} more to Zotero` : 'Saved to Zotero')
      : `Save ${nodes.length} to Zotero`;
  }

  els.save.addEventListener('click', save);
  els.name.addEventListener('input', render);
  return { render, save };
}
