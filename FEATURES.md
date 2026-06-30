# LitGraph Features

This document translates the current LitGraph implementation into agent-friendly capabilities. The goal is to make it easy to lift the features in this repo into a larger framework for reading, surveying, triaging, and organizing papers.

## Purpose

LitGraph is already doing several useful pieces of paper-reading infrastructure:

- identifier normalization and seed resolution
- metadata retrieval
- citation/reference neighborhood expansion
- ranked or exploratory candidate selection
- lightweight curation via review cart
- structured literature synthesis from a curated cart
- export into formats useful for downstream reading workflows

An agent framework does not need to reuse the UI to benefit from these pieces. The cleaner reuse path is:

1. treat the local proxy as the retrieval boundary
2. treat the normalization/ranking/export modules as reusable application logic
3. optionally keep `GraphStore` as the in-memory session state for an agent run

## Feature Inventory

### 1. Seed Paper Resolution

What it does:

- accepts namespaced literature identifiers and resolves them to something Semantic Scholar can fetch

Supported inputs today:

- Semantic Scholar `paperId`
- `DOI:<doi>`
- `ARXIV:<id>`
- `NBER:w12345`
- `NBER:https://www.nber.org/papers/w12345`

Why it matters for agents:

- agents need a canonical entry point before doing retrieval or graph expansion
- this lets an agent accept mixed human input without forcing the user to manually normalize IDs first

Implementation:

- resolver: [`server/src/paperIdResolver.js`](/Users/amahajan/src/lit-graph/server/src/paperIdResolver.js)
- entry route: [`server/src/index.js`](/Users/amahajan/src/lit-graph/server/src/index.js)

Current behavior:

- `NBER:w####` first tries `DOI:10.3386/w####`
- if that DOI is not indexed in Semantic Scholar, the resolver fetches the NBER page
- if needed, it falls back to Semantic Scholar title match

Agent framing:

- use this as `resolve_seed(input) -> canonical_paper_id`

### 2. Paper Metadata Fetch

What it does:

- fetches a paper record with enough metadata for reading triage and graph expansion

Fields requested:

- `title`
- `authors`
- `year`
- `abstract`
- `citationCount`
- `influentialCitationCount`
- `referenceCount`
- `url`
- `venue`

Why it matters for agents:

- enough for ranking, triage, summary prompts, reading queue creation, and export

Implementation:

- client field set: [`frontend/src/apiClient.js`](/Users/amahajan/src/lit-graph/frontend/src/apiClient.js)
- normalization: [`frontend/src/normalize.js`](/Users/amahajan/src/lit-graph/frontend/src/normalize.js)

Agent framing:

- use this as `fetch_paper(paper_id) -> PaperNode`

### 3. On-Demand Abstract Hydration

What it does:

- when a selected paper node lacks a loaded abstract, LitGraph fetches details lazily instead of front-loading every request

Why it matters for agents:

- this pattern is good for staged reading pipelines
- an agent can fetch cheap metadata first, then hydrate abstracts only for shortlisted papers

Implementation:

- UI orchestration: [`frontend/src/main.js`](/Users/amahajan/src/lit-graph/frontend/src/main.js)

Agent framing:

- use this as `hydrate_details_if_needed(paper_id)`

### 4. One-Hop Citation and Reference Expansion

What it does:

- expands a selected paper using both:
  - papers that cite it
  - papers it references

Why it matters for agents:

- this is the core snowballing primitive for literature review
- it supports both backward and forward exploration in a single step

Implementation:

- proxy routes: [`server/src/index.js`](/Users/amahajan/src/lit-graph/server/src/index.js)
- field selection: [`frontend/src/apiClient.js`](/Users/amahajan/src/lit-graph/frontend/src/apiClient.js)
- normalization: [`frontend/src/normalize.js`](/Users/amahajan/src/lit-graph/frontend/src/normalize.js)

Important current constraints:

- first page only
- upstream `limit=100`
- rendering/selection layer keeps at most `15` citations and `15` references
- nodes already marked `expanded` are not refetched in the MVP

Agent framing:

- use this as `expand_paper(paper_id, mode) -> {citations, references, candidates}`

### 5. Candidate Normalization

What it does:

- turns citation and reference responses into a common shape so downstream code does not care whether a paper came from `/citations` or `/references`

Shapes already implemented:

- `PaperNode`
- `GraphLink`
- `ExpansionCandidate`

Why it matters for agents:

- this is the point where heterogeneous API responses become a reusable graph representation
- the same normalized objects can feed ranking, summarization, memory, and export

Implementation:

- [`frontend/src/normalize.js`](/Users/amahajan/src/lit-graph/frontend/src/normalize.js)
- [`frontend/src/graphStore.js`](/Users/amahajan/src/lit-graph/frontend/src/graphStore.js)

Agent framing:

- use this as the internal literature-graph schema for a single agent session

