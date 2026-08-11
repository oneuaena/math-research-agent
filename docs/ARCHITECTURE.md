# Architecture

## Process model

Math Research Agent is an Electron application with three execution boundaries:

1. **Renderer** — React/TypeScript UI and Zustand state. It has no Node integration and cannot directly access files, SQLite, credentials, or child processes.
2. **Electron main process** — owns BrowserWindow creation, IPC handlers, SQLite, imports/exports, credentials, provider requests, orchestration, and tool processes.
3. **Tool processes** — an isolated JSON-protocol Python worker plus audited external Z3 and Lean 4/Lake executions in per-project workspaces.

`electron/preload.ts` exposes a narrow typed API through `contextBridge`. Renderer popups are denied, context isolation and sandboxing are enabled, and production devtools are disabled.

## Persistence

`ResearchDatabase` uses Node's SQLite API. Migrations create:

- `projects` for project metadata;
- `records` for typed JSON collections such as specifications, sessions, research steps, branches, evidence, graph edges, and proofs;
- `activities` for recent activity;
- `settings` for provider settings and the safeStorage-encrypted credential blob.

The database enables foreign keys, WAL mode, and normal synchronous durability. On startup, sessions left as `RUNNING` are converted to `PAUSED` while retaining `nextStage`, so resume continues from the persisted cursor.

## Research orchestrator

The orchestrator selects a role for each stage, asks the configured provider for a schema-validated action, runs permitted mathematical tools, persists evidence and graph artifacts, updates proof reviews, chooses the next stage, and enforces iteration/time/branch/checkpoint budgets.

The provider can be a deterministic local coordinator or an OpenAI-compatible adapter. The provider layer normalizes ordinary content, reasoning-only content, tool calls, Chat Completions JSON, Responses-like output shapes, and SSE streams. Network retry and model-generated JSON repair are separate bounded mechanisms.

## Tool and Python runtime

Development uses the Python executable configured in Settings. Packaged Windows builds ignore system `PATH` for Python and resolve:

```text
process.resourcesPath/runtime/python/python.exe
```

Electron Builder places this runtime and `python/worker.py` outside `app.asar`. The worker runs as `python -I -B -X utf8`, validates a fixed tool enum and input schema, captures program stdout/stderr separately from its JSON protocol, restricts imports/builtins/AST attributes, limits code and output size, uses a dedicated workspace, and is killed at the configured timeout.

The bundled v1.1.0 runtime contains CPython 3.12.10, SymPy, NumPy, SciPy, mpmath, and z3-solver. Z3 reports only the status of the submitted bounded SMT-LIB encoding. Lean 4/Lake is an external, real proof adapter: each request is policy-checked, written to an exact `.lean` artifact, and accepted only when the Lean kernel exits successfully. `sorry`, `admit`, new axioms/constants, unsafe/native shortcuts, metaprogramming, IO, and foreign execution are rejected. SageMath remains capability-detected only.

Every tool invocation writes a redacted JSONL audit entry and exact input/stdout/stderr/result artifacts under the Electron user-data `verification-artifacts` and `logs` directories. A shared spawn layer enforces no-shell execution, cancellation, timeout, and output limits.

## Research graph and verification

Research nodes represent conjectures, subgoals, lemmas, claims, experiments, counterexamples, proof attempts, gaps, and dead ends. Edges record dependencies and support/refutation relationships. Evidence records retain type, verification label, reproducibility, sources, and experiments.

Model-created nodes begin as `llm-assessed-only`. Exact, symbolic, and bounded Z3 results retain their narrower scope. A proof is promoted to `formally-verified` only when a real successful `lean_check` identifies the proof, names a `formalizationOf` target that exactly matches its theorem, the proof was independently reviewed, and every critical step is `VALID`. Detailed semantics are in [VERIFICATION.md](VERIFICATION.md).

## Literature and imports

The import dialog accepts PDF, DOCX, text, Markdown, and LaTeX files up to 50 MiB and copies them into local user data. A main-process extractor obtains page-aware PDF text, DOCX paragraphs, or plain text, then a deterministic index stores bounded chunks. Research context and project chat retrieve only bounded excerpts. Image-only PDFs are not OCRed, and original binary files are not sent to a provider. Optional literature search queries public arXiv and Crossref metadata endpoints and imports only records selected by the user.

Project chat is routed through a separate context builder. Ordinary questions do not mutate the research state. Explicit research-control messages can update the problem statement or request run/pause/resume actions through typed main-process IPC; the existing orchestrator and checkpoint cursor remain authoritative.

## Security boundaries

The main trust boundaries are renderer-to-IPC, provider-to-normalizer, model-to-tool schema, tool-to-worker, imported-document-to-local storage, and bundled-runtime provenance. These controls reduce risk but are not an OS-level sandbox. See [SECURITY.md](../SECURITY.md) and [PRIVACY.md](PRIVACY.md).
