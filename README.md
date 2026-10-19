# LitGraph

Interactive literature snowballing explorer built on the Semantic Scholar Graph API.

## Overview

LitGraph starts from a single seed paper and lets you inspect its citation neighborhood without immediately flooding the graph.

Current interaction model:

1. Enter a supported paper identifier and load the seed paper.
2. LitGraph automatically bootstraps the seed into a denser first-hop neighborhood.
3. Click a node to select it and fetch richer paper details if needed.
4. Review the abstract and metadata in the side panel.
5. Click **Expand Node** to fetch first-page citations and references for that node.
6. Add papers to the review cart, then generate a structured literature synthesis in the right panel.

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
- Current synthesis:
  - structured review draft generated from the review cart via Anthropic
- Current workspace verification:
  - `node --test tests/frontend/*.test.js` passes
  - `node --test tests/server/*.test.js` passes

## Supported Seed Inputs

LitGraph is identifier-driven. It does not currently support free-text paper search.

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
- right-panel review draft generator
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
- `POST /api/review/generate`

The `:paperId(*)` route form is intentional so namespaced IDs with slashes, especially DOI forms, work correctly.

### Semantic Scholar Endpoints Used

- `GET /graph/v1/paper/{paper_id}`
- `GET /graph/v1/paper/{paper_id}/citations`
- `GET /graph/v1/paper/{paper_id}/references`
- `GET /graph/v1/paper/search/match`
  - used only as a fallback during some NBER resolution flows

### NBER Resolution

`NBER:` inputs are resolved server-side in [`server/src/paperIdResolver.js`](/Users/amahajan/src/lit-graph/server/src/paperIdResolver.js).

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
- review generation batch fetch: `title,authors,year,abstract,url,venue,externalIds,isOpenAccess,openAccessPdf,textAvailability`

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
- Anthropic API calls also happen server-side only

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
- Review draft generation is manual, not automatic
- Existing review drafts are marked `stale` when the review cart changes

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

## Review Draft

- uses only the papers currently in the review cart
- generation is enabled only when the cart contains `2..10` papers
- source gathering priority:
  - ArXiv abstract page
  - NBER paper page
  - PubMed landing page
  - DOI landing page
  - upstream paper URL
  - Semantic Scholar URL fallback
- each paper is labeled `R1..Rn`
- every claim in the structured synthesis is required to cite one or more of those `R#` references
- HTML retrieval is best-effort
- if readable HTML cannot be extracted, LitGraph falls back to `abstract_only` coverage and surfaces a warning
- the current output sections are:
  - `Corpus Overview`
  - `Themes`
  - `Methods / Evidence`
  - `Agreements`
  - `Disagreements`
  - `Gaps`
  - `Suggested Next Reads`
  - `Evidence Limitations`

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
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=
REVIEW_MAX_PAPERS=10
REVIEW_MAX_SOURCE_CHARS_PER_PAPER=12000
```

Recommended setup:

- set `S2_API_KEY` to your approved Semantic Scholar key
- keep `S2_MIN_INTERVAL_MS=1100` unless your approved rate limit changes
- set `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` to enable review generation
- keep `REVIEW_MAX_PAPERS=10` unless you intentionally want larger prompts and higher cost

The `.env` loader also accepts quoted values, so both of these work:

```env
S2_API_KEY=abc123
S2_API_KEY="abc123"
ANTHROPIC_MODEL="your-opus-model-name"
```

### Run

```bash
npm run dev
```

## Vercel Deployment

LitGraph can be deployed directly on Vercel using the static frontend plus serverless API routes in `/api`.

### Required Vercel Environment Variables

```env
S2_API_KEY=your_semantic_scholar_key
S2_MIN_INTERVAL_MS=1100
S2_API_BASE_URL=https://api.semanticscholar.org/graph/v1
ANTHROPIC_API_KEY=your_anthropic_key
ANTHROPIC_MODEL=your_opus_model_name
REVIEW_MAX_PAPERS=10
REVIEW_MAX_SOURCE_CHARS_PER_PAPER=12000
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
4. Add `2..10` papers to the review cart and generate a review draft.

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
    apiClient.js
    bibtex.js
    graphRenderer.js
    graphStore.js
    identifiers.js
    main.js
    normalize.js
    rank.js
    styles.css
    ui/
      reviewCart.js
      searchBar.js
      sidecar.js
server/
  src/
    cache.js
    errors.js
    index.js
    paperIdResolver.js
    s2ProxyClient.js
tests/
  frontend/
    bibtex.test.js
    graphStore.test.js
    identifiers.test.js
    normalize.test.js
    rank.test.js
  server/
    paperIdResolver.test.js
    proxy.test.js
    s2ProxyClient.test.js
