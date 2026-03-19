#!/usr/bin/env python3
"""
app_analyzer.py — Atomic toolbox for macOS .app bundle analysis.

AI calls each sub-command individually during progressive exploration.
This script is the bottom-level executor; AI makes all decisions.

Exit codes:
  0 — success
  1 — argument error (path doesn't exist, missing required args)
  2 — execution error (system command failed, permission denied)
  3 — empty data (command succeeded but no useful output)
"""

import argparse
import json
import plistlib
import re
import subprocess
import sys
from pathlib import Path
from typing import NoReturn


# ---------------------------------------------------------------------------
# Error handling
# ---------------------------------------------------------------------------

def emit_error(message: str, code: int, hint: str = "") -> NoReturn:
    """Write structured error JSON to stderr and exit."""
    payload = {"error": message, "code": code}
    if hint:
        payload["hint"] = hint
    print(json.dumps(payload, ensure_ascii=False), file=sys.stderr)
    sys.exit(code)


# ---------------------------------------------------------------------------
# Common helpers
# ---------------------------------------------------------------------------

def validate_app_path(app_path: str) -> Path:
    """Validate that the path is a .app bundle with Info.plist inside."""
    p = Path(app_path).resolve()
    if not p.exists():
        emit_error(
            f"App path does not exist: {p}",
            code=1,
            hint="Provide a valid path to a .app bundle",
        )
    if not p.suffix == ".app":
        emit_error(
            f"Path is not a .app bundle: {p}",
            code=1,
            hint="Path must end with .app",
        )
    info_plist = p / "Contents" / "Info.plist"
    if not info_plist.exists():
        emit_error(
            f"Info.plist not found at {info_plist}",
            code=1,
            hint="The bundle may be malformed or use a non-standard layout",
        )
    return p


def derive_app_name(app_path: Path) -> str:
    """Derive a human-readable app name.

    Priority: CFBundleDisplayName -> CFBundleName -> directory name (minus .app).
    """
    info_plist = app_path / "Contents" / "Info.plist"
    try:
        with open(info_plist, "rb") as f:
            plist = plistlib.load(f)
        for key in ("CFBundleDisplayName", "CFBundleName"):
            name = plist.get(key)
            if name:
                return name
    except Exception:
        pass
    # Fallback: directory name without .app
    return app_path.stem


def resolve_output_dir(app_path: Path, output_arg: str | None) -> Path:
    """Resolve and create the output directory."""
    if output_arg:
        out = Path(output_arg)
    else:
        app_name = derive_app_name(app_path)
        out = Path("./docs/dump") / f"{app_name}.analysis"
    out.mkdir(parents=True, exist_ok=True)
    return out.resolve()


def read_info_plist(app_path: Path) -> dict:
    """Read and return the parsed Info.plist dictionary."""
    info_plist = app_path / "Contents" / "Info.plist"
    try:
        with open(info_plist, "rb") as f:
            return plistlib.load(f)
    except Exception as exc:
        emit_error(
            f"Failed to parse Info.plist: {exc}",
            code=2,
            hint="The plist may be binary or corrupted; try plist_read for details",
        )


