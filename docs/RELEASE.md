# Release Process

## 1. Choose the version

- Confirm the intended semantic version and that the tag does not already exist locally or remotely.
- Update `package.json`, `package-lock.json`, `CHANGELOG.md`, both READMEs, and release notes.
- Never move or force-overwrite a published tag.

## 2. Audit source and dependencies

- Review `git status`, tracked files, ignored files, and recent history.
- Scan for credentials, local paths, logs, SQLite/user data, imports, source maps, installers, and large artifacts.
- Run `npm audit` and review bundled Python package notices.
- Keep `runtime/python`, `runtime/cache`, `release`, compiled bundles, and test profiles out of Git.

## 3. Validate source

```powershell
npm.cmd ci
python -m pip install -r python\requirements.txt
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
```

## 4. Prepare the self-contained runtime

```powershell
npm.cmd run runtime:prepare
npm.cmd run test:bundled-python
```

The preparation script downloads the official CPython 3.12.10 x64 embeddable ZIP, verifies its fixed SHA-256, obtains exact PyPI wheels and verifies PyPI SHA-256 metadata, then installs them offline into `runtime/python`.

## 5. Build and smoke-test

```powershell
npm.cmd run dist
npm.cmd run test:packaged
npm.cmd run test:packaged-runtime
```

Also install the NSIS executable over an existing synthetic/real local 1.0 profile, verify user-data preservation, and rerun `test:packaged-runtime` against the installed executable with system Python removed from `PATH`.

Record installer and unpacked sizes and calculate:

```powershell
Get-FileHash -Algorithm SHA256 .\release\Math-Research-Agent-Setup-<version>.exe
```

Replace all release-note checksum/size placeholders before committing.

## 6. Commit, tag, and publish

1. Confirm tests, final scans, and `git diff`.
2. Commit the release preparation.
3. Create an annotated `v<version>` tag.
4. Push the source branch normally; do not force push.
5. Push the tag normally.
6. Create a repository Release from the committed notes and upload only the installer (and optional checksum file).
7. Verify the remote asset filename, size, and SHA-256.

The installer is not commercially code-signed. Release notes must disclose the possible SmartScreen “Unknown publisher” warning without instructing users to disable Windows security.
