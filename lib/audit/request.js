import { badRequest } from '../shared/errors.js';

export function parseAuditCheckRequest(body) {
  const claim = body?.claim;
  const refs = body?.references;
  if (
    !claim ||
    typeof claim.id !== "string" ||
    typeof claim.text !== "string" ||
    claim.text.length < 10 ||
    claim.text.length > 5000 ||
    !Array.isArray(claim.referenceIds) ||
    !Array.isArray(refs)
  )
    throw badRequest(
      "A cited passage and reference inventory are required.",
    );
  if (refs.length > 80 || claim.referenceIds.length > 8)
    throw badRequest(
      "Audit at most 8 sources per passage and 80 references per inventory.",
    );
  const ids = new Set(refs.map((r) => r?.id));
  if (
    ids.size !== refs.length ||
    claim.referenceIds.some((id) => !ids.has(id))
  )
    throw badRequest("Reference identifiers are missing or duplicated.");
  for (const ref of refs)
    if (
      !ref ||
      typeof ref.id !== "string" ||
      JSON.stringify(ref).length > 8000
    )
      throw badRequest("Invalid reference record.");
  const collectionKey = typeof body.collectionKey === 'string' ? body.collectionKey.trim() : '';
  if (collectionKey && !/^[A-Z0-9]{8}$/.test(collectionKey))
    throw badRequest("Invalid collection key.");
  return { claim, refs, collectionKey };
}