def make_serializable(obj):
    """Convert plist types (bytes, datetime, etc.) to JSON-safe types."""
    if isinstance(obj, bytes):
        return obj.hex()
    if isinstance(obj, dict):
        return {k: make_serializable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [make_serializable(item) for item in obj]
    if hasattr(obj, "isoformat"):
        return obj.isoformat()
    return obj


# ---------------------------------------------------------------------------
# Sub-command: app_info
# ---------------------------------------------------------------------------

def cmd_app_info(args: argparse.Namespace) -> None:
    """Extract core metadata from Info.plist and output as JSON."""
    app_path = validate_app_path(args.app)
    plist = read_info_plist(app_path)

    # Extract URL schemes
    url_schemes: list[str] = []
    for url_type in plist.get("CFBundleURLTypes", []):
        schemes = url_type.get("CFBundleURLSchemes", [])
        url_schemes.extend(schemes)

    info = {
        "BundleID": plist.get("CFBundleIdentifier", ""),
        "BundleName": plist.get("CFBundleName", ""),
        "DisplayName": plist.get("CFBundleDisplayName", ""),
        "Version": plist.get("CFBundleVersion", ""),
        "ShortVersion": plist.get("CFBundleShortVersionString", ""),
        "MinimumOSVersion": plist.get("LSMinimumSystemVersion", ""),
        "Executable": plist.get("CFBundleExecutable", ""),
        "URLSchemes": url_schemes,
        "BuildVersion": plist.get("DTXcodeBuild", ""),
        "DevelopmentTeam": plist.get("TeamIdentifier", plist.get("DevelopmentTeam", "")),
    }

    # Check if we got anything meaningful
    if not any(v for v in info.values() if v):
        emit_error(
            "Info.plist parsed but contains no recognised metadata fields",
            code=3,
            hint="The plist structure may be non-standard",
        )

    output_json = json.dumps(info, indent=2, ensure_ascii=False)

    # Write to file
    output_dir = resolve_output_dir(app_path, args.output)
    metadata_dir = output_dir / "metadata"
    metadata_dir.mkdir(parents=True, exist_ok=True)
    out_file = metadata_dir / "app_info.json"
    out_file.write_text(output_json + "\n", encoding="utf-8")

    # Stdout
    print(output_json)


# ---------------------------------------------------------------------------
# Sub-command: app_tree
# ---------------------------------------------------------------------------

def cmd_app_tree(args: argparse.Namespace) -> None:
    """Print a tree view of the .app bundle directory structure."""
    app_path = validate_app_path(args.app)
    max_depth = args.depth

    lines: list[str] = []

    def _walk(directory: Path, prefix: str, depth: int) -> None:
        if depth > max_depth:
            return
        try:
            entries = sorted(directory.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower()))
        except PermissionError:
            lines.append(f"{prefix}[permission denied]")
            return

        for i, entry in enumerate(entries):
            is_last = i == len(entries) - 1
            connector = "└── " if is_last else "├── "
            suffix = "/" if entry.is_dir() else ""
            lines.append(f"{prefix}{connector}{entry.name}{suffix}")
            if entry.is_dir():
                extension = "    " if is_last else "│   "
                _walk(entry, prefix + extension, depth + 1)

    lines.append(f"{app_path.name}/")
    _walk(app_path, "", 1)

    if len(lines) <= 1:
        emit_error(
            "Directory tree is empty",
            code=3,
            hint="The .app bundle may have no accessible contents",
        )

    output = "\n".join(lines)
    print(output)


# ---------------------------------------------------------------------------
# Sub-command: file_type
# ---------------------------------------------------------------------------

def cmd_file_type(args: argparse.Namespace) -> None:
    """Identify file type of a file inside the .app bundle using `file`."""
    app_path = validate_app_path(args.app)
    target = app_path / args.path

    if not target.exists():
        emit_error(
            f"File not found: {args.path}",
            code=1,
            hint=f"Use app_tree to list available files in {app_path.name}",
        )

    try:
        result = subprocess.run(
            ["file", str(target)],
            capture_output=True,
            text=True,
            timeout=10,
        )
    except subprocess.TimeoutExpired:
        emit_error(
            f"file command timed out on: {args.path}",
            code=2,
            hint="The file may be very large or on a slow volume",
        )
    except OSError as exc:
        emit_error(
            f"Failed to run 'file' command: {exc}",
            code=2,
            hint="The 'file' command may not be available or the path is inaccessible",
        )

    if result.returncode != 0:
        emit_error(
            f"file command failed: {result.stderr.strip()}",
            code=2,
            hint="Check file permissions",
        )

    output = result.stdout.strip()
    if not output:
        emit_error(
            "file command returned empty output",
            code=3,
            hint="The file may be empty or inaccessible",
        )

    print(output)


# ---------------------------------------------------------------------------
# Helper: locate main binary
# ---------------------------------------------------------------------------

