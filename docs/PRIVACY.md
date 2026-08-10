# Data and Privacy

Math Research Agent is local-first, but use of an external model provider sends selected research content to that provider.

## Local data

On Windows, current builds use `%APPDATA%\math-research-agent` for:

- `research.sqlite3` plus SQLite WAL/SHM files;
- project metadata, specifications, sessions, checkpoints, research steps, branches, evidence, proof attempts, settings, and activities;
- imported documents under `documents/<project-id>`;
- per-project Python workspaces under `tool-workspaces`;
- rotating provider response logs under `logs`.

These files are not part of the source repository or installer. They can contain confidential mathematics and personal filenames.

## Provider credentials

The API key is handled in the Electron main process. When Windows secure storage is available, Electron `safeStorage` encrypts it and the encoded encrypted blob is stored in SQLite. The renderer receives only configured/masked status, not the decrypted key.

Encryption at rest does not protect a credential from malware running as the same user or a compromised main process. Remove/rotate a credential if exposure is suspected.

## Data sent to a provider

When an OpenAI-compatible provider is enabled, requests can include:

- project question, goal, background, known results, constraints, and notes;
- structured specification and active branch;
- recent research steps, proof attempts, evidence, failures, and tool results;
- titles and up to a bounded excerpt from imported text sources;
- prompts needed for schema repair or response recovery.

Model responses return through the provider and may be stored in research records and debug logs. Provider privacy, retention, and training policies are controlled by that third party.

## Imported documents

PDF, text, Markdown, and LaTeX files selected by the user are copied locally. Text-like files store a bounded excerpt; PDF bytes are not automatically uploaded and no PDF OCR is performed in v1.0.0. A text excerpt can be sent as provider context during research, so do not import material you are not permitted to process.

## Debug logging

Provider logs record status, Content-Type, endpoint, elapsed time, response schema, and redacted response content. Log rotation limits the active file to about 5 MiB and each entry to about 1 MiB. Key-shaped strings and sensitive field names are filtered, but logs may still contain private prompts, reasoning, results, filenames, or third-party text.

## Clearing local data

1. Exit Math Research Agent.
2. If desired, remove the provider key in Settings before exit.
3. Back up any reports you want to retain.
4. Delete `%APPDATA%\math-research-agent` to remove projects, settings, encrypted credentials, imported documents, tool workspaces, and logs for the current Windows user.

Uninstalling the application may intentionally leave user data for upgrade/reinstall safety. Verify and remove the user-data directory manually when permanent deletion is required.