.env.example
FEATURES.md
package.json
README.md
swagger.json
```

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

[`FEATURES.md`](/Users/amahajan/src/lit-graph/FEATURES.md) maps the implemented LitGraph capabilities into agent-friendly features and integration patterns for paper-reading systems.

## Optional TypeSafe evidence checks

TypeSafe can judge which HTML text is useful scholarly evidence and rank PDF excerpts by their relevance to a manuscript claim. Anthropic still generates reviews and audit assessments. Source identity, exact quotations, and PDF page validation remain deterministic.

Set these server environment variables (locally in `.env` or the launching shell; on Vercel in project settings):

```env
TYPESAFE_API_KEY=your_key
TYPESAFE_MODEL=jev-1.13.0
TYPESAFE_REVIEW_MODE=shadow
TYPESAFE_AUDIT_MODE=shadow
TYPESAFE_REVIEW_MIN_CONFIDENCE=0.9
```

Both modes default to `off`. `shadow` runs judgments and records diagnostics while retaining the existing selected evidence; `on` applies the judgments. Use `on` for an explicit pilot after reviewing shadow results. Restart the server after changing configuration. The 0.9 HTML confidence threshold is a provisional conservative default, **not calibrated on a representative manuscript corpus**. Small synthetic experiments motivated this integration; real-document evaluation remains necessary before broad rollout.

In review `on` mode, a standard HTML parser retains multiple content regions and short passages, then TypeSafe selects useful text blocks. Rejected or uncertain blocks are omitted. Missing credentials or service failure falls back to available abstracts with a warning. In audit `on` mode, TypeSafe scores supporting and contradicting evidence alike; failure uses the original keyword selector with a warning. Audit source matching, quotation validation, and combined-source assessment are unchanged in responsibility.

Requests use a pinned model, typed response validation, bounded retries, at most two concurrent calls per shared client, and a ten-second TypeSafe budget starting at the first judgment in each operation. API judgments are cached in memory for five minutes, up to 128 entries. HTML fetches are capped at 2 MB; candidate extraction at 80 blocks / 80,000 characters. Large PDFs use at most 96 candidates combining lexical matches and page coverage, with a coverage warning; this shortlist does not guarantee complete retrieval. Model/rubric/configuration changes invalidate relevant cache keys. Transient HTML failures are not cached as successful evidence or reviews.

Enabling either `shadow` or `on` sends candidate source text and relevant paper metadata/claims to TypeSafe. Keys stay on the server. Review reference `quality` and audit source `selection` fields expose model/rubric versions, scores, selection status, and request usage; audit JSON exports retain these fields and Markdown includes selection/fallback notices. `/api/audit/status` reports TypeSafe readiness separately from Anthropic readiness. Scores are judgments, not guarantees of correctness. Client disconnects cancel pending TypeSafe calls; an already dispatched Anthropic request may still finish.

See [experiment findings](experiments/typesafe/REPORT.md) and the [workflow plan](experiments/typesafe/WORKFLOW_PLAN.md). Run the explicit synthetic live smoke check with `node experiments/typesafe/production-smoke.mjs` after exporting the key. The normal test suite uses mocked TypeSafe responses and does not spend API credits.

## Manuscript citation audit

Choose **Check a manuscript** in the workspace navigation. Load an arXiv URL/identifier, upload a PDF, DOCX, TXT, or Markdown file (up to 3 MB), or paste up to 100,000 characters including the bibliography. The app extracts citation-bearing passages and reference mappings, lets you review/edit source titles, identifiers, passages, and citation mappings (including adding missed entries), and checks the cited claims against retrieved PDFs. A passage can cite up to eight sources. Larger jobs must be divided into sections with their bibliography (80 references / 150 passages per inventory).

Each passage receives per-source findings and a combined assessment: supported, partially supported, contradicted, or insufficient evidence. Positive/negative support findings require an exact quoted passage anchored to a retrieved PDF page. The report preserves source SHA-256, retrieval route, version, Zotero keys, and reviewed PDF page indices. These are **AI-assisted support assessments**, not a certification of printed pagination or experimental validity. Retrieval selects relevant excerpts rather than assessing every page; missing evidence stays unverified. Inventory extraction may miss citations and should be reviewed. Source PDFs without readable text need OCR outside this web workflow.

The audit runs one passage at a time. Stop retains completed findings; Resume retries failed/unprocessed passages. Download Markdown or JSON, including pending/failed entries. Editing manuscript text invalidates the inventory; changing a source or collection invalidates results. State lives in memory and is lost on refresh. Uploaded manuscripts and selected source excerpts are sent to Anthropic only when the user initiates extraction/checking; originals are not modified or written into Zotero. The web workflow exports findings and suggested revisions, not an automatically rewritten manuscript.

### Audit configuration

- `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL`: required for extraction and assessment, reused from review generation. Without them the UI shows setup instructions and disables those actions.
- Local: `ZOTERO_MODE=local` (default outside Vercel). Keep Zotero running with its local API enabled. The backend reads `http://127.0.0.1:23119/api`, resolves PDF paths through Zotero's file endpoint, and extracts text without editing files. Choose the collection containing the **cited sources**, or search the whole library. This uses the same library as the desktop MCP skill, but is a separate backend API adapter.
- Hosted: `ZOTERO_MODE=oauth`; users click **Connect Zotero** and authorize access on Zotero's website. No manually supplied `ZOTERO_API_KEY` or `ZOTERO_USER_ID` is used. OAuth currently connects personal libraries; the optional `ZOTERO_GROUP_ID` applies to local desktop mode. Stored PDFs must be available through Zotero storage; WebDAV-only or unsynced files may be unavailable.
- `AUDIT_ACCESS_TOKEN`: required for any remote/Vercel access to audit endpoints. Enter it in the app's connection settings. Keep it and provider keys out of client code. This personal/shared-token workflow is not multi-user account isolation. Local unauthenticated access requires a loopback peer, a localhost Host header, and same-origin requests.

