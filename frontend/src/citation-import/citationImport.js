import { automaticMatch } from './importMatching.js';
import { referencesToRis } from './ris.js';
import { installGrobidWarmup, warmGrobid } from './grobidWarmup.js';
import { offerAuditHandoff } from '../shared/auditHandoff.js';
import { onZoteroChange } from '../shared/zoteroAccount.js';
const $ = id => document.getElementById(`import-${id}`);
const element = (tag, value, className = '') => { const el = document.createElement(tag); el.textContent = value; el.className = className; return el; };
let rows = [], busy = false, stop = false, ready = false, connection = null, loaded = false;
let importId = crypto.randomUUID(), collection = null, owner = null, manuscript = null;
const selected = () => rows.filter(r => r.selected && r.candidates[r.choice]);
function message(value, error = false) { $('status').textContent = value; $('status').classList.toggle('audit-error', error); }
// Every reference is in exactly one state; the list groups them so attention items come first.
const STATE_LABEL = { review: 'Needs review', notfound: 'No match', error: 'Lookup failed', pending: 'Not looked up', ready: 'Ready to save', saved: 'Saved', skipped: 'Skipped' };
const GROUP = { review: 'attention', notfound: 'attention', error: 'attention', pending: 'attention', ready: 'ready', saved: 'saved', skipped: 'skipped' };
function stateOf(row) {
  if (row.saved) return 'saved';
  if (row.skipped) return 'skipped';
  if (row.selected && row.candidates[row.choice]) return 'ready';
  if (row.error) return 'error';
  if (!row.lookedUp) return 'pending';
  return row.candidates.length ? 'review' : 'notfound';
}
function counts() {
  const c = { attention: 0, ready: 0, saved: 0, skipped: 0 };
  for (const row of rows) c[GROUP[stateOf(row)]]++;
  return c;
}
let filter = 'attention', showSetup = false, sourceName = '';
function progress(done, total) {
  const bar = $('progress');
  bar.hidden = !total;
  if (total) { bar.max = total; bar.value = done; }
}
function controls() {
  for (const el of document.querySelectorAll('#citation-import input, #citation-import textarea, #citation-import select, #citation-import button'))
    if (!el.closest('#import-filters')) el.disabled = busy;
  const c = counts();
  $('extract').disabled = busy || !ready || !$('consent').checked;
  const collapsed = rows.length > 0 && !showSetup;
  $('setup').hidden = collapsed;
  $('loaded').hidden = !collapsed;
  $('loaded-name').textContent = `${sourceName || 'Manuscript'} · ${rows.length} references`;
  $('more').hidden = !rows.length;
  $('lookup-all').disabled = busy || !rows.some(r => !r.saved && !r.lookedUp);
  $('add').disabled = busy || rows.length >= 80;
  $('save').hidden = !c.ready || busy; // While matching or saving, Stop is the only action.
  $('save').textContent = `Save ${c.ready} to Zotero`;
  $('save').disabled = busy || !connection?.connected || !connection?.writeRequested || !c.ready;
  $('name-field').hidden = Boolean(collection) || !c.ready || busy;
  $('name').disabled = busy || Boolean(collection);
  $('stop').hidden = !busy || !rows.length;
  $('stop').disabled = false;
  if (!busy) progress(0, 0);
  $('download').disabled = !rows.length;
  $('ris').disabled = busy || !rows.length;
  $('summary').textContent = rows.length
    ? [`${c.saved} saved`, c.ready && `${c.ready} ready to save`, c.attention && `${c.attention} need attention`, c.skipped && `${c.skipped} skipped`].filter(Boolean).join(' · ') + (c.ready && !connection?.connected ? ' · sign in to Zotero to save' : '')
    : '';
  $('next').hidden = !(collection && manuscript && rows.some(r => r.saved && r.zotero?.key));
  $('check').disabled = busy;
  for (const card of document.querySelectorAll('[data-import-saved="true"]')) for (const el of card.querySelectorAll('input, textarea, select, button')) el.disabled = true;
}
async function request(action, body, namespace = 'import') {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`/api/${namespace}/${action}`, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let data;
  try { data = await response.json(); } catch { throw new Error(`The server returned an unreadable response (${response.status}). Retry this step.`); }
  if (!response.ok) {
    const error = new Error(data?.error?.message || `Request failed (${response.status}).`);
    error.status = response.status; error.retryAfterSeconds = data?.error?.retryAfterSeconds;
    throw error;
  }
  return data;
}
function reset() {
  rows = []; importId = crypto.randomUUID(); collection = null; manuscript = null; filter = 'attention'; showSetup = false;
  $('review').hidden = true; $('references').replaceChildren(); $('open-collection').hidden = true; controls();
}
async function refresh() {
  ready = false;
  try {
    connection = await request('status', undefined, 'zotero');
    if (connection.appLogin && !connection.connected) {
      $('connection-status').textContent = 'Sign in to unlock extraction and imports.';
      $('zotero-status').textContent = connection.configured ? 'Sign in with Zotero (top right) using an allowed account. Your library stays separate from other users.' : 'Zotero sign-in needs server setup.';
      controls();
      return;
    }
    const status = await request('status');
    ready = status.modelConfigured || status.grobidConfigured;
    if (status.grobidConfigured) warmGrobid();
    $('connection-status').textContent = ready ? 'Ready to import.' : 'Lookup is ready. Configure GROBID for PDFs or Anthropic for text extraction on the server.';
    if (owner && connection.userId && owner !== connection.userId) {
      collection = null; importId = crypto.randomUUID(); rows.forEach(r => { r.saved = false; });
      $('open-collection').hidden = true; render();
    }
    if (connection.userId) owner = connection.userId;
    $('zotero-status').textContent = connection.connected
      ? `Connected as ${connection.username || connection.userId}. ${connection.writeRequested ? 'Ready for automatic import.' : 'This sign-in is read-only. Sign out (top right) and sign in again to allow saving.'}`
      : connection.configured ? 'Sign in with Zotero (top right) to save into your personal library.' : 'Zotero sign-in needs server setup. You can extract, look up, and download the inventory in the meantime.';
  } catch (error) {
    connection = null;
    $('connection-status').textContent = error.message;
    $('zotero-status').textContent = 'Refresh the connection and sign in with an allowed Zotero account.';
  }
  controls();
}
function link(doi) {
  const a = element('a', doi);
  a.href = `https://doi.org/${encodeURI(doi)}`; a.target = '_blank'; a.rel = 'noopener noreferrer';
  return a;
}
function button(label, onClick, className = 'secondary') {
  const b = element('button', label, className); b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}
