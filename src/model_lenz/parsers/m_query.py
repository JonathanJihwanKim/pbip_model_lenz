"""M (Power Query) lineage extractor.

Given an M expression body (the contents of a partition's ``source = let ... in
...`` block, or a named expression in ``expressions.tmdl``), identify:

- The connector used (e.g. ``GoogleBigQuery``, ``Sql.Database``).
- The source-system schema and table when extractable.
- The native SQL text when the partition uses ``Value.NativeQuery``.
- Other named expressions this body references (cross-query lineage).
- A confidence label (``high``/``medium``/``low``).

The extractor is deliberately lexical and best-effort. Unknown shapes degrade
to lower confidence rather than crashing.
"""

from __future__ import annotations

import re

from model_lenz.models.lineage import SourceLineage

# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #


def _strip_m_comments(src: str) -> str:
    """Remove M ``//`` line comments and ``/* */`` block comments outside strings."""
    out: list[str] = []
    i = 0
    n = len(src)
    while i < n:
        c = src[i]
        if c == '"':
            j = i + 1
            while j < n:
                if src[j] == '"':
                    if j + 1 < n and src[j + 1] == '"':
                        j += 2
                        continue
                    j += 1
                    break
                j += 1
            out.append(src[i:j])
            i = j
            continue
        if c == "/" and i + 1 < n and src[i + 1] == "/":
            j = src.find("\n", i)
            if j == -1:
                break
            out.append("\n")
            i = j + 1
            continue
        if c == "/" and i + 1 < n and src[i + 1] == "*":
            j = src.find("*/", i + 2)
            if j == -1:
                break
            i = j + 2
            continue
        out.append(c)
        i += 1
    return "".join(out)


_STRING_LITERAL_RE = re.compile(r'"((?:[^"]|"")*)"')


def _resolve_string_concat(src: str) -> str:
    r"""Return a flattened literal version of a `"a" & x & "b"` chain.

    Replaces ``& <ident> &`` with a placeholder ``{IDENT}`` and concatenates the
    string parts. This is enough to make later ``FROM \`schema.table\`...``
    pattern matching work even when the literal SQL is interrupted by parameter
    references.
    """
    # Look for the *first* string literal in src, then walk the rest of the
    # statement assembling literal + placeholder fragments.
    parts: list[str] = []
    i = 0
    n = len(src)
    while i < n:
        m = _STRING_LITERAL_RE.search(src, i)
        if not m:
            break
        parts.append(m.group(1).replace('""', '"'))
        i = m.end()
        # Look ahead for `& IDENT &` chain
        while i < n:
            j = i
            while j < n and src[j].isspace():
                j += 1
            if j < n and src[j] == "&":
                k = j + 1
                while k < n and src[k].isspace():
                    k += 1
                # Identifier or another string literal?
                if k < n and src[k] == '"':
                    break  # next iteration will pick it up
                # Read identifier (or M `_BillingProject`-style)
                kk = k
                while kk < n and (src[kk].isalnum() or src[kk] in "_."):
                    kk += 1
                ident = src[k:kk]
                if not ident:
                    break
                parts.append("{" + ident + "}")
                i = kk
                # Expect another `&` to continue
                while i < n and src[i].isspace():
                    i += 1
                if i < n and src[i] == "&":
                    i += 1
                else:
                    break
            else:
                break
        # If we reach a separator that isn't `&`, the chain ended; loop will
        # search for the next disjoint string literal.
    return "".join(parts) if parts else src


# --------------------------------------------------------------------------- #
# Step parsing (let / in)
# --------------------------------------------------------------------------- #


_STEP_NAME_RE = re.compile(
    r"""
    (?P<name>
        \#"(?:[^"]|"")+"     # quoted step name
        | [A-Za-z_]\w*        # bare identifier
    )
    \s*=\s*
    """,
    re.VERBOSE,
)


def _split_steps(let_body: str) -> list[tuple[str, str]]:
    """Naively parse a sequence of ``name = expression,`` step bindings.

    Returns ``[(step_name, expression_text), ...]`` in source order. Parsing
    splits on top-level commas (depth 0 outside ``[]``, ``{}``, ``()``).
    """
    steps: list[tuple[str, str]] = []
    n = len(let_body)
    i = 0
    while i < n:
        # Skip whitespace
        while i < n and let_body[i].isspace():
            i += 1
        if i >= n:
            break
        m = _STEP_NAME_RE.match(let_body, i)
        if not m:
            # Not a step — break.
            break
        name = m.group("name")
        if name.startswith('#"'):
            name = name[2:-1]
        rhs_start = m.end()
        rhs_end = _find_top_level_comma(let_body, rhs_start)
        if rhs_end == -1:
            rhs_end = n
        steps.append((name, let_body[rhs_start:rhs_end].strip()))
        # Advance past the comma
        i = rhs_end + 1
    return steps


