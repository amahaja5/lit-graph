import { requireAuditAccess } from './auditAccess.js';
import { createZoteroOAuth } from './zoteroOAuth.js';
import { createCitationImport } from './citationImport.js';
import { badRequest, ProxyHttpError, sendError } from './errors.js';

export async function handleCitationImport(req, res, action, { oauth = createZoteroOAuth(), service } = {}) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    requireAuditAccess(req);
    if (!['status', 'extract', 'lookup', 'collection', 'save'].includes(action)) throw badRequest('Unknown citation import action.');
    const method = action === 'status' ? 'GET' : 'POST';
    if (req.method !== method) {
      res.setHeader('Allow', method);
      return res.status(405).json({ error: { message: 'Method not allowed' } });
    }
    if (['collection', 'save'].includes(action)) oauth.assertOrigin(req);
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { throw badRequest('Invalid JSON request.'); }
    }
    const imports = service || createCitationImport({ session: oauth.session(req) });
    res.json(await imports[action](body));
  } catch (error) {
    sendError(res, error instanceof ProxyHttpError ? error : new ProxyHttpError({ code: 'citation_import_error', message: 'Citation import could not complete. Retry this step.', status: 502 }));
  }
}
