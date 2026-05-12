"""DAX reference extractor.

Tokenizes a DAX expression and extracts:

- Direct table references — both ``'Quoted Table'`` and bare ``Table`` forms
  when they appear as arguments to known table-accepting functions, or as the
  table prefix of a column reference (``Table[Column]``).
- Column references — ``'Table'[Column]`` and ``Table[Column]``.
- Measure references — bare ``[Name]`` not preceded by a table identifier.
- USERELATIONSHIP hints — ``USERELATIONSHIP(t1[c1], t2[c2])`` returns the
  column pair so the indirect-dependency walker can enable this otherwise
  inactive relationship for the calling measure.
- ``unresolved_brackets`` — bracketed names that may be either a measure or a
  column on the same table (we cannot distinguish without scope info), so we
  surface them honestly.

The tokenizer ignores DAX comments (``// …`` and ``/* … */``) and DAX strings
(``"…"`` with ``""`` escape).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterator

# DAX functions that accept a TABLE expression as one of their arguments.
# When we see ``FUNC ( <table-ref>, ...)``, the first identifier is read as
# a table reference even without a column suffix.
TABLE_ARG_FUNCTIONS: frozenset[str] = frozenset(
    {
        "FILTER",
        "ALL",
        "ALLEXCEPT",
        "ALLSELECTED",
        "ALLNOBLANKROW",
        "ALLCROSSFILTERED",
        "VALUES",
        "DISTINCT",
        "RELATEDTABLE",
        "CROSSJOIN",
        "SUMMARIZE",
        "SUMMARIZECOLUMNS",
        "ADDCOLUMNS",
        "SELECTCOLUMNS",
        "NATURALINNERJOIN",
        "NATURALLEFTOUTERJOIN",
        "TREATAS",
        "GROUPBY",
        "USERELATIONSHIP",
        "CALCULATETABLE",
        "TOPN",
        "EXCEPT",
        "INTERSECT",
        "UNION",
        "GENERATE",
        "GENERATEALL",
        "ROW",
        "DATATABLE",
        "COUNTROWS",
        "ISFILTERED",
        "ISCROSSFILTERED",
        "HASONEFILTER",
        "HASONEVALUE",
    }
)

# Tokens.
T_NAME = "name"  # bare identifier (table name, function name, keyword)
T_QUOTED = "quoted"  # 'Quoted Table'
T_BRACKET = "bracket"  # [Column or Measure]
T_NUMBER = "number"
T_STRING = "string"
T_PUNCT = "punct"  # ( ) , = + - * / & < > etc.
T_KEYWORD = "keyword"  # VAR, RETURN, NOT, IN, TRUE, FALSE, etc.

DAX_KEYWORDS: frozenset[str] = frozenset(
    {"VAR", "RETURN", "NOT", "IN", "TRUE", "FALSE", "BLANK", "AND", "OR"}
)


@dataclass
class Token:
    kind: str
    value: str
    pos: int


@dataclass
class DaxRefs:
    tables: set[str] = field(default_factory=set)
    columns: set[tuple[str, str]] = field(default_factory=set)
    measures: set[str] = field(default_factory=set)
    userel_hints: list[tuple[str, str, str, str]] = field(default_factory=list)
    """Each entry is (from_table, from_column, to_table, to_column)."""
    unresolved_brackets: set[str] = field(default_factory=set)


def extract_refs(expression: str) -> DaxRefs:
    """Return all references found in a DAX expression."""
    src = _strip_comments(expression)
    tokens = list(_tokenize(src))
    refs = DaxRefs()
    _walk(tokens, refs)
    return refs


# --------------------------------------------------------------------------- #
# Comment stripping
# --------------------------------------------------------------------------- #


def _strip_comments(src: str) -> str:
    """Remove ``//`` line comments and ``/* */`` block comments, preserving
    string literals.
    """
    out: list[str] = []
    i = 0
    n = len(src)
    while i < n:
        c = src[i]
        if c == '"':
            # consume string literal verbatim, with `""` escape
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


# --------------------------------------------------------------------------- #
# Tokenizer
# --------------------------------------------------------------------------- #


def _tokenize(src: str) -> Iterator[Token]:
    n = len(src)
    i = 0
    while i < n:
        c = src[i]
        if c.isspace():
            i += 1
            continue

        if c == "'":
            j = i + 1
            buf = []
            while j < n:
                if src[j] == "'":
                    if j + 1 < n and src[j + 1] == "'":
                        buf.append("'")
                        j += 2
                        continue
                    break
                buf.append(src[j])
                j += 1
            yield Token(T_QUOTED, "".join(buf), i)
            i = j + 1
            continue

        if c == "[":
            j = src.find("]", i + 1)
            if j == -1:
                # malformed; skip
                i = n
                break
            yield Token(T_BRACKET, src[i + 1 : j], i)
            i = j + 1
            continue

        if c == '"':
            j = i + 1
            while j < n:
                if src[j] == '"':
                    if j + 1 < n and src[j + 1] == '"':
                        j += 2
                        continue
                    break
                j += 1
            yield Token(T_STRING, src[i + 1 : j], i)
            i = j + 1
            continue

        if c.isdigit() or (c == "." and i + 1 < n and src[i + 1].isdigit()):
            j = i + 1
            while j < n and (src[j].isdigit() or src[j] in ".eE+-"):
                j += 1
            yield Token(T_NUMBER, src[i:j], i)
            i = j
            continue

        if c.isalpha() or c == "_":
            j = i + 1
            while j < n and (src[j].isalnum() or src[j] == "_"):
                j += 1
            word = src[i:j]
            if word.upper() in DAX_KEYWORDS:
                yield Token(T_KEYWORD, word.upper(), i)
            else:
                yield Token(T_NAME, word, i)
            i = j
            continue

        # Punctuation / operator (single char is enough for our purposes)
        yield Token(T_PUNCT, c, i)
        i += 1


# --------------------------------------------------------------------------- #
# Reference walker
# --------------------------------------------------------------------------- #


def _walk(tokens: list[Token], refs: DaxRefs) -> None:
    i = 0
    n = len(tokens)
    while i < n:
        tok = tokens[i]

        # Quoted or bare identifier followed by a [bracket] => column ref
        if tok.kind in (T_QUOTED, T_NAME) and i + 1 < n and tokens[i + 1].kind == T_BRACKET:
            table = tok.value
            column = tokens[i + 1].value
            refs.tables.add(table)
            refs.columns.add((table, column))
            i += 2
            continue

        # Bare [bracket] not preceded by an identifier => measure ref candidate
        if tok.kind == T_BRACKET:
            # Could be a measure ref OR a column ref where the table is implicit
            # (same table). Surface as unresolved if we cannot tell.
            refs.measures.add(tok.value)
            refs.unresolved_brackets.add(tok.value)
            i += 1
            continue

        # FUNCTION ( ... ) — detect table-arg functions
        if tok.kind == T_NAME and i + 1 < n and tokens[i + 1].kind == T_PUNCT and tokens[i + 1].value == "(":
            fname = tok.value.upper()
            if fname == "USERELATIONSHIP":
                hint = _parse_userel(tokens, i + 1)
                if hint is not None:
                    refs.userel_hints.append(hint)
                    # Both column refs are also normal column references.
                    refs.tables.add(hint[0])
                    refs.tables.add(hint[2])
                    refs.columns.add((hint[0], hint[1]))
                    refs.columns.add((hint[2], hint[3]))
            elif fname in TABLE_ARG_FUNCTIONS:
                _collect_table_args(tokens, i + 1, refs)
            # don't `continue` — the function's arguments may also contain refs
            # we want to pick up via the normal walker (column refs etc.).
            i += 1
            continue

        i += 1


def _collect_table_args(tokens: list[Token], lparen_idx: int, refs: DaxRefs) -> None:
    """Walk argument list of a table-accepting function, scanning each top-level
    argument for a *bare* table reference (an identifier that is *not* followed
    by ``[…]``). Column refs encountered here are picked up by the main walker.
    """
    n = len(tokens)
    depth = 0
    arg_start = lparen_idx + 1
    i = lparen_idx
    while i < n:
        tk = tokens[i]
        if tk.kind == T_PUNCT and tk.value == "(":
            depth += 1
        elif tk.kind == T_PUNCT and tk.value == ")":
            depth -= 1
            if depth == 0:
                _scan_arg_for_bare_table(tokens, arg_start, i, refs)
                return
        elif tk.kind == T_PUNCT and tk.value == "," and depth == 1:
            _scan_arg_for_bare_table(tokens, arg_start, i, refs)
            arg_start = i + 1
        i += 1


def _scan_arg_for_bare_table(tokens: list[Token], lo: int, hi: int, refs: DaxRefs) -> None:
    """Within a single function argument span [lo, hi), if it consists of a
    single ``T_QUOTED`` or ``T_NAME`` token (optionally with whitespace), treat
    it as a bare table reference.
    """
    span = tokens[lo:hi]
    if len(span) == 1 and span[0].kind in (T_QUOTED, T_NAME) and span[0].kind != T_KEYWORD:
        # exclude function-name-only args (rare, e.g. NOT) and DAX literals
        name = span[0].value
        if name.upper() not in DAX_KEYWORDS:
            refs.tables.add(name)


def _parse_userel(
    tokens: list[Token], lparen_idx: int
) -> tuple[str, str, str, str] | None:
    """Parse ``USERELATIONSHIP(t1[c1], t2[c2])`` and return the column pair."""
    n = len(tokens)
    args: list[list[Token]] = [[]]
    depth = 0
    i = lparen_idx
    while i < n:
        tk = tokens[i]
        if tk.kind == T_PUNCT and tk.value == "(":
            depth += 1
            if depth == 1:
                i += 1
                continue
        elif tk.kind == T_PUNCT and tk.value == ")":
            depth -= 1
            if depth == 0:
                break
        elif tk.kind == T_PUNCT and tk.value == "," and depth == 1:
            args.append([])
            i += 1
            continue
        if depth >= 1:
            args[-1].append(tk)
        i += 1

    if len(args) != 2:
        return None
    first = _column_ref_from_arg(args[0])
    second = _column_ref_from_arg(args[1])
    if first is None or second is None:
        return None
    return (first[0], first[1], second[0], second[1])


def _column_ref_from_arg(arg: list[Token]) -> tuple[str, str] | None:
    """Pull (table, column) from an argument that should be ``Table[Column]``."""
    # Drop any leading whitespace tokens (none in our token stream) and find
    # the first identifier+bracket pair.
    for i in range(len(arg) - 1):
        t1 = arg[i]
        t2 = arg[i + 1]
        if t1.kind in (T_QUOTED, T_NAME) and t2.kind == T_BRACKET:
            return (t1.value, t2.value)
    return None
