# Security Policy

## Reporting a vulnerability

Model Lenz is a read-only static analyzer that runs entirely on a user's machine — no network calls, no XMLA, no live data sources. The attack surface is small but not zero: the TMDL block parser, the DAX reference extractor, the M-query lineage extractor, and the local FastAPI server all process untrusted input from PBIP files on disk.

If you discover a security vulnerability:

1. **Do not open a public issue.**
2. Report it privately via [GitHub Security Advisories](https://github.com/JonathanJihwanKim/pbip_model_lenz/security/advisories/new). If you cannot access that surface, open a minimal public issue asking the maintainer to enable a private channel — without including the vulnerability details.
3. Include enough detail to reproduce the issue (a PBIP fixture or TMDL snippet that triggers it, expected vs. actual behavior, and your impact assessment).

You'll receive an acknowledgement within 5 business days. The maintainer targets a fix within 30 days for high-severity issues. Once a fix is released, you'll be credited in the release notes unless you prefer to remain anonymous.

## Supported versions

Only the latest minor version published to PyPI is supported. Older versions do not receive security backports — please upgrade with `uv tool upgrade model-lenz` (or `pipx upgrade model-lenz`).

## Out of scope

- Vulnerabilities in upstream dependencies (FastAPI, uvicorn, Pydantic, NetworkX, Typer). Report those to the relevant upstream project. If a Model Lenz integration *amplifies* an upstream issue, that's in scope.
- Issues that require the attacker to have write access to a user's local filesystem or PBIP files. Model Lenz is read-only and trusts the caller's filesystem.
- Performance/DoS via maliciously crafted PBIP files. Open a regular issue with a reproducer — these are bugs but not security vulnerabilities.