Public arXiv PDFs are a fallback when a modern arXiv identifier is available. The server does not fetch arbitrary bibliography URLs. DOI-only references unavailable in Zotero remain unresolved; it does not infer a source from a loosely similar title. Explicit arXiv versions must match the retrieved PDF text. Native PDF extraction uses PDF.js; DOCX text extraction uses Mammoth. The desktop citation-verifier skill remains the workflow for OCR/visual printed-page checks and corrected Word copies.

API endpoints (shared Express and Vercel implementation):

- `GET /api/audit/status`: model configuration status and Zotero collections.
- `POST /api/audit/extract`: `{text}`, `{arxiv}`, or `{file:{name,base64}}`; returns manuscript hash and citation inventory.
- `POST /api/audit/check`: `{claim,references,collectionKey}`; returns one passage's source evidence and combined finding.

PDF/DOCX parsing, source retrieval, and model calls run on the server. No manuscript persistence is introduced; source caches are now request-scoped so separate Zotero connections never share retrieved private content. Keep deployment behind the access token and configure function duration/memory for PDF parsing. Vercel's handler declares a 300-second maximum; effective limits depend on the deployment plan. Stop prevents subsequent passages; an already-dispatched provider call may still finish on the server.

### Zotero OAuth setup

Register a browser application at [Zotero OAuth apps](https://www.zotero.org/oauth/apps). For the production domain, set the callback URL to `https://lit-graph.avijmahajan.com/api/zotero/callback`. Set these server environment variables in Vercel's Production environment:

```env
ZOTERO_MODE=oauth
ZOTERO_OAUTH_ORIGIN=https://lit-graph.avijmahajan.com
ZOTERO_CLIENT_KEY=<registered app client key>
ZOTERO_CLIENT_SECRET=<registered app client secret>
ZOTERO_SESSION_SECRET=<64-character random hex string>
```

Generate the session secret locally with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Keep the same secret across serverless instances and redeployments. Set the client secret and session secret as sensitive environment variables. Do not put credentials in frontend environment variables, source files, screenshots, or logs. Keep `AUDIT_ACCESS_TOKEN`, `ANTHROPIC_API_KEY`, and `ANTHROPIC_MODEL`; Zotero authorization does not replace the app access gate or model credentials. Redeploy after changing environment settings.

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

## Citation import pilot

Open `/#import` or choose **Import citations · Pilot**. This is a separate workflow from manuscript claim checking. It accepts public/test PDF, DOCX, TXT, Markdown, or pasted text, extracts up to 80 references, looks up Crossref metadata, and automatically creates a personal Zotero collection for uniquely matched references; uncertain matches remain available for review.

- The tester must confirm the manuscript can be sent to the configured extraction provider. This pilot reuses `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL`; it does not use Baseten or local inference.
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

Pilot verification: connect with the access token, load the sample bibliography, confirm processing, extract, look up both references, authorize Zotero write access and import. Clear matches save automatically; review any remaining references. Verify both references in Zotero. Retry a partial save to confirm completed records are retained. No live Zotero writes are performed by the automated tests.


### GROBID PDF bibliography extraction

Set server-only `GROBID_API_URL` to the extraction wrapper base URL and
`EXTRACTION_API_KEY` to its current key. Configure these in Vercel Production and
Preview as well as local `.env`. Keep the key secret; update it when the wrapper
restarts and rotates it, then redeploy the app to pick up the changed environment.

With both values configured, PDF uploads in `/#import` use
`POST /extract?mode=references` with multipart field `file` and `X-API-Key`.
Non-PDF inputs still use Anthropic. Extraction requires the on-screen consent;
failed GROBID requests are reported without silently sending the PDF to Anthropic.
The existing 3 MB upload and 80-reference limits apply.

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