def _human_size(nbytes: int) -> str:
    """Convert byte count to human-readable string."""
    for unit in ("B", "KB", "MB", "GB"):
        if nbytes < 1024:
            return f"{nbytes:.1f} {unit}"
        nbytes /= 1024
    return f"{nbytes:.1f} TB"


def locate_main_binary(app_path: Path) -> Path:
    """Find the main binary via CFBundleExecutable in Info.plist."""
    plist = read_info_plist(app_path)
    executable = plist.get("CFBundleExecutable")
    if not executable:
        emit_error(
            "CFBundleExecutable not found in Info.plist",
            code=2,
            hint="The bundle may be malformed",
        )
    binary = app_path / "Contents" / "MacOS" / executable
    if not binary.exists():
        emit_error(
            f"Main binary not found at {binary}",
            code=2,
            hint="The executable listed in Info.plist does not exist",
        )
    return binary


# ---------------------------------------------------------------------------
# Sub-command: plist_read
# ---------------------------------------------------------------------------

def cmd_plist_read(args: argparse.Namespace) -> None:
    """Read and dump any plist file inside the .app bundle as JSON."""
    app_path = validate_app_path(args.app)
    target = app_path / args.path

    if not target.exists():
        emit_error(
            f"Plist file not found: {args.path}",
            code=1,
            hint=f"Use app_tree to find plist files in {app_path.name}",
        )

    try:
        with open(target, "rb") as f:
            plist = plistlib.load(f)
    except plistlib.InvalidFileException as exc:
        emit_error(
            f"Not a valid plist file: {exc}",
            code=2,
            hint="The file may not be in plist format; use file_type to check",
        )
    except PermissionError:
        emit_error(
            f"Permission denied reading: {args.path}",
            code=2,
            hint="Try running with elevated permissions",
        )
    except Exception as exc:
        emit_error(
            f"Failed to read plist: {exc}",
            code=2,
            hint="The file may be corrupted or in an unsupported format",
        )
    else:
        serializable = make_serializable(plist)
        output = json.dumps(serializable, indent=2, ensure_ascii=False)

        if not output or output == "{}":
            emit_error(
                "Plist file is empty or contains no data",
                code=3,
                hint="The file exists but has no useful content",
            )

        print(output)


# ---------------------------------------------------------------------------
# Sub-command: binary_info
# ---------------------------------------------------------------------------

def cmd_binary_info(args: argparse.Namespace) -> None:
    """Analyse the main binary: type, architecture, size."""
    app_path = validate_app_path(args.app)
    binary = locate_main_binary(app_path)

    info: dict = {"path": str(binary)}

    # file command
    try:
        result = subprocess.run(
            ["file", str(binary)],
            capture_output=True, text=True, timeout=10,
        )
    except OSError as exc:
        emit_error(f"Failed to run 'file': {exc}", code=2)
    else:
        if result.returncode == 0:
            info["file_type"] = result.stdout.strip()

    # lipo -info (meaningful only for universal binaries)
    try:
        result = subprocess.run(
            ["lipo", "-info", str(binary)],
            capture_output=True, text=True, timeout=10,
        )
    except OSError:
        pass  # lipo not available — not critical
    else:
        if result.returncode == 0:
            info["architectures"] = result.stdout.strip()

    # File size
    try:
        size = binary.stat().st_size
        info["size_bytes"] = size
        info["size_human"] = _human_size(size)
    except OSError as exc:
        emit_error(f"Cannot stat binary: {exc}", code=2)

    output_json = json.dumps(info, indent=2, ensure_ascii=False)

    # Write to file
    output_dir = resolve_output_dir(app_path, args.output)
    metadata_dir = output_dir / "metadata"
    metadata_dir.mkdir(parents=True, exist_ok=True)
    out_file = metadata_dir / "binary_info.json"
    out_file.write_text(output_json + "\n", encoding="utf-8")

    print(output_json)


# ---------------------------------------------------------------------------
# Sub-command: dylib_list
# ---------------------------------------------------------------------------

