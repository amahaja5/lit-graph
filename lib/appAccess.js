import { requireAuditAccess } from './auditAccess.js';
import { createZoteroOAuth } from './zoteroOAuth.js';
import { ProxyHttpError } from './errors.js';

export function requireAppAccess(req, { env = process.env, oauth } = {}) {
  if (env.APP_AUTH_MODE !== 'zotero') return requireAuditAccess(req);
  const auth = oauth || createZoteroOAuth({ env });
  if (!auth.session(req)) throw new ProxyHttpError({
    code: 'app_signin_required', status: 401,
    message: 'Sign in with an allowed Zotero account to use this app.',
  });
  // Browser cookies must not authorize cross-origin processing or library writes.
  if (!['GET', 'HEAD'].includes(req.method)) auth.assertOrigin(req);
}
