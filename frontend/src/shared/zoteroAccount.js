// One Zotero sign-in for the whole app. The header shows it; workspaces subscribe to changes.
// Sign-in always requests library write access, which importing and saving the review cart need.
let status = null, busy = false;
const listeners = new Set();

export function zoteroStatus() { return status; }
export function onZoteroChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function emit() {
  for (const listener of listeners) {
    try { listener(status); } catch (error) { console.error(error); }
  }
}
async function call(action, body) {
  const response = await fetch(`/api/zotero/${action}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message || `Zotero sign-in failed (${response.status}).`);
  return data;
}
export async function refreshZotero() {
  try { status = await call('status'); } catch { status = null; }
  emit();
  return status;
}

// Opens Zotero's authorization page in a popup; resolves true once signed in.
export async function signInToZotero() {
  if (busy) return false;
  const popup = window.open('about:blank', 'litgraph-zotero', 'popup,width=640,height=760');
  if (!popup) throw new Error('Allow pop-ups for this site, then sign in with Zotero again.');
  busy = true; render();
  try {
    const { authorizeUrl } = await call('start', { write: true });
    const url = new URL(authorizeUrl);
    if (url.origin !== 'https://www.zotero.org' || url.pathname !== '/oauth/authorize') throw new Error('Unexpected Zotero sign-in address.');
    popup.location.href = url.href;
    var reason = await new Promise(resolve => {
      const started = Date.now();
      const done = value => { clearInterval(timer); window.removeEventListener('message', onMessage); resolve(value); };
      const onMessage = event => {
        if (event.origin === location.origin && event.source === popup && event.data?.type === 'litgraph-zotero') done(event.data.success ? '' : event.data.reason || 'failed');
      };
      const timer = setInterval(() => { if (popup.closed || Date.now() - started > 600000) done(''); }, 1000);
      window.addEventListener('message', onMessage);
    });
  } catch (error) { popup.close(); throw error; }
  finally { busy = false; }
  await refreshZotero();
  if (reason === 'account_not_allowed') throw new Error('This Zotero account is not allowed to use Groundwork.');
  if (reason) throw new Error('Zotero sign-in was not completed.');
  return Boolean(status?.connected);
}
export async function signOutOfZotero() {
  if (busy) return;
  busy = true; render();
  try { await call('disconnect', {}); }
  finally { busy = false; await refreshZotero(); }
}

// Header control: "Sign in with Zotero", or the signed-in account with Sign out.
let els = null;
function render() {
  if (!els) return;
  const s = status;
  const local = s?.mode === 'local' && !s?.configured;
  els.name.textContent = s?.connected ? (s.username || `Zotero user ${s.userId}`) : local ? 'Zotero Desktop (local)' : '';
  els.name.hidden = !els.name.textContent;
  els.signIn.hidden = Boolean(s?.connected) || local;
  els.signIn.disabled = busy || !s?.configured;
  els.signIn.title = s && !s.configured ? 'Zotero sign-in is not set up on this server.' : '';
  els.signOut.hidden = !s?.connected;
  els.signOut.disabled = busy;
  els.root.title = s?.connected && !s.writeRequested ? 'This sign-in is read-only. Sign out and sign in again to allow saving to Zotero.' : '';
}
export function installAccountControl() {
  const root = document.getElementById('account');
  if (!root) return;
  els = { root, name: document.getElementById('account-name'), signIn: document.getElementById('account-signin'), signOut: document.getElementById('account-signout'), error: document.getElementById('account-error') };
  let errorTimer;
  const report = error => {
    els.error.textContent = error.message; els.error.hidden = false;
    clearTimeout(errorTimer); errorTimer = setTimeout(() => { els.error.hidden = true; }, 10000);
  };
  els.signIn.addEventListener('click', () => signInToZotero().catch(report));
  els.signOut.addEventListener('click', () => signOutOfZotero().catch(report));
  onZoteroChange(render);
  refreshZotero();
}