def cmd_dylib_list(args: argparse.Namespace) -> None:
    """List dynamic libraries linked by the main binary."""
    app_path = validate_app_path(args.app)
    binary = locate_main_binary(app_path)

    try:
        result = subprocess.run(
            ["otool", "-L", str(binary)],
            capture_output=True, text=True, timeout=30,
        )
    except OSError as exc:
        emit_error(f"Failed to run 'otool -L': {exc}", code=2)

    if result.returncode != 0:
        emit_error(
            f"otool -L failed: {result.stderr.strip()}",
            code=2,
            hint="Check file permissions or Xcode command-line tools installation",
        )

    libs: list[dict] = []
    for line in result.stdout.splitlines()[1:]:  # skip first line (binary path)
        line = line.strip()
        if not line:
            continue
        # Format: /path/to/lib (compatibility version X, current version Y)
        match = re.match(r"^(.+?)\s+\(", line)
        if not match:
            continue
        path = match.group(1).strip()

        if path.startswith("/System") or path.startswith("/usr/lib"):
            category = "system"
        elif path.startswith("@rpath"):
            category = "rpath"
        elif path.startswith("@executable_path") or path.startswith("@loader_path"):
            category = "embedded"
        else:
            category = "other"

        libs.append({"path": path, "category": category})

    if not libs:
        emit_error(
            "No dynamic libraries found",
            code=3,
            hint="The binary may be statically linked",
        )

    data = {"binary": str(binary), "count": len(libs), "libraries": libs}
    output_json = json.dumps(data, indent=2, ensure_ascii=False)

    # Write to file
    output_dir = resolve_output_dir(app_path, args.output)
    binaries_dir = output_dir / "binaries"
    binaries_dir.mkdir(parents=True, exist_ok=True)
    out_file = binaries_dir / "dylibs.json"
    out_file.write_text(output_json + "\n", encoding="utf-8")

    print(output_json)


# ---------------------------------------------------------------------------
# Sub-command: headers_dump
# ---------------------------------------------------------------------------

def cmd_headers_dump(args: argparse.Namespace) -> None:
    """Dump Mach-O load commands via otool -l."""
    app_path = validate_app_path(args.app)
    binary = locate_main_binary(app_path)

    try:
        result = subprocess.run(
            ["otool", "-l", str(binary)],
            capture_output=True, text=True, timeout=30,
        )
    except OSError as exc:
        emit_error(f"Failed to run 'otool -l': {exc}", code=2)

    if result.returncode != 0:
        emit_error(
            f"otool -l failed: {result.stderr.strip()}",
            code=2,
            hint="Check file permissions or Xcode command-line tools installation",
        )

    raw = result.stdout
    if not raw.strip():
        emit_error(
            "otool -l returned empty output",
            code=3,
            hint="The binary may not be a valid Mach-O file",
        )

    # Parse load commands into structured data
    commands: list[dict] = []
    current_cmd: dict | None = None

    for line in raw.splitlines():
        stripped = line.strip()
        if stripped.startswith("Load command"):
            if current_cmd is not None:
                commands.append(current_cmd)
            current_cmd = {"index": stripped, "fields": {}}
        elif current_cmd is not None and stripped:
            # Parse "key value" pairs
            parts = stripped.split(None, 1)
            if len(parts) == 2:
                current_cmd["fields"][parts[0]] = parts[1]
            elif len(parts) == 1:
                current_cmd["fields"][parts[0]] = ""

    if current_cmd is not None:
        commands.append(current_cmd)

    # Optional filter by section (LC type)
    section_filter = args.section
    if section_filter:
        commands = [
            c for c in commands
            if c["fields"].get("cmd", "") == section_filter
        ]
        if not commands:
            emit_error(
                f"No load commands matching '{section_filter}'",
                code=3,
                hint="Use headers_dump without --section to see all load commands",
            )

    data = {"binary": str(binary), "count": len(commands), "load_commands": commands}
    output_json = json.dumps(data, indent=2, ensure_ascii=False)

    # Write to file
    output_dir = resolve_output_dir(app_path, args.output)
    binaries_dir = output_dir / "binaries"
    binaries_dir.mkdir(parents=True, exist_ok=True)
    out_file = binaries_dir / "headers.json"
    out_file.write_text(output_json + "\n", encoding="utf-8")

    print(output_json)


