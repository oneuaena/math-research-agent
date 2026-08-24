from __future__ import annotations

import base64
import copy
import hashlib
import json
import os
import plistlib
import shutil
import stat
import subprocess
import sys
import tarfile
import zipfile
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "runtime" / "cache" / "macos"
RELEASE = ROOT / "release"
APP_NAME = "Math Research Agent"
VERSION = "1.2.0"
ELECTRON_VERSION = "43.3.0"
EXPECTED_ELECTRON = {
    "arm64": "ee939d1564d83d61032b3b3cb23af4e46005a4900c91f0695f7ed793f0ce6e83",
    "x64": "7347bbd5fb529eea64f9c2d148bb1c19222d98946ff234ffe27953a1bbcb9dae",
}
EXPECTED_CANVAS_INTEGRITY = {
    "arm64": "O64APRTXRUiAz0P8gErkfEr3lipLJgM6pjATwavZ22ebhjYl/SUbpgM0xcWPQBNMP1n29afAC/Us5PX1vg+JNQ==",
    "x64": "FqqSU7qFce0Cp3pwnTjVkKjjOtxMqRe6lmINxpIZYaZNnVI0H5FtsaraZJ36SiTHNjZlUB69/HhxNDT1Aaa9vA==",
}
CPU_NAMES = {0x0100000C: "arm64", 0x01000007: "x64"}


def digest(path: Path, algorithm: str = "sha256") -> str:
    hasher = hashlib.new(algorithm)
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def sha512_base64(path: Path) -> str:
    return base64.b64encode(hashlib.sha512(path.read_bytes()).digest()).decode("ascii")


def ensure_download(path: Path, url: str, expected: str, algorithm: str = "sha256") -> None:
    actual = digest(path, algorithm) if path.exists() and algorithm != "sha512-base64" else sha512_base64(path) if path.exists() else ""
    if actual == expected:
        return
    subprocess.run([sys.executable, str(ROOT / "scripts" / "download-with-ranges.py"), url, str(path)], check=True)
    actual = digest(path, algorithm) if algorithm != "sha512-base64" else sha512_base64(path)
    if actual != expected:
        raise RuntimeError(f"download checksum mismatch: {path.name}")


def zip_info(name: str, source: Path, mode: int) -> zipfile.ZipInfo:
    stamp = datetime.fromtimestamp(source.stat().st_mtime)
    info = zipfile.ZipInfo(name, (stamp.year, stamp.month, stamp.day, stamp.hour, stamp.minute, stamp.second))
    info.create_system = 3
    info.external_attr = (stat.S_IFREG | mode) << 16
    info.compress_type = zipfile.ZIP_DEFLATED
    return info


def add_file(destination: zipfile.ZipFile, source: Path, name: str, mode: int = 0o644) -> None:
    info = zip_info(name, source, mode)
    with source.open("rb") as input_file, destination.open(info, "w", force_zip64=True) as output_file:
        shutil.copyfileobj(input_file, output_file, length=1024 * 1024)


def add_tree(destination: zipfile.ZipFile, source: Path, prefix: str, excluded_parts: set[str] | None = None) -> None:
    excluded_parts = excluded_parts or set()
    for path in sorted(source.rglob("*")):
        if not path.is_file() or any(part in excluded_parts for part in path.relative_to(source).parts):
            continue
        relative = path.relative_to(source).as_posix()
        executable = relative.startswith("bin/") or path.suffix.lower() in {".so", ".dylib", ".node"}
        add_file(destination, path, f"{prefix}/{relative}", 0o755 if executable else 0o644)


