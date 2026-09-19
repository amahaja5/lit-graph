import { timingSafeEqual } from "node:crypto";
import { ProxyHttpError } from "./errors.js";

export function requireAuditAccess(req) {
  const token = process.env.AUDIT_ACCESS_TOKEN;
  if (token) {
    const provided = String(req.headers.authorization || "").replace(
      /^Bearer /,
      "",
    );
    if (
      Buffer.byteLength(provided) !== Buffer.byteLength(token) ||
      !timingSafeEqual(Buffer.from(provided), Buffer.from(token))
    )
      throw new ProxyHttpError({
        code: "audit_access_required",
        status: 401,
        message:
          "Enter the manuscript-audit access token configured on this server.",
      });
    return;
  }
  const address = req.socket?.remoteAddress;
  const host = String(req.headers.host || "");
  const localAddress = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
    address,
  );
  const localHost = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host);
  let sameOrigin = true;
  if (req.headers.origin) {
    try {
      sameOrigin = new URL(req.headers.origin).host === host;
    } catch {
      sameOrigin = false;
    }
  }
  if (process.env.VERCEL || !localAddress || !localHost || !sameOrigin)
    throw new ProxyHttpError({
      code: "audit_access_required",
      status: 401,
      message:
        "Remote manuscript audits require AUDIT_ACCESS_TOKEN on the server. Local Zotero access is restricted to this computer.",
    });
}
