"""Dependency-graph helpers built on stdlib graphlib."""

from collections.abc import Iterable, Mapping
from graphlib import CycleError, TopologicalSorter

from app.workflow.errors import DependencyCycleError


def topological_stages(nodes: Iterable[str], deps: Mapping[str, Iterable[str]]) -> list[list[str]]:
    """Group nodes into stages; every node's dependencies are in earlier stages.

    Nodes within a stage are independent (can run in parallel) and sorted for determinism.
    Raises DependencyCycleError if the graph has a cycle.
    """
    sorter: TopologicalSorter[str] = TopologicalSorter()
    for n in nodes:
        sorter.add(n, *deps.get(n, ()))
    try:
        sorter.prepare()
    except CycleError as exc:
        cycle = list(exc.args[1]) if len(exc.args) > 1 else []
        raise DependencyCycleError(cycle) from exc
    stages: list[list[str]] = []
    while sorter.is_active():
        ready = sorted(sorter.get_ready())
        stages.append(ready)
        sorter.done(*ready)
    return stages


def reaches(start: str, target: str, deps: Mapping[str, Iterable[str]]) -> bool:
    """True if `target` is reachable from `start` by following dependency edges."""
    stack, seen = [start], set()
    while stack:
        node = stack.pop()
        if node == target:
            return True
        if node in seen:
            continue
        seen.add(node)
        stack.extend(deps.get(node, ()))
    return False


def dependents_closure(node: str, deps: Mapping[str, Iterable[str]]) -> set[str]:
    """All nodes that (transitively) depend on `node`."""
    reverse: dict[str, set[str]] = {}
    for n, ds in deps.items():
        for d in ds:
            reverse.setdefault(d, set()).add(n)
    out: set[str] = set()
    stack = list(reverse.get(node, ()))
    while stack:
        n = stack.pop()
        if n not in out:
            out.add(n)
            stack.extend(reverse.get(n, ()))
    return out
