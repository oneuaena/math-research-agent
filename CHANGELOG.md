# Changelog

All notable project changes are documented here. The format follows Keep a Changelog principles and the project uses semantic versioning for public releases.

## [1.2.0] - 2026-08-24

### Added

- Added a durable SQLite research-job queue with heartbeat monitoring, bounded retry/backoff, cancellation, and restart recovery for long-running work.
- Added concurrent skeptic and independent-verifier roles, deterministic reruns, branch-DAG evidence, safety budgets, and a packaged autonomy smoke test.
- Added the Lean 4 Formal Lab, pinned Lean 4.32.0/Mathlib workspace support, hard proof-gap blocking, kernel artifacts, and local Mathlib search.
- Added self-contained macOS 13+ packages for Apple Silicon and Intel with architecture-matched CPython, NumPy, SciPy, Z3, and Canvas runtimes.

### Fixed

- Resume now advances from the recorded next stage instead of replaying a completed checkpoint stage.
- macOS packages now contain architecture-specific `app.asar` archives and the correct Darwin Canvas native module instead of the Windows native module.
- Provider research-role responses are normalized before strict schema validation while preserving bounded diagnostics.

### Security

- Kept generated runtimes, local workspaces, credentials, databases, and release binaries outside the source branch.
- Validated packaged Mach-O architectures, executable modes, framework symlinks, and runtime load dependencies; macOS packages remain unsigned and require normal Gatekeeper confirmation.

## 1.1.5

- Added a Lean 4 Formal Lab with a paired natural-language target and Lean source editor, hard proof-gap blocking, kernel-run artifacts, and local Mathlib search.
- Added a pinned Lean 4.32.0 / Mathlib 4.32.0 workspace. On Windows it stores Mathlib sources and cache under `D:\Math Research Agent\formal-workspace` when D: is available.
- Added local `mathlib_search` retrieval for formal proof planning. Search results are explicitly non-verification evidence.

## 1.1.4

- Added safe Python-worker compatibility facades for `itertools`, `collections`, deterministic `random`, and JSON-only checkpoint serialization for legacy `pickle` calls; unsafe arbitrary pickle deserialization remains blocked.
- Allowed only `__version__` reads on explicitly imported scientific modules; all other dunder access remains blocked.
- Added durable exact n=71 delete-2/add-3 batch driver with per-pair atomic checkpoints, JSONL batch logs, deterministic parameters, interruption testing, and restart continuation.
- Added a complete delete-1/add-2 verifier that does not assume every insertion lands in the initially empty row.

## 1.1.3

- Connected project chat tool calls to the same local executor as autonomous research; tool-enabled chat receives its project workspace identity.

## 1.1.2

- Added persistent project-workspace read/write, constrained Python/Lean command execution, and HTTP/HTTPS download tools.
- Persisted exact tool stdout, stderr, exit codes, and audit locations with research experiments.
- Labeled tool activity as PLANNED, RUNNING, VERIFIED, or FAILED so a proposed experiment cannot be displayed as verified execution.

## [1.1.1] - 2026-08-12

### Fixed

- Normalize safe OpenAI-compatible research-action aliases before strict schema validation, including `GAP` to `PROOF_GAP`.
- Preserve provider-supplied structured failure details as bounded text instead of rejecting an otherwise valid action.
- Accept the existing `capability_check` deferred tool in the research-action contract.
- Make the bounded schema-repair diagnostic accurate and always repair the latest normalized payload.

## [1.1.0] - 2026-08-11

### Added

- Source-aware research chat with explicit run/pause/resume routing and bounded retrieval from imported PDF, DOCX, text, Markdown, and LaTeX documents.
- Local document extraction, deterministic chunk indexing, and optional arXiv/Crossref literature search.
- Audited external Lean 4/Lake adapter that invokes the real kernel and rejects placeholders, unsound shortcuts, metaprogramming, IO, and foreign execution.
- Strict `SAT`, `UNSAT`, `UNKNOWN`, `BOUNDED_CHECK`, and `FORMALLY_VERIFIED` evidence levels with exact input/stdout/stderr artifacts.
- Real formal-toolchain integration tests covering Python protocol failures, Unicode, output/timeout limits, Z3 statuses, Lean acceptance/rejection, audit redaction, and Agent proof promotion.

### Fixed

- Kept model program stdout separate from the Python worker JSON protocol, eliminating invalid-result parsing for scripts that call `print()`.
- Forced isolated Python processes into UTF-8 mode so Chinese and mathematical Unicode survive Windows code-page differences.
- Preserved completed checkpoints while Resume advances from the saved next stage instead of replaying a terminal cycle.
- Restricted verified-proof display and promotion to reviewed proofs backed by a matching successful Lean kernel artifact.

### Security

- Added no-shell process execution, cancellation, output limits, exact redacted audit artifacts, and conservative Lean source policy checks.
- Kept imported source binaries and all user research data outside source and installer artifacts.

## [1.0.0] - 2026-08-10

### Added

- Persistent autonomous mathematical-research orchestrator with formalization, planning, branches, experiments, pattern and lemma work, proof attempts, critique, verification, replanning, synthesis, and checkpoints.
- Typed research tree/proof graph, evidence records, proof documents, failure memory, budgets, pause/resume, and restart recovery.
- Restricted Python worker with SymPy operations, numerical libraries, Z3 checks, capability detection, and reproducible stress-test cases.
- Self-contained Windows x64 runtime based on CPython 3.12.10 with pinned SymPy, NumPy, SciPy, and Z3 packages.
- Runtime Diagnostics for bundled interpreter, worker, writable workspace, arithmetic, factorization, and Z3 SAT checks.
- OpenAI-compatible provider abstraction with tool calls, reasoning responses, SSE/JSON transport normalization, safe diagnostics, bounded retries, and structured-output recovery.
- Chinese and English operation surfaces, local SQLite persistence, Markdown/LaTeX exports, and counterexample evidence export.
- Apache-2.0 licensing, bilingual documentation, community health files, public-safe CI, release guidance, and third-party notices.

### Changed from 0.1 development builds

- Expanded the original reproducible conjecture stress tester into a checkpointed autonomous research workspace while retaining exact counterexample workflows.
- Packaged releases no longer require users to install or configure Python for core mathematical tools.

### Security

- Renderer context isolation, sandboxing, disabled Node integration, denied popups, narrow IPC, encrypted provider credentials, bounded tool execution, and credential-redacted provider logs.

[1.0.0]: https://github.com/oneuaena/math-research-agent/releases/tag/v1.0.0
[1.1.0]: https://github.com/oneuaena/math-research-agent/releases/tag/v1.1.0
[1.1.1]: https://github.com/oneuaena/math-research-agent/releases/tag/v1.1.1
[1.2.0]: https://github.com/oneuaena/math-research-agent/releases/tag/v1.2.0
