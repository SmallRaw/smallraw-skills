#!/usr/bin/env python3
"""Codex Visual GC Engine.

Sliding-window media garbage collector dedicated to OpenAI Codex.
Monitors session histories and prunes the oldest N% of oversized Base64 media
payloads when accumulated images cross a configurable threshold, preserving
the newest turns intact for seamless visual continuity and zero bandwidth bloat.
"""

import argparse
import json
import os
import re
import sqlite3
import sys
import time
from pathlib import Path

# Base Paths
SESSIONS_DIR = Path.home() / ".codex" / "sessions"
THREAD_DB = Path.home() / ".codex" / "thread_history_1.sqlite"
LOCK_FILE = Path.home() / ".codex" / "visual_gc.lock"
LOG_FILE = Path.home() / ".codex" / "visual_gc.log"
STATE_FILE = Path.home() / ".codex" / "visual_gc.state.json"
USER_CONFIG_FILE = Path.home() / ".codex" / "visual_gc.json"
PLUGIN_CONFIG_FILE = Path(__file__).resolve().parent.parent / "config.json"

# Regex for matching base64 media URIs
DATA_URI = re.compile(
    rb"data:(image|audio|application)/(?:pdf|octet-stream|[a-zA-Z0-9.+-]+);base64,[A-Za-z0-9+/=]+",
)

# 1-pixel tiny placeholders
TINY_PNG = b"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
TINY_WAV = b"data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA="
TINY_PDF = b"data:application/pdf;base64,JVBERi0xLjEKJeLjz9MKMSAwIG9iago8PC9UeXBlL0NhdGFsb2c+PgplbmRvYmoK"


def load_config():
    """Load configuration with fallback hierarchy: User Override -> Plugin Default -> Hardcoded."""
    defaults = {
        "gc": {
            "enabled": True,
            "threshold_mb": 20,
            "prune_ratio": 0.8,
            "min_keep_images": 2,
            "min_image_bytes": 100_000,
        },
        "capture": {
            "max_dimension": 1280,
            "jpeg_quality": 70,
        },
    }

    config = dict(defaults)
    cfg_path = None
    if USER_CONFIG_FILE.exists():
        cfg_path = USER_CONFIG_FILE
    elif PLUGIN_CONFIG_FILE.exists():
        cfg_path = PLUGIN_CONFIG_FILE

    if cfg_path:
        try:
            with open(cfg_path, "r", encoding="utf-8") as f:
                loaded = json.load(f)
                if "gc" in loaded:
                    config["gc"].update(loaded["gc"])
                if "capture" in loaded:
                    config["capture"].update(loaded["capture"])
        except Exception as e:
            log(f"Warning: Failed to parse {cfg_path}: {e}")

    return config


def log(message):
    stamp = time.strftime("%Y-%m-%d %H:%M:%S")
    try:
        with LOG_FILE.open("a", encoding="utf-8") as handle:
            handle.write(f"{stamp} {message}\n")
    except Exception:
        pass


def placeholder(kind):
    if kind == b"image":
        return TINY_PNG
    if kind == b"audio":
        return TINY_WAV
    return TINY_PDF


def inline_bytes(text, min_bytes=100_000):
    total = 0
    for match in DATA_URI.finditer(text):
        if len(match.group(0)) >= min_bytes:
            total += len(match.group(0))
    return total


def replace_payloads(text, prune_ratio=0.8, min_keep=2, min_bytes=100_000):
    """Replace oldest prune_ratio of large media URIs with tiny placeholders."""
    matches = [m for m in DATA_URI.finditer(text) if len(m.group(0)) >= min_bytes]
    total = len(matches)
    if total <= min_keep:
        return text, 0

    num_to_prune = min(total - min_keep, max(1, int(total * prune_ratio)))
    targets = matches[:num_to_prune]

    chunks = []
    last_idx = 0
    removed = 0
    for m in targets:
        start, end = m.span()
        chunks.append(text[last_idx:start])
        rep = placeholder(m.group(1))
        chunks.append(rep)
        removed += (end - start) - len(rep)
        last_idx = end
    chunks.append(text[last_idx:])
    return b"".join(chunks), removed


def page_key(path):
    stem = path.stem
    match = re.search(r"(01[0-9a-f]{6}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$", stem)
    return match.group(1) if match else stem


def parse_page(path):
    try:
        with path.open("rb") as handle:
            first = handle.readline()
        record = json.loads(first.decode("utf-8"))
    except Exception:
        return None

    if record.get("type") != "session_meta":
        return None

    payload = record.get("payload") or {}
    base = payload.get("history_base") or {}
    return {
        "path": path,
        "key": page_key(path),
        "parent_id": base.get("thread_id"),
        "end_ordinal": base.get("end_ordinal_exclusive"),
        "end_byte_offset": base.get("end_byte_offset"),
    }


def ordinal_offset(path, ordinal):
    position = 0
    try:
        with path.open("rb") as handle:
            for line in handle:
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    position += len(line)
                    continue
                if record.get("ordinal") == ordinal:
                    return position
                position += len(line)
    except Exception:
        pass
    return None