def _find_top_level_comma(s: str, start: int) -> int:
    depth_paren = 0
    depth_brack = 0
    depth_brace = 0
    in_str = False
    i = start
    n = len(s)
    while i < n:
        c = s[i]
        if c == '"':
            if in_str and i + 1 < n and s[i + 1] == '"':
                i += 2
                continue
            in_str = not in_str
        elif not in_str:
            if c == "(":
                depth_paren += 1
            elif c == ")":
                depth_paren -= 1
            elif c == "[":
                depth_brack += 1
            elif c == "]":
                depth_brack -= 1
            elif c == "{":
                depth_brace += 1
            elif c == "}":
                depth_brace -= 1
            elif c == "," and depth_paren == 0 and depth_brack == 0 and depth_brace == 0:
                return i
        i += 1
    return -1


def _split_let_in(src: str) -> tuple[str, str | None]:
    """Return (let_body, in_step) given an M expression beginning with ``let``."""
    src = src.strip()
    if not src.lower().startswith("let"):
        return ("", None)
    body_start = 3  # after 'let'
    # Find the matching `in` keyword at top level (depth == 0).
    depth_paren = 0
    depth_brack = 0
    depth_brace = 0
    in_str = False
    i = body_start
    n = len(src)
    while i < n:
        c = src[i]
        if c == '"':
            if in_str and i + 1 < n and src[i + 1] == '"':
                i += 2
                continue
            in_str = not in_str
            i += 1
            continue
        if in_str:
            i += 1
            continue
        if c == "(":
            depth_paren += 1
        elif c == ")":
            depth_paren -= 1
        elif c == "[":
            depth_brack += 1
        elif c == "]":
            depth_brack -= 1
        elif c == "{":
            depth_brace += 1
        elif c == "}":
            depth_brace -= 1
        elif (
            depth_paren == 0
            and depth_brack == 0
            and depth_brace == 0
            and src[i : i + 2].lower() == "in"
            and (i == 0 or not (src[i - 1].isalnum() or src[i - 1] == "_"))
            and (i + 2 == n or not (src[i + 2].isalnum() or src[i + 2] == "_"))
        ):
            let_body = src[body_start:i]
            in_step = src[i + 2 :].strip()
            # Strip trailing punctuation/braces on `in_step`
            return (let_body, in_step or None)
        i += 1
    return (src[body_start:], None)


# --------------------------------------------------------------------------- #
# Source detection
# --------------------------------------------------------------------------- #


_NATIVE_QUERY_RE = re.compile(
    r"Value\.NativeQuery\s*\(\s*(?P<conn>[^,]+?)\s*,\s*", re.DOTALL
)
_FROM_TABLE_RE = re.compile(
    r"FROM\s+`(?P<full>[^`]+)`", re.IGNORECASE
)
_FROM_BRACKETED_RE = re.compile(
    r"FROM\s+\[(?P<schema>[^\]]+)\]\.\[(?P<table>[^\]]+)\]", re.IGNORECASE
)
_FROM_BARE_RE = re.compile(
    r"FROM\s+(?P<ident>[A-Za-z_][\w.]*)", re.IGNORECASE
)
_BIGQUERY_NAV_RE = re.compile(
    r"\{\s*\[\s*Name\s*=\s*(?P<name>[^,\]]+?)(?:\s*,\s*Kind\s*=\s*\"(?P<kind>[^\"]+)\")?\s*\]\s*\}\s*\[\s*Data\s*\]"
)
_BARE_IDENT_RE = re.compile(r"^[A-Za-z_]\w*$")


def _detect_connector(src: str) -> str | None:
    candidates = [
        ("GoogleBigQuery", "GoogleBigQuery.Database"),
        ("Sql.Database", "Sql.Database"),
        ("Snowflake", "Snowflake.Databases"),
        ("AzureStorage", "AzureStorage.Blobs"),
        ("AzureStorage.DataLake", "AzureStorage.DataLake"),
        ("Csv.Document", "Csv.Document"),
        ("Excel.Workbook", "Excel.Workbook"),
        ("Web.Contents", "Web.Contents"),
        ("SharePoint", "SharePoint.Files"),
        ("OData.Feed", "OData.Feed"),
        ("Json.Document", "Json.Document"),
    ]
    for label, needle in candidates:
        if needle in src:
            return label
    return None


