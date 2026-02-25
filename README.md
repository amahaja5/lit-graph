# LitGraph: Interactive Literature Snowballing Explorer

## Overview

**LitGraph** is an interactive literature mapping tool for exploring citation and reference neighborhoods around a seed paper using the Semantic Scholar Graph API (S2AG).

Starting from a single paper identifier (Semantic Scholar `paperId`, `DOI:<doi>`, `ARXIV:<id>`, and other S2-supported formats), the app renders a graph node for the seed paper. Clicking an unexplored node triggers a one-step expansion that fetches both:

- papers that **cite** the selected paper (`/citations`)
- papers that the selected paper **references** (`/references`)

The graph is filtered and ranked client-side to keep the visualization readable.

## Status

- `Prototype MVP scaffold implemented`
- Repo includes:
  - a browser frontend (`Vanilla JS + D3`)
  - a lightweight Node/Express proxy for S2 requests
  - tests for normalization/ranking/store logic and proxy behavior
  - `swagger.json` (Semantic Scholar Graph API Swagger reference)
- Verification status in this environment:
  - frontend/unit tests pass
  - proxy tests are implemented but require installing `express` first (`npm install` was blocked here by network restrictions)

## MVP Scope (Phase 1)

### Included

- Seed fetch by paper identifier (`DOI`, `ARXIV`, S2 `paperId`, and other S2-supported IDs)
- One-click, one-level expansion (`citations` + `references`)
- D3 force graph rendering with node state colors (`unexplored`, `loading`, `expanded`, `error`)
- Metadata side panel (title, authors, abstract, venue, citation metrics)
- Review cart (select papers for export)
- JSON export (`schemaVersion: 1`)
- Lightweight backend proxy for Semantic Scholar API requests (allowlisted routes + query params)
- In-memory cache and basic retry/error normalization in the proxy

### Explicitly Excluded (MVP)

- BibTeX export (`citationStyles`) 
- Search/autocomplete/title-match UI
- Multi-hop automatic traversal
- Persistence/accounts/saved sessions
- Advanced clustering/layout modes
- Production observability/hardening

## Phase 2 / Future Enhancements

- BibTeX export via `citationStyles`
- Search/autocomplete/title-match flows (`/paper/search`, `/paper/autocomplete`, etc.)
- Saved sessions / graph persistence
- Pagination controls for large expansions (follow `next` beyond first page)
- Advanced filters (date range, venue, intent, influence)
- Clustering/layout modes for dense graphs

## Architecture & Tech Stack

- **Frontend visualization:** D3.js (`d3-force`, `d3-zoom`, drag)
- **Frontend app logic:** Vanilla JavaScript modules
- **Backend proxy:** Node.js + Express
- **Data source:** Semantic Scholar Graph API (`swagger.json` included)
- **State management:** In-memory `GraphStore` in the browser
- **Styling:** CSS Grid/Flexbox

## Data Layer: S2AG API Integration

The app uses the Semantic Scholar Graph API (S2AG) as the sole literature graph source for the MVP.

### Practical API Note (Auth & Deployment)

The Swagger documentation notes that API keys (when required) must be sent in the `x-api-key` header. A pure client-side prototype can work for local use, but this MVP intentionally uses a backend proxy to:

- avoid exposing API keys in browser code
- add caching for repeated paper fetches
- normalize upstream errors for the UI
- add a basic retry for `429` / `5xx`

### Core S2 Endpoints Used

- `GET /graph/v1/paper/{paper_id}` (seed paper)
- `GET /graph/v1/paper/{paper_id}/citations` (forward snowballing)
- `GET /graph/v1/paper/{paper_id}/references` (backward snowballing)

### Proxy Endpoints (Implemented in this repo)

- `GET /healthz`
- `GET /api/paper/:paperId(*)`
- `GET /api/paper/:paperId(*)/citations`
- `GET /api/paper/:paperId(*)/references`

Note: `:paperId(*)` is intentional so IDs with slashes (for example DOI forms) are supported.

### API Constraints (MVP assumptions)

- API key may be required via `x-api-key`
- Pagination uses `offset` + `next`
- `limit <= 1000` (validated by proxy)
- CORS/rate-limit behavior may vary in practice (proxy mitigates this)
- Large field selections (especially `abstract`/`contexts`) can produce heavy responses

### Field Minimization Strategy

The MVP keeps requests bounded and visualization responsive by:

- fetching **first page only** (`offset=0`, `limit=100`) for citations and references
- ranking/filtering client-side and rendering only top `N=15` per side
- requesting fields needed for graph + sidecar display only
- treating `contexts` as optional metadata (fetched but not fully rendered in the UI)
- surfacing a truncation notice when `next` is present

## Relevance & Sorting Engine

To keep the graph from turning into an unreadable hairball, citation/reference results are normalized into a common candidate shape before sorting and rendering.

Sorting priority (descending unless noted):

1. `isInfluential` (`true` first)
2. nested paper `influentialCitationCount` (`null` treated as `0`)
3. nested paper `citationCount` (`null` treated as `0`)
4. `year` (`null` last)
5. `paperId` (ascending, for deterministic ordering)

