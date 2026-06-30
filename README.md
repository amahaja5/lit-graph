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

- Node.js 22+
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
