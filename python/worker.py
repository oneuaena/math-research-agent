"""Restricted JSON-in/JSON-out mathematical tool worker."""

from __future__ import annotations

import ast
import json
import math
import shutil
import sys
import traceback


ALLOWED_IMPORTS = {"math", "sympy", "numpy", "scipy"}
BLOCKED_NAMES = {"open", "exec", "eval", "compile", "input", "help", "breakpoint", "__import__"}
BLOCKED_ATTRS = {"system", "popen", "spawn", "fork", "remove", "unlink", "rmdir", "chdir", "socket", "connect"}


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


def run_python(data: dict) -> str:
    source = str(data.get("code", ""))
    if len(source) > 20000:
        raise ValueError("Code exceeds the 20,000 character limit.")
    validate_code(source)
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
    exec(compile(source, "<research-experiment>", "exec"), namespace, namespace)
    result = namespace.get("result")
    return str(result) if result is not None else "Completed. Set `result` to return a value."


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


def z3_check(data: dict) -> str:
    try:
        import z3
    except Exception as exc:
        raise ValueError("Z3 is optional and is not installed in the configured Python environment.") from exc
    smt2 = str(data.get("smt2", ""))
    if not smt2 or len(smt2) > 50000:
        raise ValueError("Provide an SMT-LIB2 script no longer than 50,000 characters.")
    solver = z3.Solver()
    solver.add(z3.parse_smt2_string(smt2))
    status = solver.check()
    model = str(solver.model()) if status == z3.sat else ""
    return json.dumps({"status": str(status), "model": model}, ensure_ascii=False)


def main() -> None:
    request = json.loads(sys.stdin.read())
    tool = request.get("name")
    data = request.get("input", {})
    if tool == "run_python":
        output = run_python(data)
    elif tool == "capability_check":
        output = capabilities()
    elif tool == "z3_check":
        output = z3_check(data)
    else:
        output = symbolic(tool, data)
    try:
        import sympy as sp
        environment = f"Python {sys.version.split()[0]}; SymPy {sp.__version__}; isolated worker"
    except Exception:
        environment = f"Python {sys.version.split()[0]}; isolated worker"
    print(json.dumps({"ok": True, "output": output, "environment": environment}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc), "technical": traceback.format_exc(limit=3)}, ensure_ascii=False))
