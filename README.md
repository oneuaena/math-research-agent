# Math Research Agent

[English](README.md) | [简体中文](README.zh-CN.md)

**A reproducible, auditable autonomous research workspace for experimental mathematics and conjecture exploration.**

Math Research Agent is a local-first Electron desktop application for organizing model-assisted mathematical exploration. It combines a persistent research tree, structured experiments, proof attempts, skeptical review, evidence labels, budgets, and checkpoint/resume execution in one Windows workspace.

This is an independent open-source project. References to OpenAI-compatible APIs, DeepSeek, OpenAI, Anthropic, Microsoft, Lean, SageMath, or universities describe interoperability only and do not imply affiliation or endorsement.

## Download

Windows 10/11 x64 users:

1. Open the [Gitee Releases page](https://gitee.com/lu-chuanyou/math-research-agent/releases).
2. Download `Math-Research-Agent-Setup-1.0.0.exe`.
3. Run the installer and open Math Research Agent.
4. Open **Settings**, enter your own model Provider, Base URL, model, and API key.
5. Run **Runtime Diagnostics**, then start a research project.

The installer includes Python 3.12, SymPy, NumPy, SciPy, and Z3. Ordinary users do **not** need Node.js, Python, `npm install`, `pip install`, PATH changes, or administrator access for the default per-user installation.

Windows SmartScreen may show **Unknown publisher** because this independent open-source release does not have a commercial code-signing certificate. Verify the published SHA-256 and download only from the project release page; do not disable Windows security globally.

## Overview

The application can:

- turn a natural-language question into a validated structured specification;
- run a bounded, persistent autonomous research workflow with specialized roles;
- maintain research branches, evidence, failed routes, proof steps, and a proof graph;
- execute restricted Python, SymPy, NumPy, SciPy, and optional Z3 checks;
- critique candidate arguments before any verification label is promoted;
- pause, checkpoint, recover interrupted sessions, and resume from the saved next stage;
- use either a deterministic local coordinator or an OpenAI-compatible model provider;
- persist project data locally in SQLite and export Markdown, LaTeX, or counterexample evidence.

## Important epistemic boundary

> **LLM-generated arguments are not automatically proofs. SURVIVED TESTING ≠ PROOF.**

The project distinguishes evidence levels instead of collapsing them into “proved”:

| Label | Meaning |
| --- | --- |
| `NUMERICALLY SUPPORTED` | Approximate or sampled numerical evidence supports a claim within a stated range. |
| `COMPUTATIONALLY VERIFIED` | A recorded machine computation checked a bounded claim or artifact. |
| `SYMBOLICALLY VERIFIED` | A symbolic engine checked the specified transformation or identity. |
| `EXACTLY VERIFIED` | Exact arithmetic or an exact rerunnable witness checked the stated claim. |
| `FORMALLY VERIFIED` | An external proof assistant has accepted a faithful formalization. The current app does not automatically emit this level. |
| `LLM ASSESSED ONLY` | A model judged the statement; no independent machine or formal evidence establishes it. |

A candidate proof remains uncertain when a critical step is invalid, unresolved, requires a missing lemma, or lacks the required computation/formalization. See [Verification policy](docs/VERIFICATION.md).

## Features

- Chinese-first UI with an English language option.
- Autonomous stages for formalization, planning, exploration, experiments, pattern discovery, lemma generation, proof attempts, critique, verification, synthesis, replanning, and checkpoints.
- Configurable iteration, wall-clock, branch, tool-time, provider-time, and checkpoint budgets.
- Typed research nodes, graph edges, evidence records, proof documents, and per-step review status.
- Reproducible exact counterexample stress tests with bundled synthetic demo cases.
- OpenAI-compatible `/chat/completions` transport with bounded retries, SSE normalization, tool-call handling, reasoning-content compatibility, and structured-JSON recovery.
- Local Markdown/LaTeX report export and JSON counterexample evidence export.
- Restart recovery that converts interrupted runs to a resumable paused checkpoint.

The [changelog](CHANGELOG.md) records the implemented release history. Roadmap ideas are not presented as shipped features.

## Architecture

```text
React + TypeScript renderer
        │ typed preload API
Electron main process
        ├── SQLite project and checkpoint store
        ├── research orchestrator and provider adapter
        ├── safeStorage credential wrapper
        └── isolated Python worker → SymPy / NumPy / SciPy / optional Z3
```

The renderer runs with context isolation, no Node integration, Electron sandboxing, denied popup windows, and a narrow preload bridge. Detailed module and trust-boundary notes are in [Architecture](docs/ARCHITECTURE.md).

## Supported platform

The packaged application is currently developed and verified for **64-bit Windows 10 and Windows 11**. Other desktop platforms are not release-tested.

## Developer requirements

- Windows 10/11 x64
- Node.js 22 LTS or newer
- npm (included with Node.js)
- Python 3.12 or newer available as `python`
- Python packages from `python/requirements.txt` for development and tests
- Optional external tools: Lean and SageMath executables are currently capability-detected only

## Developer quick start

```powershell
git clone https://gitee.com/lu-chuanyou/math-research-agent.git
cd math-research-agent
npm install
python -m pip install -r python\requirements.txt
npm.cmd run dev
```

`npm.cmd` avoids PowerShell script-policy conflicts on Windows. These commands are for source development; release users should install the self-contained executable above. No `.env` file is required: provider settings and credentials are entered in the application UI.

Create a project, enter the question and constraints, choose **Autonomous research** or a stress-test mode, then start the run. A local coordinator works without a network credential but deliberately leaves unsupported mathematical claims unverified.

## Provider setup

Open **Settings** and select **OpenAI-compatible API**, then provide:

- **Base URL** — for example, `https://api.deepseek.com`;
- **API key** — a valid credential supplied by you;
- **Model** — a chat-completion model available to your account;
- **Provider HTTP timeout** — independent from the mathematical-tool timeout.

The connection test sends a minimal, non-streaming `POST /chat/completions` request and requires a real model response. Provider capabilities vary: tool calling, reasoning fields, structured JSON, quotas, and error formats are not uniform. See [Provider guide](docs/PROVIDERS.md).

Never commit credentials. This project is not an official client for any model provider, and users are responsible for lawful access and applicable provider terms.

## Research workflow

```text
Conjecture → Formalize → Plan → Explore → Experiment → Pattern/Lemma
          → Proof attempt → Critique → Symbolic/Formal checks
          → Synthesize → Replan or Checkpoint → Resume/Complete
```

Transitions are dynamic. A verified counterexample can shorten the path; missing evidence or proof gaps can trigger reflection and replanning. Checkpoints store the next stage so completed expensive steps are not intentionally replayed after pause or restart.

## Tool execution

The Python worker uses `python -I`, a per-project workspace, JSON-only input/output, input schemas, an AST allowlist, restricted builtins/imports, and a configurable timeout. It supports mathematical operations rather than arbitrary shell execution.

**This is defense in depth, not a perfect OS-level sandbox.** Python and native scientific packages are complex. Do not run untrusted model-generated code on a machine where process-level compromise would be unacceptable. See [Security policy](SECURITY.md).

## Data and privacy

- Project records, settings, checkpoints, evidence, proof attempts, and research history are stored locally in the Electron user-data directory, currently `%APPDATA%\math-research-agent\research.sqlite3` on Windows.
- Provider credentials are encrypted through Electron `safeStorage` when Windows secure storage is available; the encrypted value is stored in the local database.
- A provider run sends the project question, goal, background, known results, constraints, current specification, recent steps, proof/evidence context, and selected source excerpts to the configured API.
- Imported files are copied to local user data. Text/Markdown/LaTeX excerpts may be included in provider context; PDF bytes are not automatically uploaded and this release does not perform PDF OCR.
- Rotating provider debug logs contain response status, schema information, and redacted model response content. They can still contain sensitive research text even though credential patterns are filtered.

Read [Privacy](docs/PRIVACY.md) before using confidential research or third-party documents.

## Building

Create production renderer and Electron bundles:

```powershell
npm.cmd run build
```

Prepare the pinned Windows runtime and create a self-contained x64 NSIS installer in the ignored `release/` directory:

```powershell
npm.cmd run dist
```

`npm run dist` verifies and downloads the official CPython embeddable ZIP and fixed Windows wheels when they are not cached. The current installer is not configured with a public trusted-publisher code-signing certificate. Publish installers through release attachments, not the source branch. See [Release process](docs/RELEASE.md).

## Testing

All public tests use synthetic temporary data and require no real API key:

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
```

After `npm.cmd run dist`, run the packaged smoke test with:

```powershell
npm.cmd run test:packaged
```

Provider E2E uses a local mock HTTP server. Tests against a real paid provider are intentionally excluded from public CI.

## Current limitations

- Source development uses the developer's configured Python. The Windows installer bundles CPython 3.12.10, SymPy, NumPy, SciPy, and Z3.
- Lean and SageMath are detected but are not yet invoked as full proof adapters.
- Imported PDFs are stored locally without OCR or semantic indexing.
- Source excerpts are simple bounded text slices, not a citation-grade retrieval system.
- The restricted Python worker is not an OS-level sandbox.
- Provider compatibility varies, and model output can remain malformed or mathematically wrong after bounded recovery.
- The Windows installer has no configured public code-signing identity.
- Only Windows x64 is release-tested.

## Research reproducibility

The application records experiment/tool inputs, code, outputs, environment strings, durations, evidence links, model name, token use, proof reviews, and checkpoint state. For reproducible public results:

1. include random seeds explicitly in experiment code or inputs—the app does not inject them automatically;
2. record provider/model, application version, budgets, assumptions, and search bounds;
3. export the witness and rerunnable computation;
4. distinguish bounded computation from a universally quantified proof;
5. independently review every critical proof step.

A safe synthetic example is provided in [`examples/divisibility-by-30.json`](examples/divisibility-by-30.json).

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. By contributing, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Do not file public issues containing API keys, private research, exploit details, or raw provider logs. Follow [SECURITY.md](SECURITY.md).

## Disclaimer

This software is a research tool. Model-generated mathematical arguments may contain errors. Computational evidence does not establish a theorem unless the relevant logical claim is independently justified.

## License

Licensed under the [Apache License 2.0](LICENSE). Third-party components retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
