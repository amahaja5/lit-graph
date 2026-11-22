import { sendError } from "../../lib/http/errors.js";
import { parseReviewGenerateRequestBody } from "../../lib/review/reviewRequest.js";
import { getReviewService } from "../../lib/setup.js";
import { requestSignal } from '../../lib/http/requestSignal.js';
import { requireAppAccess } from '../../lib/auth/appAccess.js';

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    // Review drafts run on the server's Anthropic key, so they need the same sign-in as import and audit.
    requireAppAccess(req);
    const request = parseReviewGenerateRequestBody(req.body);
    const payload = await getReviewService().generateReview(request, { signal: requestSignal(req, res) });
    res.json(payload);
  } catch (error) {
    sendError(res, error);
  }
}
