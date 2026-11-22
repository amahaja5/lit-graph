// Public contact address for access requests. A dedicated ACCESS_REQUEST_EMAIL wins; otherwise the
// operator contact already configured for Crossref's polite pool is reused.
const EMAIL = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;

export function contactEmail(env = process.env) {
  for (const value of [env.ACCESS_REQUEST_EMAIL, env.CROSSREF_MAILTO]) {
    const email = String(value || '').trim();
    if (EMAIL.test(email)) return email;
  }
  return '';
}

export function handleContact(req, res, { env = process.env } = {}) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: { message: 'Method not allowed' } }); }
  const email = contactEmail(env);
  res.setHeader('Cache-Control', 'public, max-age=300');
  if (!email) return res.status(404).json({ error: { code: 'no_contact', message: 'No contact address is configured.' } });
  return res.json({ email });
}
