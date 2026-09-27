const $ = id => document.getElementById(`import-${id}`);
const element = (tag, value, className = '') => { const el = document.createElement(tag); el.textContent = value; el.className = className; return el; };
let rows = [], busy = false, stop = false, ready = false, connection = null, loaded = false;
let importId = crypto.randomUUID(), collection = null, owner = null;
const selected = () => rows.filter(r => r.selected && r.candidates[r.choice]);
function message(value, error = false) { $('status').textContent = value; $('status').classList.toggle('audit-error', error); }
function controls() {
  for (const el of document.querySelectorAll('#citation-import input, #citation-import textarea, #citation-import select, #citation-import button')) el.disabled = busy;
  $('extract').disabled = busy || !ready || !$('consent').checked;
  $('zotero-connect').disabled = busy || !connection?.configured || connection?.connected;
  $('zotero-connect').hidden = Boolean(connection?.connected);
  $('zotero-disconnect').hidden = !connection?.connected;
  $('lookup-all').disabled = busy || !rows.some(r => !r.saved && !r.lookedUp);
  $('add').disabled = busy || rows.length >= 80;
  $('save').disabled = busy || !connection?.connected || !connection?.writeRequested || !selected().some(r => !r.saved);
  $('name').disabled = busy || Boolean(collection);
  $('stop').hidden = !busy || !rows.length;
  $('stop').disabled = false;
  $('download').disabled = !rows.length;
  $('summary').textContent = `${rows.length} references · ${rows.filter(r => r.lookedUp).length} looked up · ${rows.filter(r => r.saved).length} saved`;
  $('save-summary').textContent = `${selected().length} selected · ${rows.filter(r => !r.selected).length} not selected. Compare title, authors, year, and DOI before saving.`;
  $('save').textContent = collection ? 'Save remaining selected matches' : 'Create collection and save selected';
  for (const card of document.querySelectorAll('[data-import-saved="true"]')) for (const el of card.querySelectorAll('input, textarea, select, button')) el.disabled = true;
}
async function request(action, body, namespace = 'import') {
  const headers = { Accept: 'application/json' };
  const token = $('token').value.trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`/api/${namespace}/${action}`, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let data;
  try { data = await response.json(); } catch { throw new Error(`The server returned an unreadable response (${response.status}). Retry this step.`); }
  if (!response.ok) throw new Error(data?.error?.message || `Request failed (${response.status}).`);
  return data;
}
function reset() {
  rows = []; importId = crypto.randomUUID(); collection = null;
  $('review').hidden = true; $('references').replaceChildren(); $('open-collection').hidden = true; controls();
}
async function refresh() {
  ready = false;
  try {
    const status = await request('status');
    ready = status.modelConfigured;
    $('connection-status').textContent = ready ? 'Extraction ready · Anthropic. Metadata lookup ready · Crossref.' : 'Lookup is ready. Extraction needs ANTHROPIC_API_KEY and ANTHROPIC_MODEL on the server.';
    connection = await request('status', undefined, 'zotero');
    if (owner && connection.userId && owner !== connection.userId) {
      collection = null; importId = crypto.randomUUID(); rows.forEach(r => { r.saved = false; });
      $('open-collection').hidden = true; render();
    }
    if (connection.userId) owner = connection.userId;
    $('zotero-status').textContent = connection.connected
      ? `Connected as ${connection.username || connection.userId}. ${connection.writeRequested ? 'Write access was requested; Zotero enforces the permissions you granted.' : 'This connection was created for reading. Disconnect, then reconnect here to request write access.'}`
      : connection.configured ? 'Connect to save into your personal Zotero library.' : 'Zotero sign-in needs server setup. You can extract, look up, and download the inventory in the meantime.';
  } catch (error) {
    connection = null;
    $('connection-status').textContent = error.message;
    $('zotero-status').textContent = 'Check the pilot access token and refresh the connection.';
  }
  controls();
}
function render() {
  $('review').hidden = false;
  const root = $('references'); root.replaceChildren();
  for (const [index, row] of rows.entries()) {
    const card = element('article', '', 'audit-claim import-reference');
    card.dataset.importSaved = String(Boolean(row.saved));
    card.append(element('h4', `Reference ${index + 1}${row.saved ? ' · Saved to Zotero' : ''}`));
    const label = element('label', 'Original reference');
    const input = document.createElement('textarea'); input.rows = 3; input.maxLength = 4000; input.value = row.bibliography; label.append(input); card.append(label);
    const doiLabel = element('label', 'DOI (optional; edit to correct the lookup)');
    const doi = document.createElement('input'); doi.type = 'text'; doi.maxLength = 300; doi.value = row.doi; doiLabel.append(doi); card.append(doiLabel);
    const clear = () => { row.candidates = []; row.choice = 0; row.selected = false; row.lookedUp = false; row.error = ''; };
    input.addEventListener('change', () => { row.bibliography = input.value; clear(); render(); });
    doi.addEventListener('change', () => { row.doi = doi.value; clear(); render(); });
    const lookup = element('button', row.lookedUp ? 'Look up again' : 'Look up this reference', 'secondary'); lookup.type = 'button';
    lookup.addEventListener('click', () => runLookup([row])); card.append(lookup);
    if (row.error) card.append(element('p', row.error, 'audit-error'));
    if (row.lookedUp && !row.candidates.length) card.append(element('p', 'No Crossref match found. Correct the reference or DOI and retry, or leave it unresolved.', 'muted'));
    if (row.candidates.length) {
      const candidateLabel = element('label', row.match === 'doi' ? 'DOI lookup result — confirm it matches the original' : 'Possible matches — choose the correct work');
      const select = document.createElement('select');
      row.candidates.forEach((c, i) => select.add(new Option(`${c.title} (${c.year || 'year unknown'})`, String(i))));
      select.value = String(row.choice); candidateLabel.append(select); card.append(candidateLabel);
      select.addEventListener('change', () => { row.choice = Number(select.value); row.selected = false; render(); });
      const candidate = row.candidates[row.choice];
      const details = element('div', '', 'import-candidate');
      details.append(element('strong', candidate.title), element('p', `${candidate.authors || 'Authors unavailable'} · ${candidate.year || 'Year unavailable'}`), element('p', candidate.venue || 'Venue unavailable', 'muted'));
      const link = element('a', candidate.doi); link.href = `https://doi.org/${encodeURI(candidate.doi)}`; link.target = '_blank'; link.rel = 'noopener noreferrer'; details.append(link); card.append(details);
      const choose = element('label', '', 'import-choice'); const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = row.selected;
      checkbox.addEventListener('change', () => { row.selected = checkbox.checked; controls(); });
      choose.append(checkbox, document.createTextNode('I reviewed this match. Include it in the collection.')); card.append(choose);
    }
    root.append(card);
  }
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
  busy = true; controls(); message('Extracting the reference list. This can take a minute…');
  try {
    const data = await request('extract', await upload());
    reset();
    rows = data.references.map(r => ({ ...r, candidates: [], choice: 0, selected: false, lookedUp: false, saved: false }));
    $('name').value = `${data.filename === 'Pasted manuscript' ? 'Manuscript' : data.filename.replace(/\.[^.]+$/, '')} references`.slice(0, 200);
    $('warnings').textContent = ['AI extraction may miss or misread references. Correct entries and add omissions before lookup.', ...(data.warnings || [])].join(' ');
    render(); message(`Extracted ${rows.length} references. Review the entries, then look them up.`);
  } catch (error) { message(error.message, true); }
  finally { busy = false; controls(); }
}
async function runLookup(list) {
  if (busy) return;
  busy = true; stop = false; controls();
  let done = 0;
  try {
    for (const row of list) {
      if (stop) break;
      message(`Looking up reference ${++done} of ${list.length}…`);
      row.error = ''; row.selected = false; row.candidates = []; row.lookedUp = false;
      try {
        const data = await request('lookup', { doi: row.doi, bibliography: row.bibliography, title: row.title });
        Object.assign(row, data, { choice: 0, lookedUp: true });
      } catch (error) { row.error = error.message; render(); break; }
      render();
    }
    message(stop ? 'Lookup paused. Completed results are retained.' : 'Lookup finished. Review candidates and select the matches to save.');
  } finally { busy = false; controls(); }
}
async function save() {
  if (busy) return;
  const pending = selected().filter(r => !r.saved);
  if (!pending.length) return;
  busy = true; stop = false; controls();
  try {
    collection ||= await request('collection', { importId, name: $('name').value });
    $('open-collection').href = collection.url; $('open-collection').hidden = false;
    for (const [index, row] of pending.entries()) {
      if (stop) break;
      message(`Saving reference ${index + 1} of ${pending.length}…`);
      const result = await request('save', { importId, doi: row.candidates[row.choice].doi });
      row.saved = true; row.zotero = result; render();
    }
    message(stop ? 'Save paused. Saved references remain in Zotero; continue with the remaining selections.' : `Saved ${rows.filter(r => r.saved).length} references. Open the collection in Zotero below.`);
  } catch (error) { message(`${error.message} Completed saves are retained. Retry the remaining selections.`, true); }
  finally { busy = false; controls(); }
}
async function connectZotero() {
  const popup = window.open('about:blank', 'litgraph-zotero', 'popup,width=640,height=760');
  if (!popup) { message('Allow popups and try Connect Zotero again.', true); return; }
  busy = true; controls(); let timer, finished = false;
  const finish = async () => { if (finished) return; finished = true; clearInterval(timer); window.removeEventListener('message', onMessage); busy = false; await refresh(); };
  const onMessage = event => {
    if (event.origin === location.origin && event.source === popup && event.data?.type === 'litgraph-zotero') {
      message(event.data.success ? 'Zotero connected. Review references before saving.' : 'Zotero connection was not completed.', !event.data.success);
      finish();
    }
  };
  window.addEventListener('message', onMessage);
  try {
    const data = await request('start', { write: true }, 'zotero');
    const url = new URL(data.authorizeUrl);
    if (url.origin !== 'https://www.zotero.org' || url.pathname !== '/oauth/authorize') throw new Error('Unexpected authorization address.');
    popup.location.href = url.href;
    const started = Date.now();
    timer = setInterval(() => { if (popup.closed || Date.now() - started > 600000) finish(); }, 1000);
    message('Complete Zotero sign-in and grant library write access in the popup.');
  } catch (error) { popup.close(); message(error.message, true); await finish(); }
}
$('extract').addEventListener('click', extract);
$('refresh').addEventListener('click', async () => { busy = true; controls(); try { await refresh(); } finally { busy = false; controls(); } });
$('consent').addEventListener('change', controls);
$('file').addEventListener('change', () => { $('text').value = ''; reset(); message('File selected. Confirm it is a public/test manuscript, then extract references.'); });
$('text').addEventListener('input', () => { $('file').value = ''; reset(); });
$('lookup-all').addEventListener('click', () => runLookup(rows.filter(r => !r.saved && !r.lookedUp)));
$('stop').addEventListener('click', () => { stop = true; message('Will stop after the current request completes.'); });
$('save').addEventListener('click', save);
$('zotero-connect').addEventListener('click', connectZotero);
$('zotero-disconnect').addEventListener('click', async () => {
  busy = true; controls();
  try { await request('disconnect', {}, 'zotero'); await refresh(); message('Zotero disconnected. Reconnect here to request write access.'); }
  catch (error) { message(error.message, true); }
  finally { busy = false; controls(); }
});
$('example').addEventListener('click', () => {
  reset(); $('file').value = '';
  $('text').value = 'Public sample bibliography\n\nReferences\nWatson, J. D., and Crick, F. H. C. (1953). Molecular Structure of Nucleic Acids: A Structure for Deoxyribose Nucleic Acid. Nature, 171, 737–738. https://doi.org/10.1038/171737a0\n\nShannon, C. E. (1948). A Mathematical Theory of Communication. Bell System Technical Journal, 27(3), 379–423. https://doi.org/10.1002/j.1538-7305.1948.tb01338.x';
  message('Sample loaded. Confirm processing consent, then extract references.');
});
$('add').addEventListener('click', () => { rows.push({ id: crypto.randomUUID(), bibliography: '', doi: '', candidates: [], choice: 0, selected: false }); render(); $('references').lastElementChild.querySelector('textarea').focus(); });
$('download').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ schemaVersion: 1, references: rows, collection }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = 'citation-import.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
window.addEventListener('litgraph-workspace', event => {
  if (event.detail === 'import' && !loaded) { loaded = true; refresh(); }
});
controls();
