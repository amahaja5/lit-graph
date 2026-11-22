# Groundwork

Find the papers. Keep the references. Check the claims.

Explore the literature around a paper, collect references in Zotero, and check that a manuscript's citations support its claims. Built on the Semantic Scholar Graph API, Zotero, GROBID and TypeSafe.

## Overview

Groundwork starts from a single seed paper and lets you inspect its citation neighborhood without immediately flooding the graph.

Current interaction model:

1. Enter a supported paper identifier and load the seed paper.
2. Groundwork automatically bootstraps the seed into a denser first-hop neighborhood.
3. Click a node to select it and fetch richer paper details if needed.
4. Review the abstract and metadata in the side panel.
5. Click **Expand Node** to fetch first-page citations and references for that node.
6. Add papers to the review cart, then export them or save them to a Zotero collection.

The graph stays readable by:

- limiting each expansion to the first upstream page (`limit=100`)
- ranking and filtering candidates client-side
- rendering up to `18` citations and `18` references for the seed bootstrap, then up to `15` per side for later manual expansions
- preventing duplicate refetches for already-expanded nodes

## Status

- `Prototype MVP implemented`
- Frontend: Vanilla JS + D3
- Backend:
  - local development: Node + Express proxy
  - deployment: Vercel serverless functions in `/api`
- Current exports:
  - BibTeX (`.bib`)
  - identifier text (`.txt`) with Semantic Scholar / ArXiv / PubMed / NBER identities
- Citation checking:
  - citations extracted by GROBID, each cited source judged by TypeSafe
- Current workspace verification:
  - `node --test tests/frontend/*.test.js` passes
  - `node --test tests/server/*.test.js` passes

## Supported Seed Inputs

Groundwork is identifier-driven. It does not currently support free-text paper search.

Accepted inputs:

- Semantic Scholar `paperId`
- `DOI:<doi>`
- `ARXIV:<id>`
- `PMID:<id>`
- `NBER:w12345`
- `NBER:https://www.nber.org/papers/w12345`

Notes:

- `PMID:` is passed through directly to Semantic Scholar, the same way `DOI:` and `ARXIV:` are.
- `NBER:` is treated as a namespaced identifier and resolved server-side before the Semantic Scholar fetch.
- Bare NBER IDs like `w12345` are not accepted.
- DOI-like identifiers containing slashes are supported by the proxy route.

## MVP Scope

Included in the current app:

- automatic first-hop expansion for the seed paper
- manual one-level expansion via citations + references
- selectable node details with abstract hydration on click
- D3 graph rendering with drag, zoom, hover highlighting, and state colors
- year-oriented layout toggle plus free-force layout
- expansion mode toggle:
  - `Top relevance`
  - `Lesser-known sample`
- review cart
- save the review cart to a Zotero collection
- BibTeX export sorted by `author` or `year`
- identifier text export sorted by `author` or `year`
- Node/Express proxy with allowlisted routes, caching, retry handling, and rate limiting
- Vercel deployment support with same-origin `/api/*` routes

Not implemented:

- free-text search/autocomplete UI
- recursive multi-hop crawling
- persistence or saved sessions
- JSON export
- server-side database/storage

## Architecture

- Frontend visualization: D3 force simulation
- Frontend app logic: vanilla ES modules
- Backend proxy: shared proxy logic, served by Express locally and Vercel functions in deployment
- Upstream API: Semantic Scholar Graph API
- Resolver: namespaced NBER inputs resolved server-side before S2 fetch
- State: in-memory browser `GraphStore`

## API Integration

The app talks to Semantic Scholar through the app's own proxy only. The browser never sends `x-api-key` directly to Semantic Scholar.

### Proxy Routes

- local dev health route: `GET /healthz`
- deployed health route: `GET /api/healthz`
- `GET /api/paper/:paperId(*)`
- `GET /api/paper/:paperId(*)/citations`
- `GET /api/paper/:paperId(*)/references`

The `:paperId(*)` route form is intentional so namespaced IDs with slashes, especially DOI forms, work correctly.

### Semantic Scholar Endpoints Used