function rowElement(row, index) {
  const state = stateOf(row), chosen = row.candidates[row.choice];
  const item = document.createElement('details');
  item.className = `import-row ${state}`;
  item.dataset.importSaved = String(Boolean(row.saved));
  item.open = row.open ?? state === 'review';
  item.addEventListener('toggle', () => { row.open = item.open; });
  const summary = document.createElement('summary');
  const shown = (state === 'ready' || state === 'saved') && chosen ? chosen : null;
  summary.append(
    element('span', STATE_LABEL[state], `import-state ${state}`),
    element('span', String(index + 1), 'import-num'),
    element('span', shown?.title || row.title || row.bibliography || 'Empty reference', 'import-row-title'),
    element('span', shown ? [String(shown.authors || '').split(',')[0], shown.year].filter(Boolean).join(' · ') : '', 'import-row-meta muted'),
  );
  item.append(summary);

  const body = element('div', '', 'import-row-body');
  const original = element('div', '', 'import-original');
  original.append(element('h4', 'In your manuscript'));
  const refLabel = element('label', 'Reference');
  const input = document.createElement('textarea'); input.rows = 3; input.maxLength = 4000; input.value = row.bibliography; refLabel.append(input);
  const doiLabel = element('label', 'DOI (optional)');
  const doi = document.createElement('input'); doi.type = 'text'; doi.maxLength = 300; doi.value = row.doi; doiLabel.append(doi);
  const clear = () => Object.assign(row, { candidates: [], choice: 0, selected: false, lookedUp: false, error: '', skipped: false, open: true });
  input.addEventListener('change', () => { row.bibliography = input.value; clear(); render(); });
  doi.addEventListener('change', () => { row.doi = doi.value; clear(); render(); });
  const actions = element('div', '', 'import-row-actions');
  if (!row.saved) {
    actions.append(button(row.lookedUp ? 'Look up again' : 'Look up', () => runLookup([row])));
    actions.append(button(row.skipped ? 'Unskip' : 'Skip', () => { Object.assign(row, { skipped: !row.skipped, selected: false, open: row.skipped }); render(); }));
  }
  original.append(refLabel, doiLabel, actions);
  if (row.error) original.append(element('p', row.error, 'audit-error'));

  const matches = element('div', '', 'import-matches');
  matches.append(element('h4', row.match === 'doi' ? 'DOI match' : 'Possible matches'));
  if (!row.lookedUp) matches.append(element('p', 'Not looked up yet.', 'muted'));
  else if (!row.candidates.length) matches.append(element('p', 'No match found. Correct the reference or DOI and look it up again, or skip it.', 'muted'));
  row.candidates.forEach((candidate, i) => {
    const isChosen = row.selected && row.choice === i;
    const card = element('div', '', `import-match${isChosen ? ' chosen' : ''}`);
    card.append(element('strong', candidate.title), element('p', `${candidate.authors || 'Authors unavailable'} · ${candidate.year || 'Year unavailable'}`), element('p', candidate.venue || 'Venue unavailable', 'muted'), link(candidate.doi));
    if (!row.saved) card.append(button(isChosen ? 'Accepted' : 'Accept', () => {
      Object.assign(row, isChosen ? { selected: false } : { choice: i, selected: true, skipped: false, open: false });
      render();
    }, isChosen ? 'secondary' : ''));
    matches.append(card);
  });
  body.append(original, matches);
  item.append(body);
  return item;
}
function render() {
  $('review').hidden = false;
  const c = counts();
  const chips = $('filters'); chips.replaceChildren();
  for (const [key, label] of [['attention', 'Needs attention'], ['ready', 'Ready to save'], ['saved', 'Saved'], ['skipped', 'Skipped'], ['all', 'All']]) {
    const n = key === 'all' ? rows.length : c[key];
    if (!n && key !== 'attention' && key !== 'all' && filter !== key) continue;
    const chip = button(`${label} (${n})`, () => { filter = key; render(); });
    chip.setAttribute('aria-pressed', String(filter === key));
    chips.append(chip);
  }
  const root = $('references'); root.replaceChildren();
  let shown = 0;
  for (const [index, row] of rows.entries()) {
    if (filter !== 'all' && GROUP[stateOf(row)] !== filter) continue;
    root.append(rowElement(row, index)); shown++;
  }
  if (!shown) root.append(element('p', filter === 'attention' ? 'Nothing needs your attention.' : 'No references in this view.', 'muted import-empty'));
  controls();
}
async function upload() {
  const file = $('file').files[0];
  if (!file) return { text: $('text').value, consent: $('consent').checked };
  if (file.size > 3 * 1024 * 1024) throw new Error('Choose a file no larger than 3 MB.');
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('Could not read this file.')); reader.readAsDataURL(file);
  });
  return { file: { name: file.name, base64 }, consent: $('consent').checked };
}
async function extract() {
  let extracted = false;
  busy = true; stop = false; controls();
  message(/\.pdf$/i.test($('file').files[0]?.name || '') ? 'Importing references… The PDF extraction service can take up to a minute to start.' : 'Importing references…');
  try {
    const payload = await upload();
    const data = await request('extract', payload);
    reset();
    manuscript = payload.file ? { file: payload.file } : { text: payload.text };
    sourceName = data.filename === 'Pasted manuscript' ? 'Pasted text' : data.filename;
    rows = data.references.map(r => ({ ...r, candidates: [], choice: 0, selected: false, lookedUp: false, saved: false }));
    $('name').value = `${data.filename === 'Pasted manuscript' ? 'Manuscript' : data.filename.replace(/\.[^.]+$/, '')} references`.slice(0, 200);
    $('warnings').textContent = ['Extraction may miss or misread references. Correct entries and add omissions before lookup.', ...(data.warnings || [])].join(' ');
    render(); extracted = true;
  } catch (error) { message(error.message, true); }
  finally { busy = false; controls(); }
  if (extracted && !stop) {
    const completed = await runLookup(rows, true);
    if (completed && connection?.connected && connection?.writeRequested) await save();
    else if (completed) message('References matched. Connect Zotero to finish the import.');
  }
}
// Lookups are paced to the limits Crossref reports (public pool: 1 search/s, one at a time;
// polite pool: 3/s, three at a time) and retried with backoff when the provider answers 429.
const pace = { concurrency: 1, spacingMs: 1100, nextAt: 0 };
const MAX_LOOKUP_RETRIES = 3;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function nextSlot() {
  const now = Date.now(), at = Math.max(now, pace.nextAt);
  pace.nextAt = at + pace.spacingMs;
  if (at > now) await sleep(at - now);
}
function learnPace(limit) {
  const rate = Number(limit?.limit), intervalMs = Number(limit?.intervalMs), concurrency = Number(limit?.concurrency);
  if (rate > 0 && intervalMs > 0) pace.spacingMs = Math.max(100, Math.ceil(intervalMs / rate * 1.1));
  if (concurrency > 0) pace.concurrency = Math.min(Math.floor(concurrency), 4);
}
async function lookupRow(row) {
  for (let attempt = 0; ; attempt++) {
    await nextSlot();
    try { return await request('lookup', { doi: row.doi, bibliography: row.bibliography, title: row.title }); }
    catch (error) {
      if (error.status !== 429 || attempt >= MAX_LOOKUP_RETRIES || stop) throw error;
      const waitMs = Math.min(Math.max(Number(error.retryAfterSeconds) || 2, 1), 60) * 1000 * (attempt + 1);
      pace.concurrency = 1; pace.spacingMs = Math.min(pace.spacingMs * 2, 5000);
      pace.nextAt = Math.max(pace.nextAt, Date.now() + waitMs);
      message(`${error.message} Retrying in ${Math.ceil(waitMs / 1000)} s…`);
    }
  }
}
// Waits with a visible countdown; returns early if the user presses Stop.
async function countdown(ms, text) {
  const end = Date.now() + ms;
  while (!stop && Date.now() < end) {
    message(text(Math.ceil((end - Date.now()) / 1000)));
    await sleep(Math.min(1000, end - Date.now()));
  }
}
// Saves are idempotent (predetermined Zotero keys), so a rate-limited step is simply repeated.
const MAX_SAVE_RETRIES = 5, SAVE_SPACING_MS = 300;
async function withRetry(send) {
  for (let attempt = 0; ; attempt++) {
    try { return await send(); }
    catch (error) {
      if (error.status !== 429 || attempt >= MAX_SAVE_RETRIES || stop) throw error;
      await countdown(Math.min(Math.max(Number(error.retryAfterSeconds) || 2, 1), 120) * 1000, s => `${error.message} Continuing automatically in ${s} s…`);
      if (stop) return null;
    }
  }
}
async function honourBackoff(result) {
  if (result?.backoffSeconds) await countdown(Math.min(result.backoffSeconds, 120) * 1000, s => `Zotero asked for a pause. Continuing automatically in ${s} s…`);
  else await sleep(SAVE_SPACING_MS);
}
async function runLookup(list, automatic = false) {
  if (busy) return;
  busy = true; stop = false; controls();
  const queue = [...list];
  let failure = null, done = 0;
  message('Matching references…');
  const step = async () => {
    const row = queue.shift();
    if (!row) return;
    row.error = ''; row.selected = false; row.candidates = []; row.lookedUp = false;
    try {
      const { rateLimit, derivedDoi, ...data } = await lookupRow(row);
      learnPace(rateLimit);
      Object.assign(row, data, { choice: 0, lookedUp: true });
      if (derivedDoi && !row.doi) row.doi = derivedDoi;
      if (automatic) {
        const choice = automaticMatch(row, row.candidates);
        if (choice >= 0) Object.assign(row, { choice, selected: true });
      }
      if (!failure) { message(`Matching references… ${++done} of ${list.length}`); progress(done, list.length); }
    } catch (error) { row.error = error.message; failure ??= error; }
    render();
  };
  const worker = async () => { while (queue.length && !stop && !failure) await step(); };
  try {
    // The first response reports the provider's limits; later lookups run in parallel within them.
    if (!stop) await step();
    await Promise.all(Array.from({ length: pace.concurrency }, worker));
    if (failure) { message(failure.message, true); return false; }
    message(stop ? 'Import paused. Completed results are retained.' : 'Matching complete. Uncertain references need review.');
    return !stop;
  } finally { busy = false; controls(); }
}
async function save() {
  if (busy) return;
  const pending = selected().filter(r => !r.saved);
  if (!pending.length) { message('No new clear matches to save. Review the remaining references or download RIS.'); return; }
  busy = true; stop = false; controls();
  try {
    message('Saving to Zotero…');
    if (!collection) {
      const created = await withRetry(() => request('collection', { importId, name: $('name').value }));
      if (created) { collection = created; await honourBackoff(created); }
    }
    if (collection) { $('open-collection').href = collection.url; $('open-collection').hidden = false; }
    let savedCount = 0;
    for (const row of pending) {
      if (stop || !collection) break;
      message(`Saving to Zotero… ${savedCount + 1} of ${pending.length}`); progress(savedCount++, pending.length);
      const result = await withRetry(() => request('save', { importId, doi: row.candidates[row.choice].doi }));
      if (!result) break; // Stopped while waiting.
      row.saved = true; row.zotero = result; render();
      await honourBackoff(result);
    }
    message(stop ? 'Save paused. Saved references remain in Zotero; continue with the remaining selections.' : `Saved ${rows.filter(r => r.saved).length} references to Zotero. ${rows.filter(r => !r.saved).length} need review.`);
  } catch (error) { message(`${error.message} Completed saves are retained. Retry the remaining selections.`, true); }
  finally { busy = false; controls(); }
}
$('extract').addEventListener('click', extract);
$('refresh').addEventListener('click', async () => { busy = true; controls(); try { await refresh(); } finally { busy = false; controls(); } });
$('consent').addEventListener('change', controls);
$('file').addEventListener('change', () => {
  const file = $('file').files[0];
  $('text').value = ''; reset();
  $('file-name').textContent = file ? file.name : 'PDF, Word or text · up to 3 MB · include the bibliography';
  if (file) message('File selected. Confirm it is a public/test manuscript, then import.');
});
// Drag and drop onto the upload area.
for (const type of ['dragenter', 'dragover']) $('drop').addEventListener(type, event => { event.preventDefault(); $('drop').classList.add('dragging'); });
for (const type of ['dragleave', 'drop']) $('drop').addEventListener(type, () => $('drop').classList.remove('dragging'));
$('drop').addEventListener('drop', event => {
  event.preventDefault();
  if (!event.dataTransfer?.files?.length) return;
  $('file').files = event.dataTransfer.files;
  $('file').dispatchEvent(new Event('change'));
});
$('change').addEventListener('click', () => { showSetup = true; controls(); });
$('text').addEventListener('input', () => { $('file').value = ''; reset(); });
$('lookup-all').addEventListener('click', () => runLookup(rows.filter(r => !r.saved && !r.lookedUp)));
$('stop').addEventListener('click', () => { stop = true; message('Will stop after the current request completes.'); });
$('save').addEventListener('click', save);
// Hands the same manuscript and the saved Zotero items to the audit, which reads those exact items.
$('check').addEventListener('click', () => {
  offerAuditHandoff({
    manuscript,
    collection: { key: collection.key, name: $('name').value },
    references: rows.filter(r => r.saved && r.zotero?.key).map(r => {
      const candidate = r.candidates[r.choice] || {};
      return { bibliography: r.bibliography, title: r.title || '', sourceTitle: candidate.title || '', doi: candidate.doi || r.doi || '', zoteroKey: r.zotero.key };
    }),
  });
  location.hash = 'audit';
});
$('example').addEventListener('click', () => {
  reset(); $('file').value = ''; $('paste').open = true;
  $('text').value = 'Public sample bibliography\n\nReferences\nWatson, J. D., and Crick, F. H. C. (1953). Molecular Structure of Nucleic Acids: A Structure for Deoxyribose Nucleic Acid. Nature, 171, 737–738. https://doi.org/10.1038/171737a0\n\nShannon, C. E. (1948). A Mathematical Theory of Communication. Bell System Technical Journal, 27(3), 379–423. https://doi.org/10.1002/j.1538-7305.1948.tb01338.x';
  message('Sample loaded. Confirm processing consent, then extract references.');
});
$('add').addEventListener('click', () => {
  rows.push({ id: crypto.randomUUID(), bibliography: '', doi: '', candidates: [], choice: 0, selected: false, open: true });
  filter = 'attention'; $('more').open = false; render();
  $('references').lastElementChild?.querySelector('textarea')?.focus();
});
$('download').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ schemaVersion: 1, references: rows, collection }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = 'citation-import.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
installGrobidWarmup();
function measureTopbar() {
  const topbar = document.querySelector?.('.topbar');
  if (topbar) document.documentElement.style.setProperty('--topbar-h', `${topbar.offsetHeight}px`);
}
measureTopbar();
window.addEventListener('resize', measureTopbar);
// The header sign-in changed: refresh, and finish saving ready references once signed in.
onZoteroChange(async () => {
  if (!loaded || busy) return;
  const wasConnected = Boolean(connection?.connected);
  await refresh();
  if (!wasConnected && connection?.connected && connection.writeRequested && selected().some(r => !r.saved)) await save();
});
window.addEventListener('litgraph-workspace', event => {
  if (event.detail === 'import' && !loaded) { loaded = true; refresh(); }
});
controls();

$('ris').addEventListener('click', () => {
  const blob = new Blob([referencesToRis(rows)], { type: 'application/x-research-info-systems;charset=utf-8' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = 'extracted-references.ris'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