def add_canvas(destination: zipfile.ZipFile, archive: Path, arch: str, prefix: str) -> str:
    actual_integrity = base64.b64encode(hashlib.sha512(archive.read_bytes()).digest()).decode("ascii")
    if actual_integrity != EXPECTED_CANVAS_INTEGRITY[arch]:
        raise RuntimeError(f"canvas integrity mismatch for {arch}")
    with tarfile.open(archive, "r:gz") as source:
        for member in source.getmembers():
            if not member.isfile() or not member.name.startswith("package/"):
                continue
            relative = member.name.removeprefix("package/")
            name = f"{prefix}/{relative}"
            info = zipfile.ZipInfo(name)
            info.create_system = 3
            mode = 0o755 if relative.endswith(".node") else 0o644
            info.external_attr = (stat.S_IFREG | mode) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            extracted = source.extractfile(member)
            if extracted is None:
                raise RuntimeError(f"cannot extract {member.name}")
            with extracted, destination.open(info, "w", force_zip64=True) as output:
                shutil.copyfileobj(extracted, output, length=1024 * 1024)
    return actual_integrity


def macho_arches(data: bytes) -> list[str]:
    if len(data) < 8:
        return []
    magic = data[:4]
    if magic in {b"\xcf\xfa\xed\xfe", b"\xce\xfa\xed\xfe"}:
        cpu = int.from_bytes(data[4:8], "little")
        return [CPU_NAMES.get(cpu, hex(cpu))]
    if magic in {b"\xfe\xed\xfa\xcf", b"\xfe\xed\xfa\xce"}:
        cpu = int.from_bytes(data[4:8], "big")
        return [CPU_NAMES.get(cpu, hex(cpu))]
    if magic in {b"\xca\xfe\xba\xbe", b"\xca\xfe\xba\xbf"}:
        count = int.from_bytes(data[4:8], "big")
        stride = 24 if magic.endswith(b"\xbf") else 20
        return [CPU_NAMES.get(int.from_bytes(data[8 + index * stride:12 + index * stride], "big"), "unknown") for index in range(count)]
    if magic in {b"\xbe\xba\xfe\xca", b"\xbf\xba\xfe\xca"}:
        count = int.from_bytes(data[4:8], "little")
        stride = 24 if magic.startswith(b"\xbf") else 20
        return [CPU_NAMES.get(int.from_bytes(data[8 + index * stride:12 + index * stride], "little"), "unknown") for index in range(count)]
    return []


def macho_dependencies(data: bytes) -> list[str]:
    if data[:4] not in {b"\xcf\xfa\xed\xfe", b"\xce\xfa\xed\xfe"} or len(data) < 32:
        return []
    header_size = 32 if data[:4] == b"\xcf\xfa\xed\xfe" else 28
    command_count = int.from_bytes(data[16:20], "little")
    cursor = header_size
    dependencies: list[str] = []
    # LC_ID_DYLIB (0x0D) names the binary itself; it is not a path loaded at runtime.
    dylib_commands = {0x0C, 0x18, 0x1F, 0x23}
    for _ in range(command_count):
        if cursor + 8 > len(data):
            break
        command = int.from_bytes(data[cursor:cursor + 4], "little") & 0x7FFFFFFF
        command_size = int.from_bytes(data[cursor + 4:cursor + 8], "little")
        if command_size < 8 or cursor + command_size > len(data):
            break
        if command in dylib_commands:
            name_offset = int.from_bytes(data[cursor + 8:cursor + 12], "little")
            start = cursor + name_offset
            end = data.find(b"\0", start, cursor + command_size)
            if start < cursor + command_size and end != -1:
                dependencies.append(data[start:end].decode("utf-8", errors="replace"))
        cursor += command_size
    return dependencies