- `GET /graph/v1/paper/{paper_id}`
- `GET /graph/v1/paper/{paper_id}/citations`
- `GET /graph/v1/paper/{paper_id}/references`
- `GET /graph/v1/paper/search/match`
  - used only as a fallback during some NBER resolution flows

### NBER Resolution

`NBER:` inputs are resolved server-side in [`lib/papers/paperIdResolver.js`](/Users/amahajan/src/lit-graph/lib/papers/paperIdResolver.js).

Resolution behavior:

- `NBER:w12345` first tries `DOI:10.3386/w12345`
- if that DOI is not indexed by Semantic Scholar, the resolver fetches the NBER paper page
- if a DOI is present on the page, it uses that
- otherwise it falls back to `paper/search/match` on the extracted title

### Request Strategy

Seed/detail fetches request:

- `title,authors,year,abstract,citationCount,influentialCitationCount,referenceCount,url,venue`

Expansion fetches request:

- `isInfluential,contexts,title,authors,year,abstract,citationCount,influentialCitationCount,referenceCount,url,venue`

Export fetches request narrower field sets:

- BibTeX export: `title,authors,year,citationStyles`
- identifier export: `title,paperId,url,externalIds`

### Proxy Behavior

- allowlisted query params only
- `limit` validated to `1..1000`
- in-memory cache with `10 minute` TTL
- one retry for `429` and `5xx`
- standardized error envelope
- global outbound request throttle for Semantic Scholar

Default throttle:

- `S2_MIN_INTERVAL_MS=1100`
- this is meant to stay below a `1 request / second` upstream limit

Important note:

- in local development, browser requests go to `localhost:3001`
- on Vercel, browser requests go to same-origin `/api/*`
- the Semantic Scholar API key is attached only by the proxy on the server-side hop
- GROBID and TypeSafe calls also happen server-side only

## Expansion Modes

### Top relevance

Candidates are ranked by:

1. `isInfluential`
2. `influentialCitationCount`
3. `citationCount`
4. `year` (`null` last)
5. `paperId` (stable tie-break)

### Lesser-known sample

This mode intentionally avoids the dominant head of the ranked list when enough results exist, then samples from the long tail with bias toward:

- lower citation counts
- lower influential citation counts
- non-influential papers

This is meant for exploratory surveying rather than pure relevance expansion.

## Graph and UI Behavior

- Click node: select it and load details if needed
- Expand button: fetch citations + references for the selected node
- Expanded nodes are not refetched in the MVP
- Error-state nodes can be retried
- Review cart is in-memory only

Layout controls:

- `Year Layout: On`
  - older papers left, newer papers right
  - unknown-year papers are placed in a separate upper lane
- `Year Layout: Off`
  - free force layout

## Exports

### BibTeX Export

- uses Semantic Scholar `citationStyles.bibtex` when available
- falls back to generated `@misc` entries when needed
- sort options:
  - `Author` = first-author surname order
  - `Year` = ascending year, unknown years last
- filenames are unique and include a UTC timestamp plus random suffix

### Identifier Text Export

The `.txt` export is tab-separated and includes:

- `semanticScholarUrl`
- `arxiv`
- `pmid`
- `nber`
- `paperId`
- `title`

Identifier rules:

- ArXiv values are taken from `externalIds` when present, or inferred from `ARXIV:` paper IDs
- PubMed values are taken from `externalIds` when present, or inferred from `PMID:` paper IDs
- NBER values are taken from `externalIds` when present, or inferred from DOI patterns like `10.3386/w####`

## Development Quick Start

### Prerequisites

- Node.js 22.13+ (required by PDF.js)
- npm 10+

### Install

```bash
npm install
cp .env.example .env
```

### Environment

`.env.example` currently contains:

```env
S2_API_KEY=
S2_MIN_INTERVAL_MS=1100
PORT=3001
S2_API_BASE_URL=https://api.semanticscholar.org/graph/v1
TYPESAFE_API_KEY=
TYPESAFE_MODEL=jev-1.13.0
TYPESAFE_VERDICT_MIN_CONFIDENCE=0.6
GROBID_API_URL=
EXTRACTION_API_KEY=
```

Recommended setup:

