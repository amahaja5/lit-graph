import { parse } from 'parse5';

const skip = new Set(['head', 'script', 'style', 'noscript', 'svg', 'nav', 'footer', 'form', 'button', 'template']);
const blocks = new Set(['p', 'div', 'section', 'article', 'main', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'tr', 'br', 'hr']);

// Visit the document once, so nested articles do not duplicate their descendants.
export function extractHtmlCandidates(html, { maxCandidates = 80, maxChars = 80_000 } = {}) {
  if (typeof html !== 'string' || !html.trim()) return { candidates: [], truncated: false };
  const root = parse(html);
  const parts = [];
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (node === '\n') { parts.push('\n'); continue; }
    if (skip.has(node.tagName) || node.attrs?.some(a => a.name === 'hidden' || (a.name === 'aria-hidden' && a.value === 'true'))) continue;
    if (node.nodeName === '#text') parts.push(node.value);
    if (blocks.has(node.tagName)) parts.push('\n');
    const children = node.childNodes || [];
    if (blocks.has(node.tagName)) stack.push('\n');
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
  const candidates = [];
  const seen = new Set();
  let chars = 0, truncated = false;
  for (const part of parts.join('').split('\n')) {
    const text = part.replace(/\s+/g, ' ').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    for (let start = 0; start < text.length; start += 1800) {
      const fragment = text.slice(start, start + 1800);
      if (candidates.length >= maxCandidates || chars + fragment.length > maxChars) { truncated = true; break; }
      candidates.push({ id: `H${candidates.length + 1}`, text: fragment });
      chars += fragment.length;
    }
    if (truncated) break;
  }
  return { candidates, truncated };
}
