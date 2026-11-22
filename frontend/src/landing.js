// Signed-in visitors get a direct "Continue" button instead of the general access note.
fetch('/api/zotero/status', { headers: { Accept: 'application/json' } })
  .then(response => (response.ok ? response.json() : null))
  .then(status => {
    if (!status?.connected) return;
    const who = status.username || 'your Zotero account';
    document.getElementById('open-app').textContent = 'Continue';
    document.getElementById('access-note').textContent = `Signed in as ${who}.`;
  })
  .catch(() => {});