- set `S2_API_KEY` to your approved Semantic Scholar key
- keep `S2_MIN_INTERVAL_MS=1100` unless your approved rate limit changes
- set `TYPESAFE_API_KEY` to enable citation checking
- set `GROBID_API_URL` and `EXTRACTION_API_KEY` to enable reference import and citation extraction

The `.env` loader also accepts quoted values, so both of these work:

```env
S2_API_KEY=abc123
S2_API_KEY="abc123"
TYPESAFE_MODEL="jev-1.13.0"
```

### Run

```bash
npm run dev
```

## Vercel Deployment

Groundwork can be deployed directly on Vercel using the static frontend plus serverless API routes in `/api`.

### Required Vercel Environment Variables

```env
S2_API_KEY=your_semantic_scholar_key
S2_MIN_INTERVAL_MS=1100
S2_API_BASE_URL=https://api.semanticscholar.org/graph/v1
TYPESAFE_API_KEY=your_typesafe_key
GROBID_API_URL=your_grobid_service_url
EXTRACTION_API_KEY=your_grobid_key
```

Notes:

- set `S2_API_KEY` in both Preview and Production if you use both environments
- keep `S2_MIN_INTERVAL_MS=1100` unless Semantic Scholar approves a different rate limit
- the current throttle is instance-local, so serverless scale-out can still exceed a strict shared upstream cap under enough concurrent traffic

### Routing

`/Users/amahajan/src/lit-graph/vercel.json` is configured so:

- `/api/*` is handled by Vercel functions
- all non-API routes fall back to `frontend/index.html`

The SPA rewrite intentionally excludes `/api/*`; otherwise API requests can be served HTML instead of JSON.

### Recommended Post-Deploy Checks

1. Open `/api/healthz` and confirm it returns `{"ok":true}`.
2. Open `/api/paper/ARXIV%3A1706.03762?fields=title` and confirm it returns JSON.
3. Load the main app, search for a seed paper, and expand at least one node.
4. Add papers to the review cart and export them or save them to Zotero.

