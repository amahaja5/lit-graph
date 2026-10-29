import { parseObjectBody } from '../http/body.js';
import { requireAppAccess } from '../auth/appAccess.js';
import { createZoteroOAuth } from '../auth/zoteroOAuth.js';
import { createCitationImport } from './citationImport.js';
import { badRequest, ProxyHttpError } from "../shared/errors.js";
import { sendError } from "../http/errors.js";

export async function handleCitationImport(req, res, action, { oauth = createZoteroOAuth(), service } = {}) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    requireAppAccess(req, { oauth });
    if (!['status', 'extract', 'lookup', 'collection', 'save'].includes(action)) throw badRequest('Unknown citation import action.');
    const method = action === 'status' ? 'GET' : 'POST';
    if (req.method !== method) {
      res.setHeader('Allow', method);
      return res.status(405).json({ error: { message: 'Method not allowed' } });
    }
    if (['collection', 'save'].includes(action)) oauth.assertOrigin(req);
    const body = action === 'status' ? undefined : parseObjectBody(req.body);
    const imports = service || createCitationImport({ session: oauth.session(req) });
    res.json(await imports[action](body));
  } catch (error) {
    sendError(res, error instanceof ProxyHttpError ? error : new ProxyHttpError({ code: 'citation_import_error', message: 'Citation import could not complete. Retry this step.', status: 502 }));
  }
}
