# Architecture

## Process model

Math Research Agent is an Electron application with three execution boundaries:

1. **Renderer** — React/TypeScript UI and Zustand state. It has no Node integration and cannot directly access files, SQLite, credentials, or child processes.
2. **Electron main process** — owns BrowserWindow creation, IPC handlers, SQLite, imports/exports, credentials, provider requests, orchestration, and tool processes.
3. **Python worker** — a JSON-in/JSON-out mathematical process launched with `python -I` in a per-project workspace.

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

Electron Builder places this runtime and `python/worker.py` outside `app.asar`. The worker validates a fixed tool enum and input schema, restricts imports/builtins/AST attributes, limits code size, uses a dedicated workspace, and is killed at the configured timeout.

The bundled v1.0.0 runtime contains CPython 3.12.10, SymPy, NumPy, SciPy, mpmath, and z3-solver. Lean and SageMath are capability-detected external executables only.

## Research graph and verification

Research nodes represent conjectures, subgoals, lemmas, claims, experiments, counterexamples, proof attempts, gaps, and dead ends. Edges record dependencies and support/refutation relationships. Evidence records retain type, verification label, reproducibility, sources, and experiments.

Model-created nodes begin as `llm-assessed-only`. A proof cannot be displayed as verified unless all critical steps are valid, independently reviewed, and backed by exact or symbolic verification. Detailed semantics are in [VERIFICATION.md](VERIFICATION.md).

## Literature and imports

The import dialog accepts PDF, text, Markdown, and LaTeX files up to 50 MiB and copies them into local user data. Text formats store a bounded excerpt; PDFs are stored without OCR. Provider context contains bounded source excerpts, not arbitrary full files.

## Security boundaries

The main trust boundaries are renderer-to-IPC, provider-to-normalizer, model-to-tool schema, tool-to-worker, imported-document-to-local storage, and bundled-runtime provenance. These controls reduce risk but are not an OS-level sandbox. See [SECURITY.md](../SECURITY.md) and [PRIVACY.md](PRIVACY.md).
