const names = new Set(['explore', 'audit', 'import']);
function showWorkspace() {
  const name = names.has(location.hash.slice(1)) ? location.hash.slice(1) : 'explore';
  document.body.classList.toggle('audit-active', name !== 'explore');
  document.getElementById('manuscript-audit').hidden = name !== 'audit';
  document.getElementById('citation-import').hidden = name !== 'import';
  document.getElementById('search-form').hidden = name !== 'explore';
  for (const b of document.querySelectorAll('[data-workspace]')) b.setAttribute('aria-pressed', String(b.dataset.workspace === name));
  window.dispatchEvent(new Event('resize'));
  window.dispatchEvent(new CustomEvent('litgraph-workspace', { detail: name }));
}
for (const b of document.querySelectorAll('[data-workspace]')) b.addEventListener('click', () => {
  if (location.hash === `#${b.dataset.workspace}`) showWorkspace();
  else location.hash = b.dataset.workspace;
});
window.addEventListener('hashchange', showWorkspace);
showWorkspace();