# ---------------------------------------------------------------------------
# Sub-command: symbols
# ---------------------------------------------------------------------------

def cmd_symbols(args: argparse.Namespace) -> None:
    """Dump symbol table via nm."""
    app_path = validate_app_path(args.app)
    binary = locate_main_binary(app_path)

    try:
        result = subprocess.run(
            ["nm", str(binary)],
            capture_output=True, text=True, timeout=60,
        )
    except OSError as exc:
        emit_error(f"Failed to run 'nm': {exc}", code=2)

    if result.returncode != 0:
        emit_error(
            f"nm failed: {result.stderr.strip()}",
            code=2,
            hint="The binary may be in an unsupported format",
        )

    lines = result.stdout.splitlines()

    # Detect stripped binary
    if len(lines) < 5:
        emit_error(
            "Binary appears to be stripped (few or no symbols found)",
            code=3,
            hint="Try 'strings_grep' to search for embedded strings instead",
        )

    # Optional keyword filter
    if args.filter:
        pattern = args.filter
        lines = [l for l in lines if pattern in l]
        if not lines:
            emit_error(
                f"No symbols matching filter '{pattern}'",
                code=3,
                hint="Try a broader filter or omit --filter",
            )

    # Optional demangle
    if args.demangle:
        try:
            demangle_result = subprocess.run(
                ["xcrun", "swift-demangle"],
                input="\n".join(lines),
                capture_output=True, text=True, timeout=30,
            )
            if demangle_result.returncode == 0:
                lines = demangle_result.stdout.splitlines()
        except OSError:
            pass  # demangling is best-effort

    # Apply limit
    limit = args.limit
    truncated = len(lines) > limit
    lines = lines[:limit]

    output = "\n".join(lines)
    if truncated:
        output += f"\n\n... (truncated at {limit} lines)"

    # Write to file
    output_dir = resolve_output_dir(app_path, args.output)
    binaries_dir = output_dir / "binaries"
    binaries_dir.mkdir(parents=True, exist_ok=True)
    out_file = binaries_dir / "symbols.txt"
    out_file.write_text(output + "\n", encoding="utf-8")

    print(output)


# ---------------------------------------------------------------------------
# Sub-command: strings_grep
# ---------------------------------------------------------------------------