After sorting, the app slices to the top `N` results per side (`N=15` by default):

- up to `15` citations
- up to `15` references

## Application State & Memory

The browser uses a centralized `GraphStore` to avoid duplicate nodes/links and guard against repeated fetches.

### Normalized Shapes (Implementation Contract)

```js
// frontend/src/graphStore.js + frontend/src/normalize.js
PaperNode = {
  id, paperId, title, year, abstract, authors,
  citationCount, influentialCitationCount, referenceCount,
  url, venue,
  state,              // "unexplored" | "loading" | "expanded" | "error"
  isRoot,
  isSelected,
  isInReviewCart,
  errorMessage
}

GraphLink = {
  id,                 // `${source}->${target}:${relation}`
  source,
  target,
  relation,           // "citation" | "reference"
  isInfluential,
  contextsCount
}

ExpansionCandidate = {
  relation,
  sourcePaperId,
  targetPaper,
  isInfluential,
  contexts
}
```

### Dedupe and Guard Rules

- `nodes` are keyed by S2 `paperId`
- `links` are deduped by `${source}->${target}:${relation}`
- duplicate clicks while a node is `loading` are ignored
- nodes already `expanded` are selectable but **not refetched** in the MVP
- nodes in `error` state can be retried

## View Layer (D3 Render Cycle)

The D3 graph is a visual projection of `GraphStore` state.

- `d3.forceSimulation` with link / charge / center / collide forces
- Incremental joins keyed by `node.id` and `link.id`
- Zoom/pan and drag enabled
- Node size scales logarithmically with `citationCount`
- Node colors reflect state (`root`, `unexplored`, `loading`, `expanded`, `error`)
- Hover highlights connected edges/nodes
- Simulation reheats on updates

## UI/UX Flow & Exporting

1. User enters a paper identifier and clicks **Load Seed**.
2. The app fetches the seed paper and renders the root node.
3. Clicking an unexplored node selects it and triggers parallel fetches for citations/references.
4. The side panel shows metadata for the selected paper.
5. **Add to Review** toggles the paper in the review cart.
6. **Export JSON** downloads selected papers and related links.

### MVP Export: JSON

The JSON export is versioned (`schemaVersion: 1`) and includes:

- `seedPaperId`
- `selectedPaperIds`
- selected paper metadata
- links touching selected papers
- `exportedAt`

### Phase 2 Export: BibTeX via `citationStyles`

BibTeX export is intentionally deferred. The Swagger spec exposes `citationStyles`, but the MVP does not fetch or transform it yet.

### Error / Empty State UX (Implemented)

- invalid ID / not found
- upstream API errors (`400`, `404`, `429`, `5xx`) via standardized proxy envelope
- empty expansion (no eligible nodes after filtering)
- truncation notice when only the first page is used (`next` present)
- loading state and disabled duplicate expansion while requests are in flight

## Project Structure

```text
frontend/
  index.html
  src/
    main.js
    apiClient.js
    normalize.js
    rank.js
    graphStore.js
    graphRenderer.js
    styles.css
    ui/
      searchBar.js
      sidecar.js
      reviewCart.js
server/
  src/
    index.js
    s2ProxyClient.js
    cache.js
    errors.js
tests/
  frontend/
    normalize.test.js
    rank.test.js
    graphStore.test.js
  server/
    proxy.test.js
README.md
swagger.json
```

## Development Quick Start

### Prerequisites

- Node.js 22+ (tested in this environment with `v22.17.1`)
- npm 10+

### Setup

```bash
npm install
cp .env.example .env
```

Set `S2_API_KEY` in `.env` (or export it in your shell) if your Semantic Scholar usage requires a key.

### Run the App

```bash
npm run dev
```

Default server URL: [http://localhost:3001](http://localhost:3001)

### Run Tests

```bash
npm test
```

If you have not run `npm install`, frontend unit tests can still be run directly (they do not require Express):

```bash
node --test tests/frontend/*.test.js
```

## Testing Coverage (Current)

### Frontend tests

- normalization of S2 payloads
- ranking/slicing determinism
- `GraphStore` merge/dedupe/state transitions/export shape

### Proxy tests (implemented)

- query allowlist enforcement
- standardized upstream error mapping
- caching behavior
- single retry on `429`
- DOI-like IDs with slashes (`:paperId(*)` routing)

## Known Limitations

- Graphs become dense quickly after a few expansions
- First-page-only fetch can omit relevant papers when citation/reference counts are large
- Metadata completeness varies across papers (missing abstracts/authors/venue are common)
- Citation influence and contexts can be sparse or absent
- Review cart and graph state are in-memory only (reset on refresh)
- Expanded nodes are not refetched in the MVP

## Swagger Reference

- `/swagger.json` contains the Semantic Scholar Academic Graph API Swagger used to design this MVP.
- The repo currently focuses on paper graph endpoints only, though the Swagger spec includes author/search/snippet endpoints that are reserved for future work.
