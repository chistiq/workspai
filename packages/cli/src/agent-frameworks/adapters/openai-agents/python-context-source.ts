import { PROJECT_CONTEXT_AGENT_REPORT_RELATIVE_PATH } from '../../../utils/workspace-paths.js';
import { WORKSPAI_CONTEXT_SCHEMA_VERSION } from './typescript-context-source.js';

export function openaiAgentsPythonContextSource(): string {
  return `# Generated and managed by Workspai. Do not place secrets in this file.

from __future__ import annotations

import errno
import json
import os
import stat
from pathlib import Path

CONTEXT_LIMIT = 131_072
CONTEXT_PATH = "${PROJECT_CONTEXT_AGENT_REPORT_RELATIVE_PATH}"
CONTEXT_SCHEMA_VERSION = "${WORKSPAI_CONTEXT_SCHEMA_VERSION}"
AGENT_LAYOUT_PARENT = "agents"
GENERATED_NOTICE = "Generated and managed by Workspai"
CONTEXT_SEGMENTS = tuple(part for part in CONTEXT_PATH.split("/") if part)
MAX_PACKAGE_WALK = 5
MAX_MANIFEST_BYTES = 16_384


def _fail(message: str) -> None:
    raise RuntimeError(message) from None


def _missing_context() -> None:
    _fail(f"Run Workspai agent-sync first; missing {CONTEXT_PATH}")


def _unsafe_context() -> None:
    _fail("Workspai agent context path is not a contained regular file")


def _canonical(path: Path) -> Path:
    try:
        real = Path(os.path.realpath(path, strict=True))
    except OSError:
        _unsafe_context()
        raise
    return Path(os.path.normcase(str(real)))


def _is_inside(root: Path, candidate: Path) -> bool:
    try:
        candidate.relative_to(root)
    except ValueError:
        return False
    return candidate != root


def _is_link_or_reparse(path: Path, st: os.stat_result) -> bool:
    if stat.S_ISLNK(st.st_mode) or path.is_symlink():
        return True
    attributes = getattr(st, "st_file_attributes", 0)
    reparse = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
    return bool(attributes & reparse)


def _is_regular_file(st: os.stat_result) -> bool:
    return stat.S_ISREG(st.st_mode) and not stat.S_ISLNK(st.st_mode)


def _is_generated_python_manifest(path: Path) -> bool:
    try:
        st = path.lstat()
    except OSError:
        return False
    if _is_link_or_reparse(path, st) or not _is_regular_file(st) or st.st_size > MAX_MANIFEST_BYTES:
        return False
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return False
    return text.startswith(f"# {GENERATED_NOTICE}") and "[project]" in text


def resolve_workspai_project_root() -> Path:
    cursor = Path(os.path.abspath(__file__)).parent
    for _ in range(MAX_PACKAGE_WALK):
        manifest = cursor / "pyproject.toml"
        if _is_generated_python_manifest(manifest) and cursor.parent.name == AGENT_LAYOUT_PARENT:
            project = _canonical(cursor.parent.parent)
            agent = _canonical(cursor)
            if not _is_inside(project, agent):
                _unsafe_context()
            return project
        if cursor.parent == cursor:
            break
        cursor = cursor.parent
    _fail("Unable to locate the Workspai agent package at <project>/agents/<instance>/")
    raise AssertionError("unreachable")


def _open_contained_regular_file(project_root: Path) -> int:
    current = project_root
    for index, segment in enumerate(CONTEXT_SEGMENTS):
        if segment in {".", ".."} or os.sep in segment or (os.altsep and os.altsep in segment):
            _unsafe_context()
        nxt = current / segment
        last = index == len(CONTEXT_SEGMENTS) - 1
        try:
            st = nxt.lstat()
        except OSError as error:
            if last and getattr(error, "errno", None) == errno.ENOENT:
                _missing_context()
            _unsafe_context()
        if _is_link_or_reparse(nxt, st):
            try:
                target = _canonical(nxt)
            except RuntimeError:
                raise
            except OSError:
                _unsafe_context()
            if not _is_inside(project_root, target):
                _unsafe_context()
            try:
                target_st = target.lstat()
            except OSError:
                _unsafe_context()
            if last:
                if not _is_regular_file(target_st):
                    _unsafe_context()
                current = target
                break
            if not stat.S_ISDIR(target_st.st_mode) or _is_link_or_reparse(target, target_st):
                _unsafe_context()
            current = _canonical(target)
            continue
        if last:
            if not _is_regular_file(st):
                _unsafe_context()
            current = nxt
            break
        if not stat.S_ISDIR(st.st_mode):
            _unsafe_context()
        current = nxt
    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        return os.open(current, flags)
    except FileNotFoundError:
        _missing_context()
        raise
    except OSError:
        _unsafe_context()
        raise


def load_workspai_context() -> str:
    project_root = resolve_workspai_project_root()
    fd = _open_contained_regular_file(project_root)
    try:
        st = os.fstat(fd)
        if not _is_regular_file(st):
            _unsafe_context()
        if st.st_size > CONTEXT_LIMIT:
            _fail("Workspai agent context exceeds the admitted 128 KiB boundary")
        chunks = []
        remaining = CONTEXT_LIMIT + 1
        while remaining > 0:
            chunk = os.read(fd, remaining)
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        payload = b"".join(chunks)
        if len(payload) > CONTEXT_LIMIT:
            _fail("Workspai agent context exceeds the admitted 128 KiB boundary")
        try:
            decoded = payload.decode("utf-8")
        except UnicodeDecodeError:
            _fail("Workspai agent context is not valid UTF-8")
        try:
            parsed = json.loads(decoded)
        except json.JSONDecodeError:
            _fail("Workspai agent context is not valid JSON")
        if not isinstance(parsed, dict):
            _fail("Workspai agent context is not a JSON object")
        if parsed.get("schemaVersion") != CONTEXT_SCHEMA_VERSION:
            _fail(f"Workspai agent context schemaVersion is not {CONTEXT_SCHEMA_VERSION}")
        return decoded
    finally:
        os.close(fd)
`;
}
