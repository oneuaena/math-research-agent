# Changelog

All notable project changes are documented here. The format follows Keep a Changelog principles and the project uses semantic versioning for public releases.

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
