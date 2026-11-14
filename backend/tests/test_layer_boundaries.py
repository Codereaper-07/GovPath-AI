"""Layer rules: verified knowledge, ingestion and planning never depend on AI code, and the
pure planner core never depends on the database or web framework."""

import ast
from pathlib import Path

import pytest

APP_DIR = Path(__file__).resolve().parents[1] / "app"
AI_PREFIXES = ("app.rag", "app.llm", "google.genai", "google")
PROTECTED_LAYERS = ("knowledge", "workflow", "ingestion")
PURE_PLANNER_MODULES = ("domain.py", "graph.py", "planner.py", "errors.py")
IO_PREFIXES = (
    "sqlalchemy",
    "fastapi",
    "starlette",
    "httpx",
    "app.db",
    "app.models",
    "app.knowledge",
)


def _imports(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(a.name for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.add(node.module)
    return names


def _matching(modules: set[str], prefixes: tuple[str, ...]) -> set[str]:
    return {m for m in modules if any(m == p or m.startswith(p + ".") for p in prefixes)}


@pytest.mark.parametrize("layer", PROTECTED_LAYERS)
def test_protected_layer_has_no_ai_imports(layer: str) -> None:
    files = list((APP_DIR / layer).rglob("*.py"))
    assert files, f"app/{layer} should exist"
    for f in files:
        bad = _matching(_imports(f), AI_PREFIXES)
        assert not bad, f"{f.relative_to(APP_DIR)} imports AI modules: {bad}"


@pytest.mark.parametrize("module", PURE_PLANNER_MODULES)
def test_planner_core_is_pure(module: str) -> None:
    bad = _matching(_imports(APP_DIR / "workflow" / module), IO_PREFIXES)
    assert not bad, f"workflow/{module} must not import I/O layers: {bad}"
