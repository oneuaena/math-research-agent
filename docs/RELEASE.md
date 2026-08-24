# Release Process

## 1. Choose the version

- Confirm the intended semantic version and that the tag does not already exist locally or remotely.
- Update `package.json`, `package-lock.json`, `CHANGELOG.md`, both READMEs, and release notes.
- Never move or force-overwrite a published tag.

## 2. Audit source and dependencies

- Review `git status`, tracked files, ignored files, and recent history.
- Scan for credentials, local paths, logs, SQLite/user data, imports, source maps, installers, and large artifacts.
- Run `npm audit` and review bundled Python package notices.
- Keep `runtime/python`, `runtime/mac-*`, `runtime/cache`, `work`, `release`, compiled bundles, and test profiles out of Git.

## 3. Validate source

```powershell
npm.cmd ci
python -m pip install -r python\requirements.txt
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run test:formal-tools
npm.cmd run build
npm.cmd run test:e2e
```

## 4. Prepare the self-contained runtime

```powershell
npm.cmd run runtime:prepare
npm.cmd run test:bundled-python
```

The preparation script downloads the official CPython 3.12.10 x64 embeddable ZIP, verifies its fixed SHA-256, obtains exact PyPI wheels and verifies PyPI SHA-256 metadata, then installs them offline into `runtime/python`. Lean is deliberately external rather than bundled; release validation records the tested Lean/Lake versions and runs `test:formal-tools` when the toolchain is available.

## 5. Build and smoke-test

```powershell
npm.cmd run dist
npm.cmd run test:packaged
npm.cmd run test:packaged-runtime
npm.cmd run test:packaged-autonomy
npm.cmd run dist:mac
node scripts\validate-macos-asars.mjs
```

Also install the NSIS executable over an existing synthetic/real local profile, verify user-data preservation and checkpoint counts, and rerun `test:packaged-runtime` against the installed executable with system Python removed from `PATH`.

Validate both macOS ZIPs for ZIP integrity, architecture-matched Electron/Python/Canvas/scientific native modules, executable modes, framework symlinks, and package-relative/system-only dynamic dependencies. A real macOS launch and Gatekeeper check is still required before describing the macOS packages as dynamically tested.

Record installer, Windows software ZIP, and macOS ZIP sizes and calculate:

```powershell
Get-FileHash -Algorithm SHA256 .\release\Math-Research-Agent-Setup-<version>.exe
Get-FileHash -Algorithm SHA256 .\release\Math-Research-Agent-<version>-mac-arm64.zip
Get-FileHash -Algorithm SHA256 .\release\Math-Research-Agent-<version>-mac-x64.zip
```

Replace all release-note checksum/size placeholders before committing.

## 6. Commit, tag, and publish

1. Confirm tests, final scans, and `git diff`.
2. Commit the release preparation.
3. Create an annotated `v<version>` tag.
4. Push the source branch normally; do not force push.
5. Push the tag normally.
6. Create a repository Release from the committed notes and upload the Windows installer, Windows portable-software ZIP, both macOS architecture ZIPs, and checksum file.
7. Verify the remote asset filename, size, and SHA-256.

The Windows installer is not commercially code-signed. The macOS applications are not Apple-notarized or Developer-ID signed. Release notes must disclose SmartScreen/Gatekeeper warnings without instructing users to disable operating-system security.
