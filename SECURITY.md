# Security Policy

## Supported versions

Security fixes are applied to the latest `1.1.x` source and release line. Older development builds may not receive backports.

## Reporting a vulnerability

Do not disclose exploit details, API keys, private research, imported documents, database contents, or provider logs in a public issue.

Use the repository host's private vulnerability-reporting feature when it is enabled (for a GitHub mirror, use a private Security Advisory). If no private channel is available, open a public issue containing only a request for a private maintainer contact channel. Do not include the vulnerability details until a private channel is established.

Include, when safe:

- affected version and Windows version;
- impact and attack prerequisites;
- minimal reproduction using synthetic data;
- affected component and suggested mitigation;
- whether credentials or private data may have been exposed.

Maintainers should acknowledge a complete private report, reproduce it without using reporter secrets, coordinate a fix and disclosure window, and credit the reporter when requested. No fixed response SLA is promised by this volunteer project.

## Security-sensitive areas

Reports are especially important for:

- API-key or Authorization-header leakage;
- safeStorage misuse or credential exposure across IPC;
- prompt/tool injection that crosses the declared tool boundary;
- arbitrary Python, shell, PowerShell, subprocess, network, or filesystem execution;
- path traversal in imports, exports, runtime extraction, or workspaces;
- Electron preload/IPC privilege escalation;
- malicious imported documents or unsafe parsing;
- provider-response/log redaction failures;
- dependency or packaged-runtime vulnerabilities.

## Security model and non-goals

The renderer uses context isolation, no Node integration, Electron sandboxing, and a narrow preload bridge. The Python worker uses isolated UTF-8 mode, schemas, an AST allowlist, restricted builtins/imports, a per-project workspace, time and output limits, and separated protocol/program streams. Native Lean execution uses a no-shell argument array plus a restrictive source policy; Z3 receives bounded SMT-LIB input. Exact inputs and redacted outputs are retained for audit.

These controls reduce risk but are **not a perfect OS-level sandbox**. Model output and imported content remain untrusted. Do not use the application for secrets whose exposure would be catastrophic, and do not assume mathematical or code output is safe merely because it was model-generated.

## Credential hygiene

Credentials must never be committed, pasted into issues, or included in logs. If a real credential reaches Git history or a public artifact, remove it from the artifact and history as needed, revoke/rotate it at the provider, and audit usage. Deleting the current file alone is not sufficient.
