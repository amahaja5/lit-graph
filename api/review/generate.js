import { sendError } from "../../lib/http/errors.js";
import { parseReviewGenerateRequestBody } from "../../lib/review/reviewRequest.js";
import { getReviewService } from "../../lib/setup.js";
import { requestSignal } from '../../lib/http/requestSignal.js';

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const request = parseReviewGenerateRequestBody(req.body);
    const payload = await getReviewService().generateReview(request, { signal: requestSignal(req, res) });
    res.json(payload);
  } catch (error) {
    sendError(res, error);
  }
}
