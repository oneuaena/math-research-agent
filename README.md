# Math Research Agent

[English](README.md) | [简体中文](README.zh-CN.md)

**A reproducible, auditable autonomous research workspace for experimental mathematics and conjecture exploration.**

Math Research Agent is a local-first Electron desktop application for organizing model-assisted mathematical exploration. It combines a persistent research tree, structured experiments, proof attempts, skeptical review, evidence labels, budgets, and checkpoint/resume execution in one desktop workspace.

This is an independent open-source project. References to OpenAI-compatible APIs, DeepSeek, OpenAI, Anthropic, Microsoft, Lean, SageMath, or universities describe interoperability only and do not imply affiliation or endorsement.

## Download

### Windows 10/11 x64

- **[Installer (.exe)](https://github.com/oneuaena/math-research-agent/releases/download/v1.2.0/Math-Research-Agent-Setup-1.2.0.exe)** — SHA-256 `A69068335CA208319DB5DE2618E9AF5BF1FD9E5F1BC4D6CD641242BDC142FEA1`
- **[Portable software ZIP](https://github.com/oneuaena/math-research-agent/releases/download/v1.2.0/Math-Research-Agent-1.2.0-Windows-Software.zip)** — SHA-256 `0D4AC83913E7AB9711D808229C00B4B8E1D831FCF7D355E8DC6E12CE64FA9FD7`

### macOS 13 or newer

- **[Apple Silicon (M1/M2/M3/M4/M5)](https://github.com/oneuaena/math-research-agent/releases/download/v1.2.0/Math-Research-Agent-1.2.0-mac-arm64.zip)** — SHA-256 `F702F43B3F9C8944A4B77B03E73EF4F9EDB4E51D32581DB6CCADF87271302341`
- **[Intel Mac](https://github.com/oneuaena/math-research-agent/releases/download/v1.2.0/Math-Research-Agent-1.2.0-mac-x64.zip)** — SHA-256 `F8CDEA34AD4DAA0E542380FF3729B183AC158F27AB714918ADB143452ECB7F51`

On Windows, run the installer or extract the portable ZIP. On macOS, extract the ZIP, drag the app into **Applications**, then open it. After launch, open **Settings**, enter your own provider details, and run **Runtime Diagnostics**.

The installer includes Python 3.12, SymPy, NumPy, SciPy, and Z3. Ordinary users do **not** need Node.js, Python, `npm install`, `pip install`, PATH changes, or administrator access for the default per-user installation.

Windows SmartScreen may show **Unknown publisher** because this independent open-source release does not have a commercial code-signing certificate. macOS packages are also unsigned and unnotarized; first launch may require Control-clicking the app and choosing **Open**. Verify the published SHA-256 and do not disable operating-system security globally.

## Overview

The application can:

- turn a natural-language question into a validated structured specification;
- run a bounded, persistent autonomous research workflow with specialized roles;
- maintain research branches, evidence, failed routes, proof steps, and a proof graph;
- execute restricted Python, SymPy, NumPy, SciPy, bounded Z3 checks, and real Lean 4 kernel checks;
- extract and index text from PDF, DOCX, text, Markdown, and LaTeX sources for bounded research context and source-aware chat;
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
| `FORMALLY VERIFIED` | Lean's kernel accepted the submitted theorem and the app linked it to an independently reviewed proof with an exact matching formalization target. |
| `LLM ASSESSED ONLY` | A model judged the statement; no independent machine or formal evidence establishes it. |

A candidate proof remains uncertain when a critical step is invalid, unresolved, requires a missing lemma, or lacks the required computation/formalization. See [Verification policy](docs/VERIFICATION.md).

## Features

- Chinese-first UI with an English language option.
- Autonomous stages for formalization, planning, exploration, experiments, pattern discovery, lemma generation, proof attempts, critique, verification, synthesis, replanning, and checkpoints.
- Configurable iteration, wall-clock, branch, tool-time, provider-time, and checkpoint budgets.
- Typed research nodes, graph edges, evidence records, proof documents, and per-step review status.
- Reproducible exact counterexample stress tests with bundled synthetic demo cases.
- Project chat with explicit research-control routing and bounded context retrieved from imported documents.
- Local document extraction/chunk indexing plus optional arXiv and Crossref literature search.
- Audited Python, SymPy, Z3, and Lean tool runs with exact input artifacts, separated output/error streams, timeouts, and strict evidence labels.
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
        ├── isolated Python worker → SymPy / NumPy / SciPy / Z3
        └── audited Lean 4 / Lake adapter → kernel acceptance
```

The renderer runs with context isolation, no Node integration, Electron sandboxing, denied popup windows, and a narrow preload bridge. Detailed module and trust-boundary notes are in [Architecture](docs/ARCHITECTURE.md).

## Supported platforms

The packaged application supports **64-bit Windows 10/11** and **macOS 13+** on Apple Silicon or Intel. Windows received dynamic packaged and installed-app tests. The macOS packages received archive, architecture, native-dependency, permission, symlink, and package-content validation on Windows, but were not launched on physical Macs for this release.

## Developer requirements

- Windows 10/11 x64
- Node.js 22 LTS or newer
- npm (included with Node.js)
- Python 3.12 or newer available as `python`
- Python packages from `python/requirements.txt` for development and tests
- Optional external Lean 4 and Lake installation for kernel-checked formal verification; SageMath remains capability-detected only

## Developer quick start

```powershell
git clone https://github.com/oneuaena/math-research-agent.git
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

The Python worker uses `python -I -B -X utf8`, a per-project workspace, a single JSON protocol channel, separate captured program stdout/stderr, input schemas, an AST allowlist, restricted builtins/imports, output limits, and a configurable timeout. The Z3 adapter reports `SAT`, `UNSAT`, or `UNKNOWN` only for the submitted bounded encoding. The Lean adapter invokes real Lake/Lean executables and stores the exact source and kernel output in a local audit artifact.

**This is defense in depth, not a perfect OS-level sandbox.** Python and native scientific packages are complex. Do not run untrusted model-generated code on a machine where process-level compromise would be unacceptable. See [Security policy](SECURITY.md).

## Data and privacy

- Project records, settings, checkpoints, evidence, proof attempts, and research history are stored locally in the Electron user-data directory, currently `%APPDATA%\math-research-agent\research.sqlite3` on Windows.
- Provider credentials are encrypted through Electron `safeStorage` when Windows secure storage is available; the encrypted value is stored in the local database.
- A provider run sends the project question, goal, background, known results, constraints, current specification, recent steps, proof/evidence context, and selected source excerpts to the configured API.
- Imported PDF, DOCX, text, Markdown, and LaTeX files are copied to local user data, text-extracted and chunk-indexed. Only bounded retrieved excerpts may enter provider context; original PDF/DOCX bytes are not uploaded, and image-only PDFs are not OCRed.
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

On Windows, cross-assemble the two self-contained macOS ZIPs with:

```powershell
npm.cmd run dist:mac
```

`npm run dist` verifies and downloads the official CPython embeddable ZIP and fixed Windows wheels when they are not cached. The current installer is not configured with a public trusted-publisher code-signing certificate. Publish installers through release attachments, not the source branch. See [Release process](docs/RELEASE.md).

## Testing

All public tests use synthetic temporary data and require no real API key:

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run test:formal-tools
npm.cmd run build
npm.cmd run test:e2e
```

After `npm.cmd run dist`, run the packaged smoke test with:

```powershell
npm.cmd run test:packaged
npm.cmd run test:packaged-runtime
npm.cmd run test:packaged-autonomy
node scripts/validate-macos-asars.mjs
```

Provider E2E uses a local mock HTTP server. Tests against a real paid provider are intentionally excluded from public CI.

## Current limitations

- Source development uses the developer's configured Python. The Windows installer bundles CPython 3.12.10, SymPy, NumPy, SciPy, and Z3.
- Lean 4/Lake is a real external proof adapter, but it is not bundled; users who need formal checks must install it or configure its path. SageMath remains optional capability detection.
- Imported documents use local text extraction and deterministic chunk retrieval, not OCR, embeddings, or a citation-grade semantic search engine.
- The restricted Python worker is not an OS-level sandbox.
- Provider compatibility varies, and model output can remain malformed or mathematically wrong after bounded recovery.
- The Windows installer has no configured public code-signing identity; the macOS applications are not Developer-ID signed or notarized.
- The macOS packages are statically and structurally validated, not dynamically tested on physical Apple Silicon and Intel Macs for this release.

## Research reproducibility

The application records experiment/tool inputs, code, outputs, environment strings, durations, evidence links, model name, token use, proof reviews, and checkpoint state. For reproducible public results:

1. include random seeds explicitly in experiment code or inputs—the app does not inject them automatically;
2. record provider/model, application version, budgets, assumptions, and search bounds;
3. export the witness and rerunnable computation;
4. distinguish bounded computation from a universally quantified proof;
5. independently review every critical proof step.

A safe synthetic example is provided in [`examples/divisibility-by-30.json`](examples/divisibility-by-30.json).

## ES(7) case-study status

The included application state can support long-running exploration of an Erdős–Szekeres `ES(7)` project, but the project is **ongoing**. Computations, refuted intermediate criteria, bounded searches, and model arguments are retained as research evidence; none of them is presented as a proof of the open target. Resume preserves the existing checkpoint and proceeds from its stored next stage.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. By contributing, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Do not file public issues containing API keys, private research, exploit details, or raw provider logs. Follow [SECURITY.md](SECURITY.md).

## Disclaimer

This software is a research tool. Model-generated mathematical arguments may contain errors. Computational evidence does not establish a theorem unless the relevant logical claim is independently justified.

## License

Licensed under the [Apache License 2.0](LICENSE). Third-party components retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