def rewrite_history_base(path, new_offset):
    try:
        before = path.stat().st_size
        raw = path.read_bytes()
        if len(raw) != before:
            return None
        newline = raw.find(b"\n")
        record = json.loads(raw[:newline].decode("utf-8"))
        record["payload"]["history_base"]["end_byte_offset"] = new_offset
        encoded = json.dumps(record, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_bytes(encoded + b"\n" + raw[newline + 1:])
        os.replace(temporary, path)
        return len(encoded) + 1 - (newline + 1)
    except Exception as e:
        log(f"rewrite_history_base error: {e}")
        return None


def current_session_id():
    """Find the session id of the turn that just completed."""
    if not THREAD_DB.exists():
        return None
    try:
        try:
            conn = sqlite3.connect(f"file:{THREAD_DB}?mode=ro", uri=True, timeout=3)
        except sqlite3.Error:
            conn = sqlite3.connect(str(THREAD_DB), timeout=5)
        row = conn.execute(
            "SELECT thread_id FROM thread_turns "
            "WHERE status = 'completed' AND completed_at IS NOT NULL "
            "ORDER BY completed_at DESC LIMIT 1"
        ).fetchone()
        conn.close()
        return row[0] if row else None
    except Exception as e:
        log(f"current session lookup skipped: {e}")
        return None


def process_pages(pages, threshold_bytes, prune_ratio, min_keep, min_bytes, dry_run=False):
    """Run sliding window GC on a group of session pages."""
    by_key = {page["key"]: page for page in pages}
    total_reclaimed = 0

    for page in pages:
        p = page["path"]
        try:
            raw = p.read_bytes()
            cur = inline_bytes(raw, min_bytes=min_bytes)
            if cur < threshold_bytes:
                continue

            rewritten, removed = replace_payloads(
                raw, prune_ratio=prune_ratio, min_keep=min_keep, min_bytes=min_bytes
            )
            if removed == 0:
                continue

            total_reclaimed += removed
            msg = (
                f"GC pruned {removed / (1024*1024):.1f} MB from {p.name} "
                f"({cur / (1024*1024):.1f}MB -> {(cur - removed) / (1024*1024):.1f}MB, "
                f"kept newest {1 - prune_ratio:.0%})"
            )
            print(msg)
            log(msg)

            if not dry_run:
                tmp = p.with_suffix(p.suffix + ".tmp")
                tmp.write_bytes(rewritten)
                os.replace(tmp, p)

        except Exception as e:
            log(f"Error processing {p.name}: {e}")

    # Re-align paginated child offsets if any parent shrank
    if not dry_run:
        pending = [page for page in pages if page["parent_id"] in by_key]
        seen = set()
        while pending:
            progressed = False
            for page in list(pending):
                parent = by_key[page["parent_id"]]
                if parent["parent_id"] in by_key and parent["key"] not in seen:
                    continue
                pending.remove(page)
                seen.add(page["key"])
                progressed = True
                old_offset = page["end_byte_offset"]
                if not isinstance(old_offset, int) or not isinstance(page["end_ordinal"], int):
                    continue
                new_offset = ordinal_offset(parent["path"], page["end_ordinal"])
                if new_offset is None or new_offset == old_offset:
                    continue
                delta = rewrite_history_base(page["path"], new_offset)
                if delta is not None:
                    page["end_byte_offset"] = new_offset
                    log(f"re-aligned {page['path'].name} offset {old_offset} -> {new_offset}")
            if not progressed:
                break

    return total_reclaimed


def main():
    parser = argparse.ArgumentParser(description="Codex Visual GC Engine")
    parser.add_argument("--sweep-all", action="store_true", help="Sweep all recent sessions in ~/.codex/sessions")
    parser.add_argument("--threshold-mb", type=float, default=None, help="Override threshold in MB")
    parser.add_argument("--prune-ratio", type=float, default=None, help="Override prune ratio (e.g. 0.8)")
    parser.add_argument("--dry-run", action="store_true", help="Simulate without modifying files")
    args = parser.parse_args()

    config = load_config()
    if not config["gc"].get("enabled", True):
        return

    threshold_bytes = int((args.threshold_mb or config["gc"]["threshold_mb"]) * 1024 * 1024)
    prune_ratio = float(args.prune_ratio or config["gc"]["prune_ratio"])
    min_keep = int(config["gc"].get("min_keep_images", 2))
    min_bytes = int(config["gc"].get("min_image_bytes", 100_000))

    try:
        lock_fd = os.open(LOCK_FILE, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
    except FileExistsError:
        return

    try:
        os.write(lock_fd, str(os.getpid()).encode())

        if args.sweep_all:
            # Global sweep: check all recent jsonl files
            all_files = list(SESSIONS_DIR.glob("**/*.jsonl"))
            pages = [info for p in all_files if (info := parse_page(p))]
            total = process_pages(pages, threshold_bytes, prune_ratio, min_keep, min_bytes, dry_run=args.dry_run)
            print(f"Sweep complete. Total reclaimed: {total / (1024*1024):.1f} MB")
        else:
            # Turn-ended sweep: inspect session whose turn just ended
            session_id = current_session_id()
            if not session_id:
                return
            session_files = list(SESSIONS_DIR.glob(f"**/*{session_id}*.jsonl"))
            pages = [info for p in session_files if (info := parse_page(p))]
            process_pages(pages, threshold_bytes, prune_ratio, min_keep, min_bytes, dry_run=args.dry_run)

    finally:
        os.close(lock_fd)
        LOCK_FILE.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
