# Justified citations: a collaborative workflow for LitGraph

Status: design proposal, September 26, 2026. No application behavior is changed.

## Product thesis

An academic should be able to say: **“We cite this work here, for this reason, based on this evidence.”** A collaborator or reader should be able to inspect and challenge that reasoning.

The central object is a citation justification attached to a specific passage in a specific manuscript version. The bibliography is one output of these decisions. Citation counts alone cannot represent the decisions.

Here, an “agentic paper” means a versioned manuscript with agents that help discover sources, propose citation justifications, check evidence, and identify decisions affected by edits. Human collaborators make the editorial decisions. This is a working product definition, not a claim about an existing publishing standard.

The goal is to make the citation loop inspectable: discovery → proposed use → evidence → review → publication → subsequent challenge or revision. The system cannot establish intellectual importance or eliminate gaming merely by collecting explanations.

## What a collaborator claims

“Claim citation” is ambiguous. Use **“Justify citation”** for asserting why a reference belongs and **“Take review”** for taking responsibility for checking it. Neither action grants ownership of a reference, authorship, or scholarly priority.

A justification answers:

1. **Where?** The exact statement, method, figure, or section using the source.
2. **What role?** Background, definition, empirical support, method use/adaptation, dataset/software use, comparison, disagreement, or historical attribution. Multiple roles are permitted.
3. **Why this work?** What it contributes to this particular passage.
4. **What evidence?** A source passage, figure, table, or versioned artifact with a locator.
5. **What limits?** Differences in population, setting, method, magnitude, or interpretation.
6. **Who stands behind the decision?** Proposer, reviewers, decision maker, and disclosed relationships.

Example, using fictional works:

> **Manuscript:** “We use the split-sample estimator introduced by Lee et al.”
>
> **Role:** Method adaptation.
>
> **Reason:** “Our estimator follows Algorithm 2 in Lee et al.; we replace their fixed threshold with a learned threshold.”
>
> **Evidence:** Source version 2, Algorithm 2, PDF page 7, with the relevant excerpt attached.
>
> **Limit:** “Their consistency result does not cover our threshold modification.”
>
> **Decision:** Accepted by a second collaborator for manuscript revision 12.

That decision does not say Lee et al. supports every result in the new paper. A citation used to criticize a finding should remain visibly different from one used to support it.

## Systems of record

Start each project with an explicit list of source systems. Each entry declares its scope, connection identity, permissions, retrieval status, and which fields it is authoritative for. These are proposed integration categories, not a promise that all connectors already exist.

| Record category | Example source | Authority in this workflow |
| --- | --- | --- |
| Manuscript | Uploaded snapshot initially; editor or repository later | What text appeared in each manuscript version |
| Source library | Zotero collection | The team's selected records and accessible attachments |
| Publication identity | DOI registry, arXiv, PubMed | Provider metadata and identifiers, with provenance |
| Source content | Exact PDF, HTML snapshot, dataset release, or code commit | The material actually inspected |
| Literature discovery | Existing Semantic Scholar graph | Candidate references and reported citation relationships |
| Researcher identity | Project account; optional ORCID association later | Who performed an action; identity does not establish correctness |
| Editorial decisions | New project decision history in LitGraph | Proposed reasons, reviews, disputes, and accepted versions |

Separate a work from its versions and from the files retrieved for those versions. A DOI match does not prove two PDFs are identical. Conflicting metadata remains inspectable; do not silently merge ambiguous records. A provider update does not overwrite a previously reviewed snapshot.

A minimal connection record contains: provider, scoped collection/repository/document ID, authoritative fields, access scope, sync policy, and last successful retrieval. Credentials stay separate from exported records. Citation discovery is a lead, not evidence of the reason for citing.

## End-to-end workflow

### 1. Establish the project

The lead author imports a manuscript snapshot, selects the source library, and invites collaborators. They set the acceptance rule: by default, one reviewer other than the proposer. A solo workflow is allowed but its decisions are labeled self-reviewed.

The project starts private. Evidence, manuscript text, and justifications inherit project permissions; public release is an explicit action.

### 2. Build the citation inventory

An agent extracts citation-bearing passages and maps each citation occurrence to a source identity. Collaborators can correct mappings and add missed passages. Uncited statements that may need attribution appear in a separate suggestions queue; extraction does not certify completeness.

Repeated use of the same paper produces multiple occurrences when the reasons differ. A single sentence citing five papers requires a reason for each, or an explicitly explained joint evidentiary role. One general justification must not silently certify every occurrence of a reference.

### 3. Propose or explain a citation

A collaborator selects text and clicks **Justify citation**. They choose an existing reference or propose a new one, select its role, explain the use, and attach evidence. The agent can prepare a draft, including limitations and possible source mismatches.