def cmd_strings_grep(args: argparse.Namespace) -> None:
    """Search for strings matching a regex pattern in the binary."""
    app_path = validate_app_path(args.app)
    binary = locate_main_binary(app_path)

    # Run strings | grep -E pattern
    try:
        strings_proc = subprocess.run(
            ["strings", str(binary)],
            capture_output=True, text=True, timeout=60,
        )
    except OSError as exc:
        emit_error(f"Failed to run 'strings': {exc}", code=2)

    if strings_proc.returncode != 0:
        emit_error(
            f"strings command failed: {strings_proc.stderr.strip()}",
            code=2,
        )

    try:
        grep_proc = subprocess.run(
            ["grep", "-E", args.pattern],
            input=strings_proc.stdout,
            capture_output=True, text=True, timeout=30,
        )
    except OSError as exc:
        emit_error(f"Failed to run 'grep': {exc}", code=2)

    # grep exit 1 means no matches
    if grep_proc.returncode == 1 or not grep_proc.stdout.strip():
        emit_error(
            f"No strings matching pattern '{args.pattern}'",
            code=3,
            hint="Try a broader pattern or check the binary with 'strings' directly",
        )
    if grep_proc.returncode not in (0, 1):
        emit_error(
            f"grep failed: {grep_proc.stderr.strip()}",
            code=2,
            hint="Check that the regex pattern is valid",
        )

    lines = grep_proc.stdout.splitlines()
    limit = args.limit
    truncated = len(lines) > limit
    lines = lines[:limit]

    output = "\n".join(lines)
    if truncated:
        output += f"\n\n... (truncated at {limit} lines)"

    # Write to file — sanitize pattern for filename
    safe_name = re.sub(r"[^\w\-.]", "_", args.pattern)[:80]
    output_dir = resolve_output_dir(app_path, args.output)
    strings_dir = output_dir / "binaries" / "strings"
    strings_dir.mkdir(parents=True, exist_ok=True)
    out_file = strings_dir / f"{safe_name}.txt"
    out_file.write_text(output + "\n", encoding="utf-8")

    print(output)


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="app_analyzer",
        description="Atomic toolbox for macOS .app bundle analysis.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Common arguments helper
    def add_common_args(sub: argparse.ArgumentParser) -> None:
        sub.add_argument(
            "--app",
            required=True,
            help="Path to the .app bundle",
        )
        sub.add_argument(
            "--output",
            default=None,
            help="Output directory (default: ./docs/dump/<AppName>.analysis/)",
        )

    # --- app_info ---
    p_info = subparsers.add_parser("app_info", help="Extract core metadata from Info.plist")
    add_common_args(p_info)
    p_info.set_defaults(func=cmd_app_info)

    # --- app_tree ---
    p_tree = subparsers.add_parser("app_tree", help="Print directory tree of the .app bundle")
    add_common_args(p_tree)
    p_tree.add_argument(
        "--depth",
        type=int,
        default=3,
        help="Max directory depth (default: 3)",
    )
    p_tree.set_defaults(func=cmd_app_tree)

    # --- file_type ---
    p_ftype = subparsers.add_parser("file_type", help="Identify file type using `file` command")
    add_common_args(p_ftype)
    p_ftype.add_argument(
        "--path",
        required=True,
        help="Relative path within the .app bundle",
    )
    p_ftype.set_defaults(func=cmd_file_type)

    # --- plist_read ---
    p_plist = subparsers.add_parser("plist_read", help="Read any plist file as JSON")
    add_common_args(p_plist)
    p_plist.add_argument(
        "--path",
        required=True,
        help="Relative path to a plist file within the .app bundle",
    )
    p_plist.set_defaults(func=cmd_plist_read)

    # --- binary_info ---
    p_binfo = subparsers.add_parser("binary_info", help="Analyse main binary: type, arch, size")
    add_common_args(p_binfo)
    p_binfo.set_defaults(func=cmd_binary_info)

    # --- dylib_list ---
    p_dylib = subparsers.add_parser("dylib_list", help="List dynamic libraries linked by the binary")
    add_common_args(p_dylib)
    p_dylib.set_defaults(func=cmd_dylib_list)

    # --- headers_dump ---
    p_headers = subparsers.add_parser("headers_dump", help="Dump Mach-O load commands")
    add_common_args(p_headers)
    p_headers.add_argument(
        "--section",
        default=None,
        help="Filter by load command type (e.g. LC_RPATH)",
    )
    p_headers.set_defaults(func=cmd_headers_dump)

    # --- symbols ---
    p_sym = subparsers.add_parser("symbols", help="Dump symbol table via nm")
    add_common_args(p_sym)
    p_sym.add_argument(
        "--filter",
        default=None,
        help="Keyword filter on symbol names",
    )
    p_sym.add_argument(
        "--demangle",
        action="store_true",
        help="Demangle Swift/C++ symbols via swift-demangle",
    )
    p_sym.add_argument(
        "--limit",
        type=int,
        default=2000,
        help="Max output lines (default: 2000)",
    )
    p_sym.set_defaults(func=cmd_symbols)

    # --- strings_grep ---
    p_str = subparsers.add_parser("strings_grep", help="Search binary strings with regex")
    add_common_args(p_str)
    p_str.add_argument(
        "--pattern",
        required=True,
        help="Regex pattern to match against strings",
    )
    p_str.add_argument(
        "--limit",
        type=int,
        default=1000,
        help="Max output lines (default: 1000)",
    )
    p_str.set_defaults(func=cmd_strings_grep)

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