### 6. Relevance Ranking

What it does:

- orders expansion candidates by a stable relevance heuristic

Current ranking priority:

1. `isInfluential`
2. `influentialCitationCount`
3. `citationCount`
4. `year` with null last
5. `paperId` as deterministic tie-break

Why it matters for agents:

- good default for finding central or canonical papers quickly

Implementation:

- [`frontend/src/rank.js`](/Users/amahajan/src/lit-graph/frontend/src/rank.js)

Agent framing:

- use this as `rank_candidates(candidates) -> ordered_candidates`

### 7. Lesser-Known Sampling

What it does:

- offers a non-canonical exploration mode that avoids the most dominant head of the candidate list and samples the long tail with bias toward less cited and less influential papers

Why it matters for agents:

- this is useful for novelty search, under-cited paper discovery, and avoiding “review by popularity only”

Implementation:

- [`frontend/src/rank.js`](/Users/amahajan/src/lit-graph/frontend/src/rank.js)

Agent framing:

- use this as `sample_lesser_known(candidates, n)`

Good agent use cases:

- “find overlooked related work”
- “find non-standard references”
- “surface long-tail papers before recommending a reading plan”

### 8. Session Graph State

What it does:

- stores nodes, links, selection state, review cart membership, and expansion notices in one in-memory graph session

Why it matters for agents:

- this is already close to an agent memory object for one literature session
- it keeps graph dedupe logic, state transitions, and curated selections together

Implementation:

- [`frontend/src/graphStore.js`](/Users/amahajan/src/lit-graph/frontend/src/graphStore.js)

Capabilities already present:

- root initialization
- node upsert/merge
- link dedupe
- selected node tracking
- review cart tracking
- expansion notice tracking

Agent framing:

- use `GraphStore` as ephemeral session memory
- or mirror its schema in a durable agent memory layer

### 9. Review Cart Curation

What it does:

- lets the current session mark papers as worth keeping

Why it matters for agents:

- this is the current curation primitive
- an agent can use the same concept as “candidate reading list”, “shortlist”, or “papers to summarize next”

Implementation:

- selection state: [`frontend/src/graphStore.js`](/Users/amahajan/src/lit-graph/frontend/src/graphStore.js)
- review UI wiring: [`frontend/src/ui/reviewCart.js`](/Users/amahajan/src/lit-graph/frontend/src/ui/reviewCart.js)

Agent framing:

- use this as `select_for_review(paper_id)`

### 10. Structured Review Draft Generation

What it does:

- turns the current review cart into a structured literature synthesis grounded only in the selected papers

Current behavior:

- generation is manual
- requires `2..10` papers in the cart
- each selected paper is labeled `R1..Rn`
- each returned claim cites one or more of those `R#` labels
- HTML ingestion is best-effort and falls back to abstract-only coverage when needed

Why it matters for agents:

- this is the first end-to-end synthesis primitive in the repo
- it turns a curated reading set into a review artifact with explicit provenance
- it separates discovery from synthesis while keeping citations auditable

Implementation:

- shared review service: [`lib/reviewService.js`](/Users/amahajan/src/lit-graph/lib/reviewService.js)
- evidence extraction: [`lib/reviewEvidence.js`](/Users/amahajan/src/lit-graph/lib/reviewEvidence.js)
- model client: [`lib/anthropicClient.js`](/Users/amahajan/src/lit-graph/lib/anthropicClient.js)
- UI wiring: [`frontend/src/ui/reviewDraft.js`](/Users/amahajan/src/lit-graph/frontend/src/ui/reviewDraft.js)

Agent framing:

- use this as `generate_review(paper_ids) -> structured_synthesis`
- the returned artifact is suitable for note generation, downstream editing, or reading-plan derivation

### 11. BibTeX Export

What it does:

- exports the review cart as `.bib`
- uses Semantic Scholar `citationStyles.bibtex` when available
- falls back to generated `@misc` entries when missing

Sort options:

- first-author surname
- year ascending

Why it matters for agents:

- lets an agent hand off curated reading lists into human writing workflows and reference managers

Implementation:

- export logic: [`frontend/src/bibtex.js`](/Users/amahajan/src/lit-graph/frontend/src/bibtex.js)
- orchestration: [`frontend/src/main.js`](/Users/amahajan/src/lit-graph/frontend/src/main.js)

Agent framing:

- use this as `export_bibtex(selected_papers, sort)`

### 12. Identity Export

What it does:

- exports the review cart as a tab-separated text file with:
  - Semantic Scholar URL
  - ArXiv ID
  - NBER ID
  - paperId
  - title

Why it matters for agents:

- this is the cleanest bridge from the graph app into another agent system
- it provides canonical paper identities for downstream reading, PDF retrieval, citation lookup, or note linking

Implementation:

