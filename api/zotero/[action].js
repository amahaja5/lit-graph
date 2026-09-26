import { createZoteroOAuth } from '../../lib/zoteroOAuth.js';

export default async function handler(req, res) {
  return createZoteroOAuth().handle(req, res, req.query.action);
}
