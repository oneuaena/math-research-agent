"""Restricted JSON-in/JSON-out mathematical tool worker."""

from __future__ import annotations

import ast
import contextlib
import io
import json
import math
import shutil
import sys
import traceback


if hasattr(sys.stdin, "reconfigure"):
    sys.stdin.reconfigure(encoding="utf-8", errors="strict")
    sys.stdout.reconfigure(encoding="utf-8", errors="strict")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


ALLOWED_IMPORTS = {"math", "sympy", "numpy", "scipy"}
BLOCKED_NAMES = {"open", "exec", "eval", "compile", "input", "help", "breakpoint", "__import__"}
BLOCKED_ATTRS = {"system", "popen", "spawn", "fork", "remove", "unlink", "rmdir", "chdir", "socket", "connect"}
MAX_CAPTURE_CHARACTERS = 2_000_000


class OutputLimitExceeded(RuntimeError):
    """Raised before model-generated output can exhaust worker memory."""


class LimitedTextBuffer(io.StringIO):
    def write(self, value: str) -> int:
        if self.tell() + len(value) > MAX_CAPTURE_CHARACTERS:
            raise OutputLimitExceeded(f"Program output exceeded {MAX_CAPTURE_CHARACTERS:,} characters.")
        return super().write(value)


def validate_code(source: str) -> None:
    tree = ast.parse(source, mode="exec")
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            names = [alias.name.split(".")[0] for alias in node.names] if isinstance(node, ast.Import) else [(node.module or "").split(".")[0]]
            if any(name not in ALLOWED_IMPORTS for name in names):
                raise ValueError("Only math, SymPy, NumPy, and SciPy imports are allowed.")
        if isinstance(node, ast.Name) and node.id in BLOCKED_NAMES:
            raise ValueError(f"Blocked operation: {node.id}")
        if isinstance(node, ast.Attribute) and node.attr in BLOCKED_ATTRS:
            raise ValueError(f"Blocked operation: {node.attr}")
        if isinstance(node, ast.Attribute) and node.attr.startswith("__"):
            raise ValueError("Dunder attribute access is not allowed.")


def run_python(data: dict) -> dict:
    source = str(data.get("code", ""))
    if len(source) > 20000:
        raise ValueError("Code exceeds the 20,000 character limit.")
    try:
        validate_code(source)
    except Exception as exc:
        return {
            "ok": False,
            "output": "",
            "stdout": "",
            "stderr": traceback.format_exc(),
            "error": str(exc),
            "error_type": "VALIDATION_ERROR",
            "exit_code": 1,
            "verification_status": "PROGRAM_FAILURE",
        }
    def safe_import(name, globals=None, locals=None, fromlist=(), level=0):
        if name.split(".")[0] not in ALLOWED_IMPORTS:
            raise ImportError(f"Import not allowed: {name}")
        return __import__(name, globals, locals, fromlist, level)

    safe_builtins = {
        "abs": abs, "all": all, "any": any, "bool": bool, "dict": dict,
        "enumerate": enumerate, "float": float, "int": int, "len": len,
        "list": list, "max": max, "min": min, "pow": pow, "print": print,
        "range": range, "round": round, "set": set, "str": str, "sum": sum,
        "tuple": tuple, "zip": zip, "__import__": safe_import,
    }
    namespace = {"__builtins__": safe_builtins, "math": math}
    captured_stdout = LimitedTextBuffer()
    captured_stderr = LimitedTextBuffer()
    try:
        with contextlib.redirect_stdout(captured_stdout), contextlib.redirect_stderr(captured_stderr):
            exec(compile(source, "<research-experiment>", "exec"), namespace, namespace)
        result = namespace.get("result")
        stdout = captured_stdout.getvalue()
        output = str(result) if result is not None else stdout.rstrip() or "Completed. Set `result` to return a value."
        return {
            "ok": True,
            "output": output,
            "stdout": stdout,
            "stderr": captured_stderr.getvalue(),
            "error_type": "NONE",
            "exit_code": 0,
            "verification_status": "SUCCESS",
            "verification_level": "BOUNDED_CHECK",
        }
    except OutputLimitExceeded as exc:
        return {
            "ok": False,
            "output": "",
            "stdout": captured_stdout.getvalue(),
            "stderr": captured_stderr.getvalue(),
            "error": str(exc),
            "error_type": "OUTPUT_LIMIT",
            "exit_code": 1,
            "verification_status": "PROGRAM_FAILURE",
        }
    except Exception as exc:
        technical = traceback.format_exc()
        stderr = captured_stderr.getvalue()
        return {
            "ok": False,
            "output": "",
            "stdout": captured_stdout.getvalue(),
            "stderr": f"{stderr}{technical}",
            "error": str(exc),
            "error_type": "PROGRAM_ERROR",
            "exit_code": 1,
            "verification_status": "PROGRAM_FAILURE",
        }


