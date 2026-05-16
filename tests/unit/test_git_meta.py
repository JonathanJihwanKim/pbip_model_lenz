"""Tests for `git_meta.py` — branch label detection.

Uses `monkeypatch` to swap `subprocess.run` for a fake. We don't shell out to
real `git` in unit tests so the suite stays hermetic and runs on CI agents
that may not have Git on PATH.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from model_lenz import git_meta


def _fake_run_factory(responses: dict[tuple, subprocess.CompletedProcess | Exception]):
    """Build a fake `subprocess.run` keyed by the trailing git args (a tuple).

    `responses` maps the last N words of `args[0]` (after the leading "git")
    to either a CompletedProcess or an exception to raise.
    """

    def fake_run(args, **kwargs):  # type: ignore[no-untyped-def]
        # args[0] is "git", args[1:] is the actual command.
        key = tuple(args[1:])
        if key not in responses:
            return subprocess.CompletedProcess(args, returncode=128, stdout="", stderr="not found")
        value = responses[key]
        if isinstance(value, Exception):
            raise value
        return value

    return fake_run


def _cp(stdout: str, *, returncode: int = 0) -> subprocess.CompletedProcess:
    return subprocess.CompletedProcess(args=[], returncode=returncode, stdout=stdout, stderr="")


def test_detect_branch_label_returns_branch_name(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(
        subprocess,
        "run",
        _fake_run_factory({("rev-parse", "--abbrev-ref", "HEAD"): _cp("feature/add-yoy\n")}),
    )
    assert git_meta.detect_branch_label(tmp_path) == "feature/add-yoy"


def test_detect_branch_label_returns_none_on_detached_head(monkeypatch, tmp_path: Path):
    # Git's `rev-parse --abbrev-ref HEAD` returns the literal "HEAD" in detached state.
    monkeypatch.setattr(
        subprocess,
        "run",
        _fake_run_factory({("rev-parse", "--abbrev-ref", "HEAD"): _cp("HEAD\n")}),
    )
    assert git_meta.detect_branch_label(tmp_path) is None


def test_detect_branch_label_returns_none_when_git_missing(monkeypatch, tmp_path: Path):
    def boom(*args, **kwargs):  # type: ignore[no-untyped-def]
        raise FileNotFoundError("git not installed")

    monkeypatch.setattr(subprocess, "run", boom)
    assert git_meta.detect_branch_label(tmp_path) is None


def test_detect_branch_label_returns_none_on_nonzero_exit(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(
        subprocess,
        "run",
        _fake_run_factory(
            {("rev-parse", "--abbrev-ref", "HEAD"): _cp("", returncode=128)}
        ),
    )
    assert git_meta.detect_branch_label(tmp_path) is None


def test_detect_branch_label_returns_none_on_timeout(monkeypatch, tmp_path: Path):
    def slow(*args, **kwargs):  # type: ignore[no-untyped-def]
        raise subprocess.TimeoutExpired(cmd="git", timeout=2)

    monkeypatch.setattr(subprocess, "run", slow)
    assert git_meta.detect_branch_label(tmp_path) is None


def test_detect_branch_label_returns_none_for_missing_path():
    # Path that doesn't exist: caller-side short-circuit before subprocess runs.
    missing = Path("Z:/definitely/does/not/exist")
    assert git_meta.detect_branch_label(missing) is None


def test_detect_is_default_branch_true_when_on_origin_head(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(
        subprocess,
        "run",
        _fake_run_factory(
            {
                ("rev-parse", "--abbrev-ref", "HEAD"): _cp("main\n"),
                ("symbolic-ref", "refs/remotes/origin/HEAD"): _cp("refs/remotes/origin/main\n"),
            }
        ),
    )
    assert git_meta.detect_is_default_branch(tmp_path) is True


def test_detect_is_default_branch_false_when_not_on_origin_head(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(
        subprocess,
        "run",
        _fake_run_factory(
            {
                ("rev-parse", "--abbrev-ref", "HEAD"): _cp("feature/x\n"),
                ("symbolic-ref", "refs/remotes/origin/HEAD"): _cp("refs/remotes/origin/main\n"),
            }
        ),
    )
    assert git_meta.detect_is_default_branch(tmp_path) is False


def test_detect_is_default_branch_falls_back_to_main_heuristic(monkeypatch, tmp_path: Path):
    # No remote default — fallback: branch named "main" or "master" wins.
    monkeypatch.setattr(
        subprocess,
        "run",
        _fake_run_factory(
            {
                ("rev-parse", "--abbrev-ref", "HEAD"): _cp("main\n"),
                ("symbolic-ref", "refs/remotes/origin/HEAD"): _cp("", returncode=128),
            }
        ),
    )
    assert git_meta.detect_is_default_branch(tmp_path) is True


def test_detect_is_default_branch_heuristic_rejects_feature_branch(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(
        subprocess,
        "run",
        _fake_run_factory(
            {
                ("rev-parse", "--abbrev-ref", "HEAD"): _cp("feature/x\n"),
                ("symbolic-ref", "refs/remotes/origin/HEAD"): _cp("", returncode=128),
            }
        ),
    )
    assert git_meta.detect_is_default_branch(tmp_path) is False


@pytest.mark.parametrize("default", ["main", "master"])
def test_detect_is_default_branch_accepts_both_main_and_master(
    monkeypatch, tmp_path: Path, default: str
):
    monkeypatch.setattr(
        subprocess,
        "run",
        _fake_run_factory(
            {
                ("rev-parse", "--abbrev-ref", "HEAD"): _cp(f"{default}\n"),
                ("symbolic-ref", "refs/remotes/origin/HEAD"): _cp("", returncode=128),
            }
        ),
    )
    assert git_meta.detect_is_default_branch(tmp_path) is True
