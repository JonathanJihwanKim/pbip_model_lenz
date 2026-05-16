"""Best-effort Git branch detection for the v0.3 diff feature.

When a user runs `model-lenz diff <base> <head>` against folders that happen
to live in Git working trees, we want the BASE/HEAD pills in the diff UI to
read like ``main`` and ``feature/add-yoy`` instead of the raw folder names.
Every call here is best-effort: Git might not be installed, the folder might
not be a working tree, or the tree might be in detached-HEAD state. All
failure modes return None and the caller falls back to the folder name.
"""

from __future__ import annotations

import subprocess
from pathlib import Path


def detect_branch_label(path: str | Path) -> str | None:
    """Return the current branch name of the Git working tree at `path`, or
    None if Git is unavailable, the path is not inside a working tree, or the
    tree is in detached-HEAD state.
    """
    p = Path(path)
    result = _run_git(["rev-parse", "--abbrev-ref", "HEAD"], cwd=p)
    if result is None:
        return None
    branch = result.strip()
    # `rev-parse --abbrev-ref HEAD` returns the literal string "HEAD" when the
    # working tree is in detached-HEAD state. That's not a useful label.
    if not branch or branch == "HEAD":
        return None
    return branch


def detect_is_default_branch(path: str | Path) -> bool:
    """Return True iff the working tree at `path` is currently on the repo's
    default branch (as reported by `origin/HEAD`). Falls back to a `main` /
    `master` heuristic when `origin/HEAD` is unset (common on freshly cloned
    or never-pushed repos).
    """
    branch = detect_branch_label(path)
    if branch is None:
        return False

    p = Path(path)
    # `symbolic-ref refs/remotes/origin/HEAD` → "refs/remotes/origin/main"
    # (or "refs/remotes/origin/master") when the remote default is known.
    default = _run_git(["symbolic-ref", "refs/remotes/origin/HEAD"], cwd=p)
    if default:
        # Take the last path segment: "refs/remotes/origin/main" → "main"
        default_branch = default.strip().split("/")[-1]
        return branch == default_branch

    # Fallback for repos without a tracked remote default: any branch named
    # `main` or `master` is treated as the default.
    return branch in {"main", "master"}


def _run_git(args: list[str], *, cwd: Path) -> str | None:
    """Invoke `git <args>` in `cwd` with a 2-second wall-clock budget. Returns
    stdout on success or None on any failure (Git missing, non-zero exit,
    timeout, OS-level error).
    """
    if not cwd.exists():
        return None
    try:
        completed = subprocess.run(
            ["git", *args],
            cwd=str(cwd),
            capture_output=True,
            text=True,
            timeout=2,
            check=False,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        return None
    if completed.returncode != 0:
        return None
    return completed.stdout
