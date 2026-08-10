# Bundled Windows Python runtime

`npm run runtime:prepare` creates the ignored `runtime/python/` directory from the official 64-bit CPython 3.12.10 embeddable distribution and installs the pinned packages in `python/requirements-bundled.txt`.

The build script verifies the upstream ZIP SHA-256 before extraction. Generated runtime binaries are release inputs, not source-controlled files. Electron Builder copies them outside `app.asar` to `resources/runtime/python`, where the packaged application resolves `python.exe` without consulting the system `PATH`.

Requirements for preparing the runtime:

- Windows x64;
- a build-time Python 3.12 interpreter with pip;
- network access to python.org and the configured Python package index.

Run `npm run test:bundled-python` after preparation. The smoke test removes the system Python from `PATH` and validates Python, SymPy, arithmetic, factorization, and Z3 through the real worker.