def build(arch: str) -> dict[str, object]:
    electron_zip = CACHE / f"electron-v{ELECTRON_VERSION}-darwin-{arch}.zip"
    ensure_download(
        electron_zip,
        f"https://github.com/electron/electron/releases/download/v{ELECTRON_VERSION}/electron-v{ELECTRON_VERSION}-darwin-{arch}.zip",
        EXPECTED_ELECTRON[arch],
    )
    runtime = ROOT / "runtime" / f"mac-{arch}" / "python"
    manifest = json.loads((runtime / "RUNTIME_MANIFEST.json").read_text(encoding="utf-8"))
    if manifest["architecture"] != f"darwin-{arch}":
        raise RuntimeError(f"runtime architecture mismatch for {arch}")
    canvas_archive = CACHE / f"napi-rs-canvas-darwin-{arch}-0.1.80.tgz"
    ensure_download(
        canvas_archive,
        f"https://registry.npmjs.org/@napi-rs/canvas-darwin-{arch}/-/canvas-darwin-{arch}-0.1.80.tgz",
        EXPECTED_CANVAS_INTEGRITY[arch],
        "sha512-base64",
    )
    subprocess.run(["node", str(ROOT / "scripts" / "prepare-macos-asar.mjs"), "--arch", arch], check=True)
    app_asar = RELEASE / "mac-asars" / arch / "app.asar"
    app_asar_unpacked = RELEASE / "mac-asars" / arch / "app.asar.unpacked"
    asar_hash = digest(app_asar)
    output = RELEASE / f"Math-Research-Agent-{VERSION}-mac-{arch}.zip"
    app_prefix = f"{APP_NAME}.app/Contents"
    with zipfile.ZipFile(electron_zip, "r") as source, zipfile.ZipFile(output, "w", allowZip64=True) as destination:
        for original in source.infolist():
            if original.filename == "Electron.app/Contents/Resources/default_app.asar":
                continue
            renamed = original.filename.replace("Electron.app/", f"{APP_NAME}.app/", 1)
            if renamed == f"{app_prefix}/MacOS/Electron":
                renamed = f"{app_prefix}/MacOS/{APP_NAME}"
            info = copy.copy(original)
            info.filename = renamed
            if original.filename == "Electron.app/Contents/Info.plist":
                plist = plistlib.loads(source.read(original))
                plist.update({
                    "CFBundleExecutable": APP_NAME,
                    "CFBundleIdentifier": "com.mathresearch.agent",
                    "CFBundleName": APP_NAME,
                    "CFBundleDisplayName": APP_NAME,
                    "CFBundleShortVersionString": VERSION,
                    "CFBundleVersion": VERSION,
                    "LSApplicationCategoryType": "public.app-category.education",
                    "LSMinimumSystemVersion": "13.0",
                    "ElectronAsarIntegrity": {"Resources/app.asar": {"algorithm": "SHA256", "hash": asar_hash}},
                })
                data = plistlib.dumps(plist, fmt=plistlib.FMT_BINARY, sort_keys=False)
                destination.writestr(info, data)
            else:
                with source.open(original) as input_file, destination.open(info, "w", force_zip64=True) as output_file:
                    shutil.copyfileobj(input_file, output_file, length=1024 * 1024)

        resources = f"{app_prefix}/Resources"
        add_file(destination, app_asar, f"{resources}/app.asar")
        add_tree(destination, app_asar_unpacked, f"{resources}/app.asar.unpacked")
        add_tree(destination, ROOT / "python", f"{resources}/python")
        add_tree(destination, runtime, f"{resources}/runtime/python")
        licenses = RELEASE / "win-unpacked" / "resources" / "licenses"
        if licenses.exists():
            add_tree(destination, licenses, f"{resources}/licenses")
    return validate(output, arch, asar_hash, manifest)


