# Changelog

All notable project changes are documented here. The format follows Keep a Changelog principles and the project uses semantic versioning for public releases.

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

[1.0.0]: https://gitee.com/lu-chuanyou/math-research-agent/releases/tag/v1.0.0
