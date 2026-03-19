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
import subprocess
import sys
from pathlib import Path


# ---------------------------------------------------------------------------
# Error handling
# ---------------------------------------------------------------------------

def emit_error(message: str, code: int, hint: str = "") -> None:
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
    except FileNotFoundError:
        emit_error(
            "The 'file' command is not available on this system",
            code=2,
            hint="Install file utility or use macOS default system",
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

    def _make_serializable(obj):
        """Convert plist types to JSON-safe types."""
        if isinstance(obj, bytes):
            return obj.hex()
        if isinstance(obj, dict):
            return {k: _make_serializable(v) for k, v in obj.items()}
        if isinstance(obj, (list, tuple)):
            return [_make_serializable(item) for item in obj]
        if hasattr(obj, "isoformat"):
            return obj.isoformat()
        return obj

    serializable = _make_serializable(plist)
    output = json.dumps(serializable, indent=2, ensure_ascii=False)

    if not output or output == "{}":
        emit_error(
            "Plist file is empty or contains no data",
            code=3,
            hint="The file exists but has no useful content",
        )

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

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