The author must inspect and submit the proposal. Preserve the distinction between an agent suggestion and a human-submitted reason. “Widely cited” or “recommended by the agent” alone is not sufficient justification for empirical support.

Background or historical references can use a scoped explanatory note rather than an arbitrary supporting quote. Method and artifact reuse can point to an algorithm, release, or commit. Required evidence depends on the citation's role.

### 4. Review the reasoning

A second collaborator takes the review. The review surface shows the manuscript passage, proposed reason, source evidence, limitations, source coverage, and prior discussion together.

The reviewer can accept, request changes, reject, or flag a dispute. They check identity, source version, fit between passage and evidence, and whether the stated role is fair. They can propose narrower wording, a different citation role, an additional source, or removal of the reference.

Agent findings assist this review. Exact excerpt matching establishes that the text was retrieved; it does not establish that the scientific interpretation is correct. Partial or inaccessible sources stay labeled as such.

### 5. Reconcile the manuscript

Accepted proposals become an explicit list of manuscript edits or citation decisions. For the MVP, export suggested edits; the author applies them and imports the next snapshot. Do not report a citation as present until the imported manuscript confirms it.

When manuscript wording, source version, evidence, or justification changes, mark the affected decision **Needs re-review**. Preserve its earlier accepted state in the history. An agent may suggest matching old and new passages, but ambiguous remapping requires a human decision.

### 6. Freeze a release

Create an immutable release linking the manuscript snapshot, bibliography, and citation-justification manifest. The release lists unresolved, disputed, inaccessible, and self-reviewed items explicitly. The lead author may release with unresolved items and a recorded rationale; “released” is not synonymous with “all citations validated.”

Readers of a published manifest can inspect why a work was used. Later challenges produce a new decision revision and, if needed, a new release. Old releases remain addressable. Public dispute submission is a later feature; invited collaborators suffice for the first version.

## Main interface

The primary screen is the manuscript with a citation review panel. Keep the existing literature graph as a discovery view.

- **Left:** Sections and a queue filtered by Missing reason, Ready for review, Changes requested, Disputed, or Needs re-review.
- **Center:** Manuscript text with selectable citation occurrences and version differences.
- **Right:** Citation role, reason, source excerpt, locator, coverage, limitations, reviewer actions, and history.

The reference detail view answers “Where and why do we use this work?” by listing every occurrence and decision. The project overview shows review coverage and unresolved decisions without ranking researchers.

Use specific labels: **AI suggested**, **Source excerpt matched**, **Human reviewed**, **Self-reviewed**, **Needs re-review**. Avoid a single green “Verified” badge that conflates identity, textual support, and editorial acceptance.

## State and responsibility

Keep three dimensions separate:

| Dimension | Values |
| --- | --- |
| Editorial decision | Draft, Proposed, In review, Changes requested, Accepted, Rejected, Withdrawn |
| Currency | Current, Needs re-review, Orphaned passage |
| Evidence assessment | Not assessed, Supported, Partially supported, Contradicted, Insufficient evidence, Not applicable to this role |

A dispute is a separate open/closed record with its own rationale and resolution. It can coexist with a historically accepted decision. Taking a review assigns work; it does not block other collaborators from commenting. Acceptance requires a recorded decision on the exact revision reviewed.

Authors submit justifications and edits. Reviewers assess them. The lead author resolves editorial deadlocks with a visible rationale. Agents can propose and flag; they cannot impersonate a collaborator or approve their own output. Project administrators manage access without silently rewriting decision history.

## Durable records

Use stable IDs and revisioned records rather than deriving identity from text alone.

| Object | Essential fields |
| --- | --- |
| Project / SourceConnection | Members, roles, review policy, scoped systems of record |
| ManuscriptVersion | Project ID, parent version, content hash, snapshot, import time |
| Work / WorkVersion | Canonical and provider IDs, version metadata, identity-resolution history |
| SourceSnapshot | Work version, retrieval route/time, content hash, access scope, extraction coverage |
| CitationOccurrence | Manuscript version, stable passage ID, exact quote and context, source IDs |
| JustificationRevision | Occurrence, source, role, reason, limitations, proposer, agent provenance, prior revision |
| EvidenceAnchor | Source snapshot, exact excerpt or artifact pointer, locator type/value, match outcome |
| Review / Dispute | Target revision, reviewer, decision or objection, rationale, timestamps |
| Release | Manuscript version, frozen decision revisions, manifest, unresolved-item inventory |
| AuditEvent | Actor, action, entity/revision, time, prior event reference |

Store PDF index separately from printed page labels; do not infer one from the other. Record agent/model version and supplied source snapshots so a proposal's provenance can be inspected, without claiming model output is perfectly reproducible.

