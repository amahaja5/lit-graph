import { handleAudit } from '../../lib/audit/handler.js';
import { getAuditService } from '../../lib/setup.js';
export const maxDuration = 300;
export default function handler(req, res) {
  return handleAudit(req, res, req.query.action, { getService: getAuditService });
}