def validate(output: Path, arch: str, asar_hash: str, manifest: dict[str, object]) -> dict[str, object]:
    app_prefix = f"{APP_NAME}.app/Contents"
    expected_entries = {
        "main": f"{app_prefix}/MacOS/{APP_NAME}",
        "framework": f"{app_prefix}/Frameworks/Electron Framework.framework/Versions/A/Electron Framework",
        "plist": f"{app_prefix}/Info.plist",
        "asar": f"{app_prefix}/Resources/app.asar",
        "python": f"{app_prefix}/Resources/runtime/python/bin/python3.12",
        "manifest": f"{app_prefix}/Resources/runtime/python/RUNTIME_MANIFEST.json",
        "canvas": f"{app_prefix}/Resources/app.asar.unpacked/node_modules/@napi-rs/canvas-darwin-{arch}/skia.darwin-{arch}.node",
    }
    with zipfile.ZipFile(output, "r") as archive:
        names = set(archive.namelist())
        missing = [name for name in expected_entries.values() if name not in names]
        if missing:
            raise RuntimeError(f"missing macOS package entries: {missing}")
        if any("canvas-win32" in name or name.endswith("python.exe") for name in names):
            raise RuntimeError(f"Windows native artifact leaked into {arch} package")
        plist = plistlib.loads(archive.read(expected_entries["plist"]))
        if plist["CFBundleExecutable"] != APP_NAME or plist["CFBundleShortVersionString"] != VERSION or plist["LSMinimumSystemVersion"] != "13.0":
            raise RuntimeError(f"invalid Info.plist for {arch}")
        if plist["ElectronAsarIntegrity"]["Resources/app.asar"]["hash"] != asar_hash:
            raise RuntimeError(f"asar integrity metadata mismatch for {arch}")
        if hashlib.sha256(archive.read(expected_entries["asar"])).hexdigest() != asar_hash:
            raise RuntimeError(f"embedded app.asar mismatch for {arch}")
        permission_checks = {key: (archive.getinfo(expected_entries[key]).external_attr >> 16) & 0o777 for key in ("main", "python")}
        if any((mode & 0o111) == 0 for mode in permission_checks.values()):
            raise RuntimeError(f"missing executable permission for {arch}: {permission_checks}")
        native_candidates = {
            "main": expected_entries["main"],
            "framework": expected_entries["framework"],
            "python": expected_entries["python"],
            "canvas": expected_entries["canvas"],
            "numpy": next(name for name in names if "numpy/_core/_multiarray_umath" in name and name.endswith(".so")),
            "scipy": next(name for name in names if "scipy/special/_ufuncs." in name and name.endswith(".so")),
            "z3": next(name for name in names if name.endswith("z3/lib/libz3.dylib")),
        }
        architectures = {}
        dependencies = {}
        for label, name in native_candidates.items():
            with archive.open(name) as binary:
                header = binary.read(4 * 1024 * 1024)
                detected = macho_arches(header)
            if arch not in detected:
                raise RuntimeError(f"{label} has wrong architecture in {arch} package: {detected}")
            architectures[label] = detected
            linked = macho_dependencies(header)
            unsafe = [item for item in linked if item.startswith('/') and not item.startswith(('/System/Library/', '/usr/lib/'))]
            if unsafe:
                raise RuntimeError(f"{label} has non-portable dynamic dependencies in {arch} package: {unsafe}")
            dependencies[label] = linked
        symlinks = sum(1 for info in archive.infolist() if stat.S_IFMT(info.external_attr >> 16) == stat.S_IFLNK)
        if symlinks < 5:
            raise RuntimeError(f"Electron framework symlinks were not preserved for {arch}")
        bundled_manifest = json.loads(archive.read(expected_entries["manifest"]))
        if bundled_manifest != manifest:
            raise RuntimeError(f"runtime manifest changed during packaging for {arch}")
    return {
        "arch": arch,
        "output": str(output),
        "sha256": digest(output),
        "bytes": output.stat().st_size,
        "electronSha256": EXPECTED_ELECTRON[arch],
        "appAsarSha256": asar_hash,
        "permissions": permission_checks,
        "architectures": architectures,
        "dynamicDependencies": dependencies,
        "frameworkSymlinks": symlinks,
        "runtime": manifest,
        "unsigned": True,
        "hostExecution": "not-run-windows-host",
    }


def main() -> None:
    results = [build("arm64"), build("x64")]
    report = RELEASE / "mac-build-validation.json"
    report.write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"MACOS_ZIPS_READY {json.dumps(results, ensure_ascii=False)}")


if __name__ == "__main__":
    main()
