# Contributing to Math Research Agent

Thank you for helping improve a research tool where correctness, reproducibility, privacy, and explicit uncertainty matter more than persuasive output.

## Development environment

Use Windows 10/11 x64, Node.js 22+, npm, and Python 3.12+. Install the source dependencies with:

```powershell
npm install
python -m pip install -r python\requirements.txt
npm.cmd run dev
```

No real model credential is needed for unit or E2E tests. Never add one to a fixture, script, screenshot, log, issue, or commit.

## Branch and pull-request workflow

1. Create a focused branch from the current default branch.
2. Keep changes scoped; separate refactors from behavior changes when practical.
3. Add tests for new behavior and failure paths.
4. Update both `README.md` and `README.zh-CN.md` when user-facing setup or limitations change.
5. Run the required checks and review your diff for generated files and secrets.
6. Open a pull request explaining the problem, design, evidence, risks, and validation boundary.

Required checks:

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run test:formal-tools
npm.cmd run build
npm.cmd run test:e2e
```

Changes to the self-contained Windows runtime must also run:

```powershell
npm.cmd run runtime:prepare
npm.cmd run test:bundled-python
npm.cmd run dist
npm.cmd run test:packaged-runtime
```

## Adding a provider

- Keep credentials in the Electron main process and protect them with `safeStorage`; never expose them through the preload API.
- Require HTTPS except for explicit loopback development endpoints.
- Separate HTTP transport parsing from model-generated structured JSON parsing.
- Normalize text, reasoning, tool calls, and provider-specific response shapes into the internal protocol.
- Bound timeouts, retries, recovery requests, output sizes, and tool loops.
- Map authentication, quota, rate-limit, server, DNS, TLS, timeout, abort, and malformed-response failures distinctly.
- Log only redacted diagnostics. Tests must use local mock servers and placeholder credentials.

## Adding a tool adapter

- Define a strict input schema and an explicit output/evidence contract.
- Do not add arbitrary shell, PowerShell, `cmd.exe`, unrestricted subprocess, network, or filesystem access.
- Treat all model-generated arguments as untrusted input.
- Add time, input, output, and workspace limits.
- Record executable version, inputs, outputs, and verification scope.
- Capability detection is not verification. A detected Lean or SageMath executable does not prove a statement.
- A Lean adapter must retain exact source and kernel output, reject unsound placeholders or execution escapes, and never equate kernel acceptance with faithful natural-language formalization without an explicit reviewed target link.
- A Z3 adapter must preserve the submitted encoding, bounds, timeout, solver status, model only for `SAT`, and reason for `UNKNOWN`; it must not promote solver status to a theorem proof.

## Database migrations

- Never edit an already released migration in place.
- Add a monotonically increasing migration that is safe on existing user databases.
- Preserve projects, credentials, provider settings, research history, and checkpoint cursors.
- Test both a fresh database and an upgrade fixture made entirely from synthetic data.
- Do not commit a real SQLite database.

## Security and privacy

Before committing, search the full diff for API keys, tokens, passwords, local paths, email addresses, imported documents, logs, SQLite files, safeStorage values, and user research. Keep generated runtime binaries, installers, source maps, caches, and test profiles ignored.

Report vulnerabilities according to [SECURITY.md](SECURITY.md).

## Mathematical verification principles

- **Do not label LLM judgment as a verified proof.**
- `SURVIVED TESTING` is bounded negative evidence, not a theorem.
- Numerical evidence must record precision, range, tolerances, and seed where applicable.
- Computational and symbolic claims must retain rerunnable inputs and outputs.
- Exact counterexamples must recheck assumptions and the failed conclusion independently.
- Formal verification requires a faithful formalization accepted by a proof assistant; adapter availability alone is insufficient.
- Every critical proof step must remain uncertain until independently justified.

See [docs/VERIFICATION.md](docs/VERIFICATION.md) for the evidence-level contract.

## License

Unless explicitly stated otherwise, contributions intentionally submitted to this repository are accepted under the [Apache License 2.0](LICENSE).
