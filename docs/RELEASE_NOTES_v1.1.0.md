# Math Research Agent v1.1.0

This release strengthens long-running research continuity, document grounding, and machine-verification evidence without resetting existing projects or checkpoints.

## Highlights

- Source-aware project chat and bounded retrieval from imported PDF, DOCX, text, Markdown, and LaTeX documents
- Local chunk indexing plus optional arXiv/Crossref literature discovery
- Correct Python stdout/stderr protocol handling and forced UTF-8 isolated runtime
- Structured Python, SymPy, and Z3 results with strict timeout/error/status distinctions
- Real external Lean 4/Lake kernel checks with exact local audit artifacts
- Conservative proof promotion: kernel acceptance must match the reviewed proof target and all critical proof steps must be valid
- Resume continues from the persisted next stage without discarding prior research

## Epistemic boundary

`SAT`, `UNSAT`, bounded computation, symbolic output, and model agreement do not by themselves prove a natural-language theorem. `FORMALLY VERIFIED` is emitted only under the documented reviewed Lean-link policy. The ongoing ES(7) project remains ongoing; this release does not claim to solve it.

## Windows package

- File: `Math-Research-Agent-Setup-1.1.0.exe`
- Platform: Windows 10/11 x64
- Bundled runtime: CPython 3.12.10, SymPy, NumPy, SciPy, and Z3
- External optional runtime: Lean 4/Lake (tested with Lean 4.32.0)
- SHA-256: `16176D1E9FB42BBD12BAC6E6532C20C76192199B672A1C10307031BE92978FB8`
- Size: `184,115,302 bytes` (about 175.59 MiB)

The installer is not commercially code-signed, so Windows may display an Unknown publisher warning. Verify the checksum and obtain the installer only from the project release location.

## Upgrade and data preservation

Install over an existing per-user installation. The application stores projects, imported sources, credentials, checkpoints, and research history in the Electron user-data directory and does not intentionally remove them during upgrade. Back up important research before any software upgrade.
