// Signed-in visitors get a direct "Continue" button; everyone else can request access by email.
let signedIn = false;
const json = url => fetch(url, { headers: { Accept: 'application/json' } }).then(r => (r.ok ? r.json() : null)).catch(() => null);

json('/api/zotero/status').then(status => {
  if (!status?.connected) return;
  document.getElementById('open-app').textContent = 'Continue';
  document.getElementById('access-note').textContent = `Signed in as ${status.username || 'your Zotero account'}.`;
  for (const el of document.querySelectorAll('.request-access, #access-fallback')) el.hidden = true;
  signedIn = true;
});

// The address comes from the server, so it never appears in this page's HTML.
json('/api/contact').then(contact => {
  if (!contact?.email || signedIn) return;
  const body = [
    'Hi,', '',
    "I'd like access to Groundwork.", '',
    'Name: ',
    'Zotero username: ',
    'What I would like to use it for: ',
  ].join('\n');
  const href = `mailto:${contact.email}?subject=${encodeURIComponent('Groundwork access request')}&body=${encodeURIComponent(body)}`;
  for (const link of document.querySelectorAll('.request-access')) { link.href = href; link.hidden = false; }
  const address = document.querySelector('.request-access-address');
  address.href = href; address.textContent = contact.email;
  document.getElementById('access-fallback').hidden = false;
});
