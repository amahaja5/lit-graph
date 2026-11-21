import test from 'node:test';
import assert from 'node:assert/strict';
import { linkImportedSources, referencesMatch } from '../../frontend/src/audit/importLink.js';

const imported = [
  { bibliography: 'Jonas Gehring, Michael Auli, David Grangier, Denis Yarats, and Yann N. Dauphin. Convolu- tional sequence to sequence learning. arXiv preprint arXiv:1705.03122v2, 2017.', title: 'Convolutional sequence to sequence learning', doi: '10.48550/arxiv.1705.03122', zoteroKey: 'GEHR2345' },
  { bibliography: 'Watson, J. D., and Crick, F. H. C. (1953). Molecular Structure of Nucleic Acids. Nature, 171, 737–738.', title: '', sourceTitle: 'Molecular Structure of Nucleic Acids: A Structure for Deoxyribose Nucleic Acid', doi: '10.1038/171737a0', zoteroKey: 'WATS2345' },
  { bibliography: 'Shannon, C. E. (1948). A Mathematical Theory of Communication. Bell System Technical Journal, 27, 379-423.', title: 'A Mathematical Theory of Communication', doi: '10.1002/j.1538-7305.1948.tb01338.x', zoteroKey: 'SHAN2345' },
];

test('audit references link by DOI, arXiv ID, hyphen-wrapped bibliography text or contained title', () => {
  assert.ok(referencesMatch({ doi: 'https://doi.org/10.1038/171737A0', bibliography: '' }, imported[1]));
  assert.ok(referencesMatch({ arxiv: '1705.03122v2', bibliography: '' }, imported[0]));
  assert.ok(!referencesMatch({ arxiv: '', bibliography: 'Proc. 2017, pp. 1705.03122' }, imported[0]), 'bare numbers in free text are not arXiv IDs');
  assert.ok(referencesMatch({ bibliography: 'Jonas Gehring, Michael Auli, David Grangier, Denis Yarats, and Yann N. Dauphin. Convolutional sequence to sequence learning. 2017.' }, imported[0]));
  assert.ok(referencesMatch({ bibliography: '[12] C. E. Shannon, “A mathematical theory of communication,” Bell Syst. Tech. J., 1948.' }, imported[2]));
  assert.ok(!referencesMatch({ bibliography: '[3] Turing. On computable numbers. 1936.' }, imported[2]));
});

test('only unique one-to-one matches are linked; edited or ambiguous references stay unlinked', () => {
  const refs = [
    { id: 'R1', bibliography: '[1] Shannon. A mathematical theory of communication. 1948.' },
    { id: 'R2', bibliography: '[2] Watson and Crick. Molecular structure of nucleic acids. Nature 1953.', doi: '10.1038/171737a0' },
    { id: 'R3', bibliography: '[3] Turing. On computable numbers. 1936.' },
  ];
  assert.equal(linkImportedSources(refs, imported), 2);
  assert.deepEqual(refs.map(r => r.zoteroKey), ['SHAN2345', 'WATS2345', undefined]);

  const twice = [
    { id: 'R1', bibliography: 'Shannon (1948). A Mathematical Theory of Communication. Part I.' },
    { id: 'R2', bibliography: 'Shannon (1948). A Mathematical Theory of Communication. Part II.' },
  ];
  assert.equal(linkImportedSources(twice, imported), 0, 'one imported item cannot back two references');
  assert.equal(linkImportedSources([{ id: 'R1', bibliography: 'x', doi: '10.1038/171737a0' }], [imported[1], { ...imported[1], zoteroKey: 'DUPL2345' }]), 0);
  assert.equal(linkImportedSources([{ id: 'R1', doi: '10.1038/171737a0', bibliography: '' }], [{ ...imported[1], zoteroKey: undefined }]), 0, 'unsaved imports have no key');
});