def _extract_native_sql(src: str) -> str | None:
    """Return the literal/concatenated SQL inside the first Value.NativeQuery call."""
    m = _NATIVE_QUERY_RE.search(src)
    if not m:
        return None
    sql_start = m.end()
    end = _find_top_level_comma(src, sql_start)
    sql_segment = src[sql_start:end] if end != -1 else src[sql_start:]
    # The SQL itself is a string-concat expression like `"SELECT ..." & x & "..."`.
    return _resolve_string_concat(sql_segment).strip() or None


def _extract_table_from_sql(sql: str) -> tuple[str | None, str | None, str | None]:
    """Return (schema, table, fully_qualified) parsed from a SQL statement."""
    if not sql:
        return (None, None, None)
    m = _FROM_TABLE_RE.search(sql)
    if m:
        full = m.group("full")
        # Strip placeholder param prefix like `{_BillingProject}.`
        cleaned = re.sub(r"\{[^}]+\}\.", "", full)
        parts = cleaned.split(".")
        if len(parts) >= 2:
            return (parts[-2], parts[-1], full)
        return (None, parts[-1], full)
    m = _FROM_BRACKETED_RE.search(sql)
    if m:
        return (m.group("schema"), m.group("table"), f"{m.group('schema')}.{m.group('table')}")
    m = _FROM_BARE_RE.search(sql)
    if m:
        ident = m.group("ident")
        parts = ident.split(".")
        if len(parts) >= 2:
            return (parts[-2], parts[-1], ident)
        return (None, parts[-1], ident)
    return (None, None, None)


def _extract_bigquery_nav(src: str) -> tuple[str | None, str | None, str | None]:
    """Walk a `Source{[Name=...]}[Data]` chain and return (project, schema, table)."""
    # Each match is one navigation step. We collect [name, kind] pairs in order.
    steps: list[tuple[str, str | None]] = []
    for m in _BIGQUERY_NAV_RE.finditer(src):
        raw_name = m.group("name").strip()
        # Strip surrounding quotes when present; otherwise keep verbatim (expression / parameter).
        name = (
            raw_name[1:-1]
            if raw_name.startswith('"') and raw_name.endswith('"')
            else raw_name
        )
        kind = m.group("kind")
        steps.append((name, kind))
    if not steps:
        return (None, None, None)
    # Heuristic: the last step is the table (Kind="Table" or "View"); the
    # immediately preceding is the schema (Kind="Schema"); everything before
    # is the project/database.
    project = schema = table = None
    for nm, kind in steps:
        if kind in ("Table", "View"):
            table = nm
        elif kind == "Schema":
            schema = nm
        else:
            project = nm
    return (project, schema, table)


# --------------------------------------------------------------------------- #
# Cross-query reference detection
# --------------------------------------------------------------------------- #


_REF_IDENT_RE = re.compile(r"(?<![\w.])([A-Za-z_]\w*)(?![\w.\(])")


def _find_expression_refs(src: str, expression_names: set[str]) -> list[str]:
    """Find bare identifier references to known named expressions."""
    found: list[str] = []
    seen: set[str] = set()
    for m in _REF_IDENT_RE.finditer(src):
        name = m.group(1)
        if name in expression_names and name not in seen:
            seen.add(name)
            found.append(name)
    return found


# --------------------------------------------------------------------------- #
# Public entry point
# --------------------------------------------------------------------------- #


def extract_lineage(
    expression: str,
    *,
    expression_names: set[str] | None = None,
) -> SourceLineage:
    """Extract a `SourceLineage` from an M expression body."""
    expression_names = expression_names or set()
    cleaned = _strip_m_comments(expression)

    let_body, _in_step = _split_let_in(cleaned)
    steps = _split_steps(let_body) if let_body else []
    step_names = [name for name, _ in steps]

    upstream = _find_expression_refs(cleaned, expression_names)
    connector = _detect_connector(cleaned)
    sql = _extract_native_sql(cleaned)

    schema = table = full = None
    confidence = "low"

    if sql:
        schema, table, full = _extract_table_from_sql(sql)
        if table:
            confidence = "high"
    if table is None and connector == "GoogleBigQuery":
        proj, sch, tbl = _extract_bigquery_nav(cleaned)
        if tbl:
            schema, table = sch, tbl
            full = ".".join(p for p in [proj, sch, tbl] if p) or None
            confidence = "high"

    if not table and upstream:
        # We at least know it depends on another expression — medium confidence.
        confidence = "medium"
    elif not table and connector:
        confidence = "low"

    return SourceLineage(
        connector=connector,
        schema=schema,
        table=table,
        fully_qualified=full,
        sql=sql,
        transformed_steps=step_names,
        upstream_expressions=upstream,
        confidence=confidence,
    )
