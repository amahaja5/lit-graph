// RIS is directly importable through Zotero's File → Import command.
export function referencesToRis(references) {
  const clean = value => String(value ?? '').replace(/[\r\n\u0000]+/g, ' ').trim();
  return references.map(ref => {
    const item = ref.zoteroItem || {};
    const lines = [];
    const add = (tag, value) => { if (clean(value)) lines.push(`${tag}  - ${clean(value)}`); };
    add('TY', { journalArticle: 'JOUR', book: 'BOOK', bookSection: 'CHAP' }[item.itemType] || 'GEN');
    add('TI', ref.title || item.title || ref.bibliography);
    for (const a of item.creators || []) add('AU', a.name || [a.lastName, a.firstName].filter(Boolean).join(', '));
    add('PY', item.date); add('JO', item.publicationTitle); add('T2', item.bookTitle);
    add('VL', item.volume); add('IS', item.issue); add('SP', item.pages);
    add('PB', item.publisher); add('CY', item.place); add('DO', ref.doi); add('UR', item.url);
    add('N1', `Unverified extraction. Original reference: ${ref.bibliography}`);
    lines.push('ER  -');
    return lines.join('\r\n');
  }).join('\r\n\r\n') + '\r\n';
}