- identifier extraction: [`frontend/src/identifiers.js`](/Users/amahajan/src/lit-graph/frontend/src/identifiers.js)
- orchestration: [`frontend/src/main.js`](/Users/amahajan/src/lit-graph/frontend/src/main.js)

Agent framing:

- use this as `export_identity_table(selected_papers, sort)`

### 13. Rate-Limited Retrieval Boundary

What it does:

- keeps Semantic Scholar traffic behind a local proxy with:
  - cache
  - retry
  - normalized errors
  - outbound throttling

Why it matters for agents:

- an agent framework needs a safe network boundary for shared API limits
- this repo already has one

Implementation:

- proxy app: [`server/src/index.js`](/Users/amahajan/src/lit-graph/server/src/index.js)
- client/throttle: [`server/src/s2ProxyClient.js`](/Users/amahajan/src/lit-graph/server/src/s2ProxyClient.js)

Agent framing:

- use the proxy as the only Semantic Scholar access layer for local agents

## Agent Integration Patterns

### Pattern 1: Paper Triage Agent

Flow:

1. Resolve seed identifier.
2. Fetch seed metadata.
3. Expand one hop.
4. Rank candidates by relevance.
5. Summarize top candidates.
6. Add selected candidates to review cart.
7. Export BibTeX or identity text for handoff.

Best for:

- classic literature review bootstrapping

### Pattern 2: Curiosity / Discovery Agent

Flow:

1. Resolve seed.
2. Expand one hop in `lesser_known_sample` mode.
3. Score papers for novelty, diversity, or methodological difference.
4. Produce a shortlist of overlooked papers.

Best for:

- finding non-obvious related work

### Pattern 3: Reading Queue Builder

Flow:

1. Resolve multiple seeds over multiple sessions.
2. Hydrate details on shortlisted nodes only.
3. Use review cart as the final queue.
4. Export BibTeX and identity text.

Best for:

- human-in-the-loop reading pipelines

### Pattern 4: Identity Bridge Into Another Agent System

Flow:

1. Use LitGraph for discovery and curation.
2. Export identifiers text.
3. Feed the `.txt` rows into another agent that:
   - downloads PDFs
   - pulls full text
   - writes notes
   - builds structured summaries

Best for:

- separating discovery from full-text reading

## Recommended Interfaces for an Agent Framework

If you want to formalize the current app into agent tools, these are the most natural interfaces:

```ts
resolveSeed(input: string): Promise<string>
fetchPaper(paperId: string): Promise<PaperNode>
expandPaper(paperId: string, mode: "relevance" | "lesser_known_sample"): Promise<ExpansionResult>
rankCandidates(candidates: ExpansionCandidate[]): ExpansionCandidate[]
sampleLesserKnown(candidates: ExpansionCandidate[], n: number): ExpansionCandidate[]
toggleReview(paperId: string): void
listReview(): PaperNode[]
exportBibtex(paperIds: string[], sort: "author" | "year"): Promise<string>
exportIdentifiers(paperIds: string[], sort: "author" | "year"): Promise<string>
```

## Existing Data Contracts

These shapes are already stable enough to reuse:

```ts
type PaperNode = {
  id: string
  paperId: string
  title: string
  year: number | null
  abstract: string | null
  authors: { authorId: string | null; name: string }[]
  citationCount: number
  influentialCitationCount: number
  referenceCount: number
  url: string | null
  venue: string | null
  state: "unexplored" | "loading" | "expanded" | "error"
  isRoot: boolean
  isSelected: boolean
  isInReviewCart: boolean
  errorMessage: string | null
}

type GraphLink = {
  id: string
  source: string
  target: string
  relation: "citation" | "reference"
  isInfluential: boolean
  contextsCount: number
}

type ExpansionCandidate = {
  relation: "citation" | "reference"
  sourcePaperId: string
  targetPaper: PaperNode
  isInfluential: boolean
  contexts: string[]
}
```

## Limitations an Agent Framework Should Respect

- no free-text paper discovery yet
- no multi-hop recursion yet
- first page only for citations/references
- no persistence layer
- current review cart is browser-session state
- NBER resolution may depend on both NBER page structure and Semantic Scholar title matching
- BibTeX coverage is partial because `citationStyles` is not guaranteed upstream
- identifier export is only as good as available `externalIds` and DOI patterns

## Suggested Next Steps if You Want to Productize This for Agents

Most valuable next upgrades:

1. move `GraphStore` into a framework-neutral core module
2. expose explicit JSON-returning agent endpoints for `resolve`, `expand`, `rank`, `review`, and `export`
3. add persistence for sessions and curated reading lists
4. add free-text search so agents can start from titles or natural-language prompts
5. add a full-text ingestion layer downstream of the identity export

## Repo References

- overview and setup: [`README.md`](/Users/amahajan/src/lit-graph/README.md)
- Semantic Scholar API reference: [`swagger.json`](/Users/amahajan/src/lit-graph/swagger.json)