Edits create new revisions. Use optimistic concurrency checks so a reviewer cannot accept stale text. Import and retry operations must be idempotent. Server-side project authorization applies to every record and attached excerpt, including exports.

## Resistance to gaming

- Do not award points for adding citations, submitting reasons, or collecting approvals. Those counters would create a new optimization target.
- A fluent reason is not proof. Review evidence and fit to the manuscript, and retain objections.
- Surface self-citation and declared relationships as context, without treating them as automatic disqualifications.
- Detect duplicate occurrence/source proposals and suspiciously repeated boilerplate; ask for review rather than inferring misconduct.
- Do not require journal prestige or citation count as a quality threshold. Candidate ranking should expose its basis and allow alternatives.
- Use project-level permissions and scoped invitations initially. Independent-looking accounts do not by themselves establish independent review.
- Do not make the number of recorded uses into a claim of impact or quality. Public profiles and global rankings are outside the MVP.

Public exports need a preview of exactly what becomes visible. Exclude private notes and inaccessible source content by default; preserve permitted locators and metadata. Access failures are unknowns, not negative judgments about a source.

## Fit with the current repository

Existing foundations, confirmed in the repository:

- `lib/auditDocument.js`: manuscript import and hashing.
- `lib/auditService.js`: citation inventory, evidence selection, and passage-level support assessments.
- `lib/auditSources.js`: source retrieval.
- `frontend/src/ui/manuscriptAudit.js`: manuscript audit interface.
- `frontend/src/auditState.js`: assessment labels and Markdown/JSON reporting.
- The existing graph and review cart: literature discovery and candidate selection.

The substantial new work is persistent projects, individual authentication and authorization, stable versioned passage identity, justification records, review/dispute workflows, and release exports. The current in-memory workflow and shared access token are insufficient for durable multi-user collaboration.

Keep source retrieval and assessment behind shared services used by both local Express routes and deployed handlers. Add a durable relational store for decisions and authorized snapshot storage. Use background jobs for longer extraction/checking work, with visible status, cancellation, retries, and per-project limits. Deployment choices and exact API contracts can follow after the workflow is validated.

## First useful release

Build one vertical slice: **import manuscript → select Zotero sources → justify one citation → second collaborator reviews → edit triggers re-review → export a frozen manifest.**

Include uploaded manuscript snapshots, existing source retrieval, individual project accounts, invited collaborators, the justification form, evidence anchors, review history, change invalidation, and Markdown/JSON exports. Agents draft reasons and evidence packets only when asked.

Defer live editor synchronization, arbitrary new connectors, public claims, automatic bibliography writeback, global reputation, and cross-paper analytics. An upload plus an existing library is enough to test whether academics find the interaction worth doing.

Acceptance scenarios:

1. Two collaborators can complete a justification and review with visible attribution after refreshing the app.
2. The same work can support a method citation and a disagreement citation with distinct reasons.
3. Inaccessible evidence remains visible and cannot be presented as checked full text.
4. An edit to the reviewed passage invalidates its current approval without erasing the old decision.
5. A concurrent edit prevents acceptance against an out-of-date revision.
6. A third collaborator can dispute an accepted reason; the objection survives release export.
7. A user outside the project cannot access its manuscript, evidence, or decisions.
8. A release can reconstruct exactly which manuscript and source versions each decision concerned.

## Pilot and success criteria

Pilot with a small set of teams using real drafts. Sample method, background, support, and disagreement citations rather than testing only easy empirical claims. Ask reviewers to evaluate both agent-drafted and author-written justifications.

Measure time per completed review, missing or misassigned occurrences found by manual inspection, reasons materially corrected, source/version errors caught, and whether a fresh reader can explain the role and limits of a citation. Track abstentions and self-review separately. A high acceptance rate is not inherently success.

The central product test: **Does this make a citation decision easier to understand and challenge at an acceptable cost to authors?** Treat improved trust or reduced gaming as hypotheses to evaluate, not launch claims.

## Interoperability notes

Crossref represents citation relationships and other typed relationships between works; this proposal adds project-level reasons and review history, without assuming those reasons can be deposited through existing citation metadata. See [Crossref relationships](https://www.crossref.org/documentation/schema-library/markup-guide-metadata-segments/relationships).

ORCID records the source of assertions, a useful precedent for retaining who asserted a fact separately from the fact itself. It does not make a citation justification correct. See [ORCID assertion sources](https://info.orcid.org/ufaqs/what-does-source-mean-in-an-orcid-record/).

Contributor attribution is a separate potential extension. CRediT describes contributor roles; it should not be repurposed as the vocabulary for why one paper cites another. See [CRediT roles](https://credit.niso.org/contributor-roles/).
