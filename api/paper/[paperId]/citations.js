import { getS2Client, getPaperIdResolver } from "../../../lib/setup.js";
import { createPaperHandler } from "../../../lib/papers/handler.js";

export default function handler(req, res) {
  const { paperId, ...query } = req.query || {};
  return createPaperHandler('citations', { client: getS2Client(), resolver: getPaperIdResolver() })(req, res, paperId, query);
}