App URL: [http://localhost:3001](http://localhost:3001)

### Test

```bash
npm test
```

## Project Structure

```text
frontend/
  index.html
  src/
    main.js                 # graph composition and interaction
    apiClient.js
    graph/                  # store, normalization, ranking, rendering, graph UI
    review/                 # review cart, exports, saving the cart to Zotero
    audit/                  # manuscript workflow and report presentation
    citation-import/        # import workflow, matching, RIS
    shared/                 # cross-feature presentation helpers
lib/
  setup.js                  # shared service composition; request-scoped audit sources
  papers/                   # Semantic Scholar client, resolution, HTTP boundary
  audit/                    # GROBID inventory, TypeSafe verdicts, passages, sources, HTTP boundary
  citation-import/          # extraction, matching and Zotero import
  auth/                     # access control and Zotero OAuth
  documents/                # manuscript and PDF parsing
  evidence/                 # TypeSafe passage ranking and claim judgements
  models/                   # TypeSafe client
  http/                     # body parsing, error responses and cancellation
  shared/                   # cache and domain error type
server/src/index.js         # Express composition and local startup
api/                       # Vercel route adapters
tests/                    # frontend and server regression tests
```

Both hosts use the same paper and audit handlers. Feature code imports its owning
module directly; there are no legacy re-export modules. Importing the Express app
does not load `.env`; local startup does. See [architecture notes](ARCHITECTURE.md)
for the refactoring findings and boundary contracts.

## Known Limitations

- first-page-only expansion can miss important papers in large neighborhoods
- graphs still get dense after a few manual expansions
- metadata coverage depends on Semantic Scholar completeness
- `citationStyles.bibtex` is not available for every paper
- identifier export depends on `externalIds` and namespaced-ID parsing, so some rows will be partial
- no persistence across refreshes

## Swagger Reference

[`swagger.json`](/Users/amahajan/src/lit-graph/swagger.json) is the Semantic Scholar Graph API reference used to design this app. The current implementation focuses on paper graph endpoints, plus `paper/search/match` for NBER fallback resolution.

## Additional Docs

[`FEATURES.md`](/Users/amahajan/src/lit-graph/FEATURES.md) maps the implemented Groundwork capabilities into agent-friendly features and integration patterns for paper-reading systems.

## Citation checking

Choose **Check citations** in the workspace navigation. Load an arXiv URL/identifier or upload the manuscript PDF (up to 3 MB, including its bibliography). Two services do the work, both called from the server:

1. **GROBID extracts the inventory.** The PDF goes to the GROBID service in full-text mode with sentence segmentation. Every body sentence containing an in-text citation becomes a cited passage, linked to the bibliography entries its citation markers point to (`<ref type="bibr" target="#b12">`). Bibliography entries keep their raw reference string, title, DOI and arXiv ID. Citations GROBID cannot link, and passages citing more than eight sources, are reported as warnings. You can review and edit the inventory, including adding missed entries, before checking. Scanned PDFs need OCR first.
2. **TypeSafe judges each cited source.** For each source, the app retrieves the PDF (from Zotero, or the public arXiv PDF for arXiv references), selects the most relevant passages (keyword ranking, or TypeSafe ranking when `TYPESAFE_AUDIT_MODE=on`), and asks TypeSafe how each of up to eight passages relates to the claim: `supported`, `partially_supported`, `contradicted` or `insufficient_evidence`, with a confidence. The rubric is the one evaluated in [the TypeSafe experiments](experiments/typesafe/REPORT.md), where it matched 16/16 labelled claim–passage cases.

Per-source verdicts follow the confident judgements (at or above `TYPESAFE_VERDICT_MIN_CONFIDENCE`, default 0.6): supporting passages give **supported**, contradicting ones **contradicted**, both together or a narrower match **partially supported**, and nothing confident **insufficient evidence** (the explanation notes which way the closest passage leaned). The evidence shown for a verdict is the judged passage itself with its PDF page, so quotes cannot be invented; `validateAssessment` still requires every quote to be anchored to a retrieved page. The combined finding is conservative: any unverified source keeps the passage unverified, and conflicting sources cannot combine to "supported".

These are **automated support judgements**, not certification of printed pagination or experimental validity. They come with a confidence and the passage they rest on; read the passage before relying on a verdict. Retrieval selects excerpts rather than every page, so missing evidence stays unverified. Small synthetic experiments motivated the rubric and threshold; calibrate on real manuscripts before relying on them.

The audit runs one passage at a time. Stop retains completed findings; Resume retries failed/unprocessed passages. Download Markdown or JSON, including pending/failed entries and TypeSafe model, rubric and selection diagnostics. Changing the manuscript invalidates the inventory; changing a source or collection invalidates results. State lives in memory and is lost on refresh. The manuscript PDF goes to GROBID and claims with selected source passages go to TypeSafe only when the user starts extraction or checking; originals are not modified or written into Zotero.

### Audit configuration

- `GROBID_API_URL` and `EXTRACTION_API_KEY`: required for extraction (the same wrapper used by citation import; see [deploy/cloud-run](deploy/cloud-run/README.md)).
- `TYPESAFE_API_KEY` (and optionally `TYPESAFE_MODEL`, default `jev-1.13.0`): required for checking. Without these the UI shows setup instructions and disables the actions.
- `TYPESAFE_VERDICT_MIN_CONFIDENCE` (default `0.6`): minimum confidence for a passage judgement to count.
- `TYPESAFE_AUDIT_MODE` (`off` | `shadow` | `on`, default `off`): semantic passage ranking before judging. `shadow` records ranking diagnostics without using them; failures fall back to keyword ranking with a warning.
- Local: `ZOTERO_MODE=local` (default outside Vercel). Keep Zotero running with its local API enabled. The backend reads `http://127.0.0.1:23119/api`, resolves PDF paths through Zotero's file endpoint, and extracts text without editing files. Choose the collection containing the **cited sources**, or search the whole library. This uses the same library as the desktop MCP skill, but is a separate backend API adapter.
- Hosted: `ZOTERO_MODE=oauth`; users click **Sign in with Zotero** at the top right and authorize access on Zotero's website. No manually supplied `ZOTERO_API_KEY` or `ZOTERO_USER_ID` is used. OAuth currently connects personal libraries; the optional `ZOTERO_GROUP_ID` applies to local desktop mode. Stored PDFs must be available through Zotero storage; WebDAV-only or unsynced files may be unavailable.
- `AUDIT_ACCESS_TOKEN`: required for any remote/Vercel access to audit endpoints. Enter it in the app's connection settings. Keep it and provider keys out of client code. This personal/shared-token workflow is not multi-user account isolation. Local unauthenticated access requires a loopback peer, a localhost Host header, and same-origin requests.

Public arXiv PDFs are a fallback when a modern arXiv identifier is available. The server does not fetch arbitrary bibliography URLs. DOI-only references unavailable in Zotero remain unresolved; it does not infer a source from a loosely similar title. Explicit arXiv versions must match the retrieved PDF text. Source PDF text extraction uses PDF.js.

TypeSafe requests use a pinned model, typed response validation, bounded retries, at most two concurrent calls per client, and request deadlines; judgements are cached in memory for five minutes (128 entries) and keyed by model and rubric version. The normal test suite uses mocked TypeSafe and GROBID responses and spends no API credits.

API endpoints (shared Express and Vercel implementation):

- `GET /api/audit/status`: whether extraction (GROBID) and checking (TypeSafe) are configured, plus Zotero collections.
- `POST /api/audit/extract`: `{arxiv}` or `{file:{name,base64}}` (PDF); returns the manuscript hash and citation inventory.
- `POST /api/audit/check`: `{claim,references,collectionKey}`; returns one passage's source evidence and combined finding.

PDF parsing, source retrieval, GROBID and TypeSafe calls run on the server. No manuscript persistence is introduced; source caches are request-scoped so separate Zotero connections never share retrieved private content. Vercel's handler declares a 300-second maximum; effective limits depend on the deployment plan.

### Zotero OAuth setup

Register a browser application at [Zotero OAuth apps](https://www.zotero.org/oauth/apps). For the production domain, set the callback URL to `https://groundwork.avijmahajan.com/api/zotero/callback`. Set these server environment variables in Vercel's Production environment:

```env
ZOTERO_MODE=oauth
ZOTERO_OAUTH_ORIGIN=https://groundwork.avijmahajan.com
ZOTERO_CLIENT_KEY=<registered app client key>
ZOTERO_CLIENT_SECRET=<registered app client secret>
ZOTERO_SESSION_SECRET=<64-character random hex string>
```

Generate the session secret locally with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Keep the same secret across serverless instances and redeployments. Set the client secret and session secret as sensitive environment variables. Do not put credentials in frontend environment variables, source files, screenshots, or logs. Keep `AUDIT_ACCESS_TOKEN`, `TYPESAFE_API_KEY`, `GROBID_API_URL` and `EXTRACTION_API_KEY`; Zotero authorization does not replace the app access gate or provider credentials. Redeploy after changing environment settings.

For testing OAuth locally, register a separate app with callback `http://localhost:3001/api/zotero/callback` and use `ZOTERO_OAUTH_ORIGIN=http://localhost:3001`. Production requires HTTPS. Arbitrary preview URLs will not work with the production registration; use a separate registration and matching stable preview origin. `ZOTERO_MODE=local` still reads the running desktop app without Zotero credentials. Remove old `ZOTERO_API_KEY` and `ZOTERO_USER_ID` settings after migrating; they are no longer read. The legacy `web` mode selects OAuth.

The user enters the audit access token if required, then clicks **Connect Zotero**. Authorization opens in a popup so the manuscript remains in place. The app requests read access to the personal library, without note, write, or group access preselected. Zotero controls the final permissions the user grants. Synced Zotero-storage PDFs are accessible through the existing retrieval path; local-only and WebDAV-only PDFs still need desktop mode. Group-library OAuth selection is not implemented.

This follows [Zotero's OAuth 1.0a key exchange](https://www.zotero.org/support/dev/web_api/v3/oauth): OAuth removes manual key entry, but Zotero still issues a sensitive API credential. The prototype seals it with AES-256-GCM in an HttpOnly, SameSite=Lax cookie (Secure with a `__Host-` prefix on HTTPS). Application JavaScript and AI prompts do not receive the plaintext credential. The server decrypts it per request; there is no credential database or shared global user connection. Cookies and the encryption secret must still be treated as credentials. Local HTTP cookies are only for loopback development.

Connections have an absolute eight-hour lifetime. Temporary OAuth handshakes expire after ten minutes and are bound to the browser, configured origin, and audit access configuration. Callback tokens must match before exchange. Rotating the encryption secret or audit access token invalidates existing local sessions. **Disconnect Zotero** revokes the OAuth-created key through Zotero and clears the cookies; a failed revocation leaves the connection available for retry. Cookie expiry alone does not revoke the indefinitely valid Zotero key. After expiry, users can remove old authorizations from [Zotero API key settings](https://www.zotero.org/settings/keys).

This is browser-session isolation, not project accounts. People using the same browser profile share its connection. Future durable multi-user projects should migrate to authenticated accounts and an encrypted server-side credential store with centralized session revocation. OAuth is independent of `AUDIT_ACCESS_TOKEN`; possessing a Zotero connection does not grant access to the audit service.

Shared Express/Vercel connection routes:

- `GET /api/zotero/status`: setup and connection status, account label, and expiry; no credentials.
- `POST /api/zotero/start`: authenticated, same-origin request; returns the Zotero authorization URL.
- `GET /api/zotero/callback`: validates the temporary browser cookie and exchanges the verified request token.
- `POST /api/zotero/disconnect`: authenticated, same-origin revocation and cookie cleanup.

The callback page removes its query parameters and sends only a success/failure message to its same-origin opener. OAuth responses use `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. If platform request logs include callback URLs, redact their query strings; the app never logs provider response bodies or credential-bearing revocation URLs.

## Zotero sign-in and saving the review cart

Sign in once with **Sign in with Zotero** at the top right; every workspace uses that
session (accounts are still limited by `ZOTERO_ALLOWED_USERS`). Sign-in requests
personal-library write access, which importing and saving need.

In **Explore papers**, the review cart has a **Save to Zotero** control. It creates a
named collection (default "Reading list · <seed paper title>") and adds each cart paper
by its Semantic Scholar ID. Papers with a DOI or arXiv ID use Crossref or DataCite
metadata and reuse existing library items with the same DOI; papers without one get an
item built from Semantic Scholar metadata, marked `Semantic Scholar: <id>` in Extra so
saving again reuses it. Saving again adds only new cart papers; renaming the collection
starts a new one. Rate limits are retried automatically.

## Citation import

Open `/app#import` or choose **Import references**. This is a separate workflow from manuscript claim checking. It accepts a public/test PDF, extracts up to 80 references with GROBID, looks up Crossref metadata, and automatically creates a personal Zotero collection for uniquely matched references; uncertain matches remain available for review.

- The user must confirm the manuscript can be sent to the extraction service. Extraction runs on the GROBID service; no other model is involved.
- Uploads are capped at 3 MB / 100,000 extracted characters. Scans require OCR first. Extracted reference strings must be locatable in the manuscript.
- Lookups send only DOI or reference strings to Crossref. DOI results and the top three bibliographic candidates are shown for review; unique matches with corroborating title and DOI, or title/author/year, are selected automatically. Works outside Crossref remain unresolved. Entries can be corrected, retried, added manually, and downloaded as a JSON inventory.
- Use the existing `AUDIT_ACCESS_TOKEN` for the hosted pilot. Configure the existing Zotero OAuth variables above with a stable HTTPS origin and registered callback. A preview deployment must have its own matching origin/callback configuration; the production registration will not work on an arbitrary preview URL.
- **Connect Zotero for import** requests personal-library write access, without notes/groups access. An existing read-only audit connection must be disconnected and reconnected from this tab. The audit sign-in still defaults to read-only. Zotero enforces the user's final granted permissions.
- Saving reuses exact DOI matches in the library and preserves their metadata and other collections. New collection/item keys are stable within an import, making retries after uncertain responses safe. Conflicting item versions and partial write failures are reported rather than treated as success. Save/lookup run one reference at a time and can stop after the current request.
- No bucket, database, or manuscript persistence is added. Browser state is lost on refresh; records already saved to Zotero remain there. Downloads contain references and lookup results, not the original manuscript. Logs must not be configured to capture request bodies.

Shared local/Vercel API routes:

- `GET /api/import/status`: model configuration status; requires pilot access.
- `POST /api/import/extract`: `{consent:true,text}` or `{consent:true,file:{name,base64}}`.
- `POST /api/import/lookup`: `{doi}` or `{bibliography,title}`; returns candidates.
- `POST /api/import/collection`: `{importId,name}`; creates/reuses this import's collection.
- `POST /api/import/save`: `{importId,doi}`; fetches canonical Crossref metadata and saves/reuses one reference.

The last two routes additionally require an OAuth connection and exact configured origin. The server never accepts an arbitrary upstream URL, API credential, or Zotero item payload from the browser.

Manual verification: sign in with Zotero, upload a public PDF, confirm processing, extract, look up the references, authorize Zotero write access and import. Clear matches save automatically; review any remaining references. Verify the references in Zotero. Retry a partial save to confirm completed records are retained. No live Zotero writes are performed by the automated tests.


### GROBID PDF bibliography extraction

GROBID runs on Cloud Run as a scale-to-zero service (GROBID sidecar + authenticated
wrapper). Setup, deployment and a local docker compose test are in
[`deploy/cloud-run/README.md`](deploy/cloud-run/README.md); the previous Akash SDL is
kept in `deploy/akash/` for reference.

Set server-only `GROBID_API_URL` to the Cloud Run service URL and
`EXTRACTION_API_KEY` to the value of the `extraction-api-key` secret. Configure these
in Vercel Production and Preview as well as local `.env`. The key is stable across
restarts; rotate it by adding a new secret version, redeploying, and updating Vercel.

The app warms the service (via `GROBID_WARM_PATH`, default `/health`) when a
signed-in user loads the app, signs in to Zotero, or opens the Import panel, so the
30–90 s cold start usually finishes before Extract is clicked.

With both values configured, PDF uploads in `/app#import` use
`POST /extract?mode=references` with multipart field `file` and `X-API-Key`.
Only PDFs are accepted. Extraction requires the on-screen consent;
failed GROBID requests are reported as errors; nothing else extracts the PDF.
The existing 3 MB upload and 80-reference limits apply.

Reference lookup uses Crossref, except arXiv references (`arXiv:…`, `arxiv.org/abs/…`,
`10.48550/arXiv.…`), which resolve exactly through DataCite and are saved as Zotero
preprints. Set `CROSSREF_MAILTO` to an operator contact address to join Crossref's
polite pool (3 searches/s, 3 concurrent, versus 1/s and 1). The browser paces and
parallelises lookups to the limits Crossref reports, and retries 429s with backoff.

TEI bibliography entries become structured Zotero item metadata in the inventory.
**Download extracted RIS** exports every displayed reference for Zotero's File →
Import, including entries without DOIs. This is unverified extracted metadata;
review it in Zotero. Edits to DOI and reference text are reflected in RIS.
The existing lookup/select/save flow still uses canonical Crossref metadata and
automatically saves uniquely matched references, leaving uncertain candidates for review. It requires Zotero write authorization,
which is entirely separate from the GROBID key.

Reference strings are taken from `raw_reference` notes when present; otherwise
those strings are reconstructed from parsed fields and marked accordingly.
GROBID can miss or misclassify references, and scanned PDFs require OCR first.

### Zotero app sign-in

Set `APP_AUTH_MODE=zotero` and `ZOTERO_ALLOWED_USERS` to a comma-separated list of
allowed Zotero usernames or numeric user IDs. Empty lists deny all app access.
The existing Zotero OAuth credentials, session secret, and canonical origin are
still required. Configure these values on Vercel and redeploy.

Zotero sign-in replaces the pilot token in the browser. Only sign-in/status and
callback routes are public; import and audit processing require an unexpired,
server-validated cookie belonging to an allowed account. Every processing POST
also requires the configured app origin. The legacy bearer token cannot bypass
this mode. Removing an account from the allowlist blocks its existing sessions
on the next deployment. Unlisted accounts receive no app session and their new
OAuth keys are revoked. Each signed-in user operates on their own personal library.

Sessions expire after eight hours. Sign out revokes the Zotero key and clears the
browser cookies. `AUDIT_ACCESS_TOKEN` can remain server-side during migration;
it is not entered by users and is used only in legacy mode or to invalidate old
cookies when rotated. Local desktop workflows can leave `APP_AUTH_MODE` unset.
