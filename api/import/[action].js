import { handleCitationImport } from '../../lib/citationImportHandler.js';
export const maxDuration = 300;
export default async function handler(req, res) {
  return handleCitationImport(req, res, req.query.action);
}
