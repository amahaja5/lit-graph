# Architecture findings and changes

| Issue | Concrete finding | Change |
| --- | --- | --- |
| Implicit coupling | Access control accepted an environment argument but legacy checks read global process state; audit composition ignored injected OAuth; API expansion depended on `this`. | Pass dependencies consistently; close over the API client. Only local server startup loads `.env`. |
| Layer-first folders | Flat `lib` and frontend `ui` separated related workflows by technical role. | Group papers, review, audit, citation import and authentication by feature. Keep genuinely shared HTTP/document/model infrastructure separate. |
| Duplication | Cache, error type, resolver and S2 client existed under both `lib` and `server/src`. Export workflows and route validators repeated the same policies. | Delete duplicate implementations; use shared construction, handlers, and an export pipeline with format-specific behavior. |
| Representable illegal states | Review state could combine idle/loading/error with an unrelated payload; late responses could replace a new seed's draft or report a changed cart as current. | A controller owns frozen state variants and request generations. Only ready state has a payload and staleness flag. Cart revision changes mark completed work stale; reset invalidates pending responses. |
| God files | Main browser module mixed graph work, review generation, file serialization and download behavior. Audit service mixed model validation, passage ranking, request validation and orchestration. | Extract review controller/export workflow and audit assessment, passage and request modules. |
| Shotgun surgery | Paper-query policy and error fixes required changes across both hosts and three Vercel routes. | Both hosts use one parser, handler and error implementation. |
| Layering violations | Domain error definitions contained HTTP response serialization; shared document/model utilities lived inside the audit naming/ownership boundary despite serving imports too. | Put HTTP serialization in `lib/http`; document and cross-feature model utilities have separate ownership. |
| Pass-through wrappers | Platform adapters are thin but required by routing, and lazy service accessors own cache lifetimes. | Retain these meaningful boundaries; do not introduce forwarding modules at removed paths. Consumers import owning modules directly. |
| Validation away from boundaries | Invalid paper queries could reach resolution first; nested query objects were stringified; malformed JSON/null bodies and null audit reference records became internal errors. | Validate before resolution or service work, parse object bodies consistently, validate reference/model records, and translate JSON parse failures to HTTP 400. |

## Contracts

- HTTP routes retain their public URLs. Internal module paths have changed; tests,
  experiments, HTML entry points and documentation use the new owners.
- Invalid query objects/repeated values and non-decimal paging values are rejected.
  Unexpected exceptions produce a generic HTTP 500 message; typed errors preserve
  their status and retry metadata.
- Audit sources remain request-scoped so private Zotero content is not cached
  across accounts. Long-lived public S2/review caches retain their existing lifetimes.
- Review regeneration clears the previous draft while loading. Failed generation
  exposes an error state rather than retaining an ambiguous previous payload.
- Graph detail and expansion completions are scoped to the seed request, preventing
  older operations from mutating the graph after a seed change.

Regression coverage includes both HTTP hosts, malformed boundary values, auth
configuration injection, stale/replaced review requests and existing feature tests.
No live model or Zotero calls are required by the suite. This refactor does not claim
that file size alone makes a renderer or workflow a god file; cohesive renderers
remain together.