def symbolic(tool: str, data: dict) -> str:
    import sympy as sp

    symbols = {name: sp.Symbol(name) for name in data.get("symbols", ["x"])}
    expression = sp.sympify(str(data.get("expression", "0")), locals=symbols)
    variable = symbols.get(str(data.get("variable", "x")), sp.Symbol(str(data.get("variable", "x"))))
    if tool == "symbolic_simplify":
        return str(sp.simplify(expression))
    if tool == "solve_equation":
        return str(sp.solve(expression, variable))
    if tool == "differentiate":
        return str(sp.diff(expression, variable, int(data.get("order", 1))))
    if tool == "integrate":
        return str(sp.integrate(expression, variable))
    if tool == "matrix_compute":
        matrix = sp.Matrix(data.get("matrix", []))
        operation = data.get("operation", "det")
        operations = {"det": matrix.det, "rank": matrix.rank, "eigenvals": matrix.eigenvals, "inverse": matrix.inv}
        if operation not in operations:
            raise ValueError("Unsupported matrix operation.")
        return str(operations[operation]())
    raise ValueError("Unsupported tool.")


def capabilities() -> str:
    def package(name: str) -> dict:
        try:
            module = __import__(name)
            version = module.get_version_string() if name == "z3" else getattr(module, "__version__", "available")
            return {"available": True, "version": str(version)}
        except Exception:
            return {"available": False, "version": ""}

    def executable(name: str) -> dict:
        path = shutil.which(name)
        return {"available": bool(path), "version": path or ""}

    report = {
        "python": {"available": True, "version": sys.version.split()[0]},
        "sympy": package("sympy"),
        "numpy": package("numpy"),
        "scipy": package("scipy"),
        "z3": package("z3"),
        "lean": executable("lean"),
        "sage": executable("sage"),
    }
    return json.dumps(report, ensure_ascii=False)


def z3_check(data: dict) -> dict:
    try:
        import z3
    except Exception as exc:
        return {
            "ok": False,
            "output": "",
            "stdout": "",
            "stderr": traceback.format_exc(),
            "error": f"Z3 is unavailable: {exc}",
            "error_type": "UNAVAILABLE",
            "exit_code": 1,
            "verification_status": "TOOL_FAILURE",
            "verification_level": "UNKNOWN",
        }
    smt2 = str(data.get("smt2", ""))
    if not smt2 or len(smt2) > 200000:
        raise ValueError("Provide an SMT-LIB2 script no longer than 200,000 characters.")
    timeout_ms = max(1, min(120000, int(data.get("timeoutMs", 10000))))
    solver = z3.Solver()
    solver.set(timeout=timeout_ms)
    solver.add(z3.parse_smt2_string(smt2))
    status = solver.check()
    model = str(solver.model()) if status == z3.sat else ""
    reason_unknown = solver.reason_unknown() if status == z3.unknown else ""
    normalized = "SAT" if status == z3.sat else "UNSAT" if status == z3.unsat else "UNKNOWN"
    output = json.dumps({
        "status": normalized,
        "model": model,
        "reason_unknown": reason_unknown,
        "timeout_ms": timeout_ms,
        "bounded": True,
    }, ensure_ascii=False)
    return {
        "ok": True,
        "output": output,
        "stdout": "",
        "stderr": "",
        "error_type": "NONE",
        "exit_code": 0,
        "verification_status": normalized,
        "verification_level": normalized,
        "reason_unknown": reason_unknown,
    }


def successful(output: str, verification_status: str = "SUCCESS", verification_level: str | None = None) -> dict:
    response = {
        "ok": True,
        "output": output,
        "stdout": "",
        "stderr": "",
        "error_type": "NONE",
        "exit_code": 0,
        "verification_status": verification_status,
    }
    if verification_level:
        response["verification_level"] = verification_level
    return response


def main() -> None:
    request = json.loads(sys.stdin.read())
    tool = request.get("name")
    data = request.get("input", {})
    if tool == "run_python":
        response = run_python(data)
    elif tool == "capability_check":
        response = successful(capabilities())
    elif tool == "z3_check":
        response = z3_check(data)
    else:
        response = successful(symbolic(tool, data), verification_level="SYMBOLIC_CHECK")
    try:
        import sympy as sp
        environment = f"Python {sys.version.split()[0]}; SymPy {sp.__version__}; isolated worker"
    except Exception:
        environment = f"Python {sys.version.split()[0]}; isolated worker"
    response.update({"protocol_version": 2, "environment": environment})
    print(json.dumps(response, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({
            "protocol_version": 2,
            "ok": False,
            "output": "",
            "stdout": "",
            "stderr": traceback.format_exc(),
            "error": str(exc),
            "error_type": "PROGRAM_ERROR",
            "exit_code": 1,
            "verification_status": "PROGRAM_FAILURE",
        }, ensure_ascii=False))
