# TypeSafe experiments — 2026-09-19

Recommendation: add a semantic HTML evidence gate first, with extraction fixes so the gate can see short evidence and multiple content regions. Pilot audit passage reranking next. Keep the current Anthropic assessment and deterministic source/quote validation while evaluating TypeSafe verdicts in shadow mode.

## What ran

- Live HTTP calls to `https://api.typesafe.ai/v1/systemone`, pinned to `jev-1.13.0`.
- 88 requests, 246 typed judgments, 69,112 input tokens and 6,016 output tokens across an initial run, independent repeat, and HTML stress suite.
- Estimated API cost: **$0.00290**, using the documented $0.042 per million input tokens and free output. This is an estimate, not a billing receipt.
- Initial-run request latency: median **173 ms**, p95 **266 ms**. Repeat: median **178 ms**, p95 **256 ms**. These are small payloads on this connection, not production latency forecasts.
- Key loaded from the interactive shell; only synthetic fixtures sent. No credentials are stored in artifacts.
- Existing production functions supplied the keyword-ranking and HTML baselines. Application behavior was not modified.

Fixtures were authored and labeled before their API calls. They deliberately exercise suspected failure modes. They are neither representative production samples nor independently adjudicated ground truth. The extra HTML cases were authored after the first run, but used its unchanged classification rubric. No claims about scientific factual accuracy or comparative Anthropic performance follow from these results.

## Results

| Experiment | Current behavior | TypeSafe result |
| --- | --- | --- |
| Audit retrieval, 8 cases / 81 candidate passages | All labeled evidence retained in top eight for 4/8 cases | All labeled evidence retained for 8/8 cases |
| HTML usefulness, 16 cases | 7/16 correct; 8 false acceptances, 1 false rejection | 15/16 correct; 0 false acceptances, 1 false rejection |
| Citation relation, 16 cases | No Anthropic comparison performed | 16/16 matched author labels |
| Additional HTML stress suite, 12 cases | Document-usefulness boolean correct in 6/12 | Existing-parser gate: 9/12; supplied intact-candidate experiment: 12/12 |

The retrieval score evaluated relevance to assessing a claim, counting supporting and contradicting evidence equally. The top-ranked passage was relevant in all eight TypeSafe cases versus four baseline cases. Macro recall@1 is 93.75%, because the two-sided case contains two relevant passages and a top-one result can retain only one. Macro recall@8 rose from 50% to 100%. Four cases are direct lexical controls; four deliberately disadvantage word overlap.

All 10–11 candidates per case were sent to TypeSafe. This experiment does **not** validate lexical shortlisting on a long PDF. Passing only today's top eight to the model would miss the same evidence in four cases. The short fixtures also do not stress the 14,000-character budget, OCR, overlapping chunks, tables, or multiple pages of context.

### Useful findings

1. The current ranking missed a mortality result phrased as “neonatal”/“newborn” concepts, a generalization result phrased in terms of held-out distributions, language-specific accuracy contradicting an all-languages claim, and age-specific effects contradicting a universal policy claim. TypeSafe selected their evidence. The generalization example requires interpreting “added module” as the adapter; real packets should carry neighboring context to make that link explicit.
2. The HTML gate rejected cookie notices, subscription notices, CAPTCHA pages, navigation, metadata-only text, bibliographies, an unrelated article, and a title-only paywall. It retained genuine research about cookies and CAPTCHAs in the stress suite, so a simple banned-word filter would be inadequate.
3. The existing parser dropped a useful result under 150 characters. The stress suite reproduced this with both a short result and short methods paragraph. A separate intact-candidate judgment accepted both.
4. With two `article` elements, the current parser selected a subscriber panel and discarded the research article. The model correctly rejected the panel. Fix candidate discovery before asking the model to choose useful content.
5. Verdict labels were correct on direct support, numerical contradiction, relative versus absolute change, partial scope, hypotheses, and absent evidence. Some correct choices had low confidence (e.g. paraphrase 0.49, association versus causation 0.61 in the initial run). A perfect tiny-set accuracy is not a basis for automatic verdict acceptance.

### Reading the stress result correctly

The stress suite records whether a document contains useful evidence, then compares the current parser's acceptance and the downstream gate. The two-article baseline counts as a correct document-level acceptance even though it extracted the **wrong** text. That exposes the limitation of the boolean metric; inspect the saved request text as well.

The `earlier_gate` condition was supplied the intact, manually identified candidate from the fixture. Its 12/12 is an **oracle candidate-availability probe**, not an implemented extraction pipeline result. It proves neither that a DOM parser will always discover the correct block nor that the classifier can recover text it never receives. The two questions share state and are directed at their respective fields; this is not an isolated comparison of two complete extraction implementations.

### Stability

The independent repeat preserved all HTML and citation labels and all retrieval recall results. Lower-ranked candidate order changed in six of eight retrieval cases. Cache and log model/rubric versions; do not promise deterministic rankings.

## Reproduce

From the repository root, after exporting `TYPESAFE_API_KEY`:

```sh
node experiments/typesafe/run.mjs
node experiments/typesafe/run.mjs --repeat
node experiments/typesafe/stress.mjs
```

If the key is defined by `.zshrc`, run the command within `zsh -ic`, as in the recorded experiments. Credentials are read only from the environment. `run.mjs` retries bounded rate-limit/overload responses; `stress.mjs` stops on service failure.

Each exact request is fingerprinted and its response saved. Existing matching files are replayed; `--repeat` uses a separate cache namespace and originally made fresh calls. To run a further live repeat, move the matching cache files aside first. `--offline` on either script requires cached results and makes no API calls.

- `fixtures.mjs`: primary labeled synthetic fixtures.
- `run.mjs`: baseline comparisons, API requests, typed response checks, and metrics.
- `stress.mjs`: extra fixtures and intact-candidate probe.
- `results/primary-summary.json`, `repeat-summary.json`, `stress-summary.json`: computed results.
- Remaining JSON files: exact non-secret state, rubric, raw responses, usage, and timing.

The initial experiment turn added only experiment files and the integration plan. The subsequent implementation added the optional server-side integration, parse5 dependency, and default-off environment settings described in the README.

Verification: both harnesses replayed their saved results successfully with `--offline`; the 18 existing audit and review-evidence tests passed (`node --test tests/server/audit.test.js tests/server/reviewEvidence.test.js`). These tests check existing invariants, not model accuracy on real documents.

Implementation follow-up: `production-smoke.mjs` made two additional live calls through the implemented adapter, parser/gate, and ranker using synthetic fixtures. It retained the research paragraph after an access panel and ranked the contradictory finding first, retaining PDF page 10. Results are in `results/production-smoke.json`. These calls are separate from the 88-request experiment totals above. Production rubrics include block/identity context and are versioned `evidence-v1`; the original benchmark is not a full evaluation of those revised prompts. The complete 86-test suite passed, including 17 integration/transport tests for the TypeSafe paths.

## References

- [TypeSafe HTTP API](https://docs.typesafe.ai/api)
- [Models and pricing](https://docs.typesafe.ai/models)
- [Score primitive](https://docs.typesafe.ai/primitives/score)
- [Citation checking cookbook](https://docs.typesafe.ai/cookbooks/citation_check)
- [Reranking cookbook](https://docs.typesafe.ai/cookbooks/rerank_typesafe)
- [Confidence guidance](https://docs.typesafe.ai/confidence)
