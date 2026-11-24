import { badRequest, ProxyHttpError } from '../shared/errors.js';
import { sendError } from '../http/errors.js';
import { parseObjectBody } from '../http/body.js';
import { requestSignal } from '../http/requestSignal.js';
import { requireAppAccess } from '../auth/appAccess.js';

export async function handleAudit(req, res, action, { oauth, getService }) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    requireAppAccess(req, { oauth });
    if (!['status', 'extract', 'check'].includes(action)) throw badRequest('Unknown audit action.');
    const method = action === 'status' ? 'GET' : 'POST';
    if (req.method !== method) {
      res.setHeader('Allow', method);
      return res.status(405).json({ error: { code: 'method_not_allowed', message: 'Method not allowed' } });
    }
    const body = action === 'status' ? undefined : parseObjectBody(req.body);
    res.json(await getService(req)[action](body, { signal: requestSignal(req, res) }));
  } catch (error) {
    const status = error instanceof ProxyHttpError ? error.status : 500;
    if (status >= 500) {
      // Do not include req.body here: extraction requests contain the entire manuscript PDF.
      console.error('Audit request failed', {
        action,
        method: req?.method,
        path: req?.originalUrl || req?.url,
        code: error?.code || 'internal_error',
        status,
        message: error?.message,
        stack: error?.stack,
      });
    }
    sendError(res, error);
  }
}
