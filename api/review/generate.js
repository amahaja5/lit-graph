import { sendError } from "../../lib/errors.js";
import { parseReviewGenerateRequestBody } from "../../lib/reviewRequest.js";
import { getReviewService } from "../../lib/setup.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const request = parseReviewGenerateRequestBody(req.body);
    const payload = await getReviewService().generateReview(request);
    res.json(payload);
  } catch (error) {
    sendError(res, error);
  }
}
