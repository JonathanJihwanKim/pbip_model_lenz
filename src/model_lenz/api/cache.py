"""In-process cache for the parsed model and the relationship graph.

The cache is keyed by absolute PBIP path. A small filesystem-mtime check
invalidates the entry when any TMDL file under ``definition/`` has changed
since the parse.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from threading import Lock

from model_lenz.analyzers.relationships import RelationshipGraph
from model_lenz.models.semantic import Model
from model_lenz.parsers.pbip import find_semantic_model, parse_pbip


@dataclass
class _Entry:
    model: Model
    rel_graph: RelationshipGraph
    fingerprint: float


class ModelCache:
    def __init__(self) -> None:
        self._entries: dict[str, _Entry] = {}
        self._lock = Lock()

    def get(self, pbip_path: str | Path) -> _Entry:
        key = str(Path(pbip_path).resolve())
        fp = _fingerprint(pbip_path)
        with self._lock:
            entry = self._entries.get(key)
            if entry is not None and entry.fingerprint == fp:
                return entry
        # Parse outside the lock — parsing can be expensive, and a duplicated
        # parse on a cold start is harmless.
        model = parse_pbip(pbip_path)
        rg = RelationshipGraph.from_relationships(model.relationships)
        entry = _Entry(model=model, rel_graph=rg, fingerprint=fp)
        with self._lock:
            self._entries[key] = entry
        return entry

    def invalidate(self, pbip_path: str | Path) -> None:
        key = str(Path(pbip_path).resolve())
        with self._lock:
            self._entries.pop(key, None)


def _fingerprint(pbip_path: str | Path) -> float:
    """Return the latest mtime across all TMDL files in the model definition.

    Cheaper than hashing yet detects edits in any table/measure/relationship.
    """
    sm = find_semantic_model(pbip_path)
    definition = sm / "definition"
    latest = 0.0
    for p in definition.rglob("*.tmdl"):
        try:
            latest = max(latest, p.stat().st_mtime)
        except OSError:
            continue
    return latest
