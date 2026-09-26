import { sendError, badRequest } from "../../lib/errors.js";
import { getAuditService } from "../../lib/setup.js";
import { requireAuditAccess } from "../../lib/auditAccess.js";
import { requestSignal } from '../../lib/requestSignal.js';
export const maxDuration = 300;
export default async function handler(req, res) {
  try {
    requireAuditAccess(req);
    const action = req.query.action;
    if (!["status", "extract", "check"].includes(action))
      throw badRequest("Unknown audit action.");
    if (req.method !== (action === "status" ? "GET" : "POST"))
      return res.status(405).json({ error: { message: "Method not allowed" } });
    res.setHeader("Cache-Control", "no-store");
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    res.json(await getAuditService(req)[action](body, { signal: requestSignal(req, res) }));
  } catch (error) {
    sendError(res, error);
  }
}
