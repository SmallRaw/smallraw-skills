#!/usr/bin/env python3
"""在 macOS 上审计、SHA-256 校验备份并清理 Claude Code / Claude Desktop 旧账户状态。"""

from __future__ import annotations

import argparse
import datetime as dt
import glob
import hashlib
import json
import os
import pathlib
import secrets
import shutil
import stat
import subprocess
import sys
import tempfile

TELEMETRY_KEYS = (
    "DISABLE_TELEMETRY",
    "DO_NOT_TRACK",
    "DISABLE_ERROR_REPORTING",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
)
AUDIT_ENV_KEYS = (
    "CLAUDE_CONFIG_DIR",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
)
# ~/.claude.json、内部备份及 Desktop config.json 中与账户/组织/引导/实验相关的顶层键
ACCOUNT_CACHE_KEYS = {
    "accountUuid",
    "additionalModelCostsCache",
    "additionalModelOptionsCache",
    "anonymousId",
    "autoCompactWindowsCache",
    "cachedChromeExtensionInstalled",
    "cachedDynamicConfigs",
    "cachedExperimentData",
    "cachedExperimentFeatures",
    "cachedExtraUsageDisabledReason",
    "cachedGrowthBookFeatures",
    "cachedGrowthBookFeaturesAt",
    "cachedRateLimitTier",
    "cachedStatsigGates",
    "claudeCodeFirstTokenDate",
    "clientDataCache",
    "clientDataCacheSlots",
    "customApiKeyResponses",
    "fallbackAvailableWarningThreshold",
    "feedbackSurveyState",
    "firstStartTime",
    "groveConfigCache",
    "hasAcknowledgedCostThreshold",
    "hasCompletedOnboarding",
    "isQualifiedForDataSharing",
    "lastKnownAccountUuid",
    "lastOnboardingVersion",
    "metricsStatusCache",
    "modelAccessCache",
    "oauth:tokenCache",
    "oauth:tokenCacheV2",
    "oauthAccount",
    "orgModelDefaultCache",
    "opus45MigrationComplete",
    "opusProMigrationComplete",
    "passesEligibilityCache",
    "penguinModeOrgEnabled",
    "s1mAccessCache",
    "s1mNonSubscriberAccessCache",
    "sonnet45MigrationComplete",
    "subscriptionNoticeCount",
    "tenancyCache",
}
DYNAMIC_CACHE_SUFFIXES = ("AccessCache", "CostsCache", "OptionsCache", "DefaultCache")

# 绝对受保护目录/文件（绝不允许 move_to_trash 触碰或跨越）
PROTECTED = {
    "CLAUDE.md",
    "agents",
    "backups",
    "channels",
    "commands",
    "file-history",
    "history.jsonl",
    "hooks",
    "hud-config.json",
    "keybindings.json",
    "mcp-servers",
    "plans",
    "plugins",
    "projects",
    "rules",
    "scheduled-tasks",
    "scripts",
    "sessions",
    "settings.json",
    "settings.local.json",
    "skills",
    "statusline-command.sh",
    "tasks",
    "teams",
    "todos",
    "usage-data",
}

# ~/.claude 下可安全自动清理的可再生缓存、遥测与旧 auth 冷却状态
CLI_SAFE_RELATIVE = (
    "cache",
    "stats-cache.json",
    "telemetry",
    "usage.jsonl",
    "usage.with-fix.jsonl",
    "remote-settings.json",
    "daemon-auth-cooldown",
    "daemon-auth-status.json",
    "daemon.log",
    "gh-pr-status-cache.json",
    ".last-cleanup",
    ".last-update-result.json",
    "paste-cache",
    "shell-snapshots",
    "feedback",
    "hud/usage-cache.json",
    "hud/usage-last-fetch",
    "hud/keychain-backoff",
    "hud/sessions",
)

# ~/.claude 下深层运行与设备状态（用户选择是否清理）
CLI_DEEP_RELATIVE = (
    "daemon",
    "vercel-plugin-device-id",
    "debug",
    "ide",
    "session-env",
    "state",
)

DESKTOP_CACHE_RELATIVE = tuple(
    f"Library/Application Support/Claude/{name}"
    for name in (
        "Cache",
        "Code Cache",
        "GPUCache",
        "DawnCache",
        "DawnGraphiteCache",
        "DawnWebGPUCache",
        "GPUPersistentCache",
        "GraphiteDawnCache",
        "Crashpad",
        "sentry",
        "window-state.json",
        "vm-support-probe.json",
    )
)

HOME_SAFE_RELATIVE = (
    ".cache/claude-cli-nodejs",
    "Library/Caches/claude-cli-nodejs",
    "Library/Logs/Claude",
    *DESKTOP_CACHE_RELATIVE,
)
HOME_SAFE_GLOBS = (
    ".claude.json.tmp.*",
    "Library/Caches/com.anthropic.claudefordesktop*",
    "Library/Logs/DiagnosticReports/Claude*",
    "Library/Application Support/CrashReporter/Claude*",
)

# Desktop 定向登录态/Web存储/设备记录清理（模式 1：保留 claude_desktop_config.json 与会话目录）
DESKTOP_AUTH_RELATIVE = tuple(
    f"Library/Application Support/Claude/{name}"
    for name in (
        "config.json.journal",
        "ant-did",
        "ant-device-registry.json",
        "Cookies",
        "Cookies-journal",
        "Local Storage",
        "Session Storage",
        "IndexedDB",
        "WebStorage",
        "Network",
        "Network Persistent State",
        "TransportSecurity",
        "Trust Tokens",
        "Trust Tokens-journal",
        "DIPS",
        "DIPS-wal",
        "DIPS-shm",
        "SharedStorage",
        "SharedStorage-wal",
        "QuotaManager",
        "QuotaManager-journal",
        "Service Worker",
        "blob_storage",
        "Session",
        "Sessions",
        "Preferences",
        "Local State",
        "Partitions",
    )
)

DESKTOP_FULL_RELATIVE = (
    "Library/Application Support/Claude",
    "Library/Application Support/Claude-3p",
    "Library/Application Support/com.anthropic.claudefordesktop",
    "Library/Saved Application State/com.anthropic.claudefordesktop.savedState",
)
DESKTOP_SYSTEM_RELATIVE = (
    "Library/Application Support/Claude-3p",
    "Library/Application Support/com.anthropic.claudefordesktop",
    "Library/Saved Application State/com.anthropic.claudefordesktop.savedState",
)
DESKTOP_GLOBS = (
    "Library/HTTPStorages/com.anthropic.claudefordesktop*",
    "Library/Preferences/com.anthropic.claudefordesktop*.plist",
    "Library/Preferences/ByHost/com.anthropic.claudefordesktop*.plist",
    "Library/WebKit/com.anthropic.claudefordesktop*",
    "Library/Cookies/com.anthropic.claudefordesktop*",
    "Library/Group Containers/*anthropic*",
    "Library/Group Containers/*claude*",
    "Library/Containers/*anthropic*",
    "Library/Containers/*claude*",
)
DESKTOP_DEVICE_RECORDS = (
    "Library/Application Support/Claude/ant-did",
    "Library/Application Support/Claude/ant-device-registry.json",
)
DESKTOP_KEYCHAIN_SERVICES = (
    "Claude Safe Storage",
    "Claude Key",
    "com.anthropic.claudefordesktop",
    "com.anthropic.claudefordesktop.ShipIt",
)
INTERNET_PASSWORD_HOSTS = (
    "claude.ai",
    "console.anthropic.com",
    "platform.claude.com",
)
IDE_EXTENSION_GLOBS = (
    ".vscode/extensions/*anthropic*",
    ".vscode/extensions/*claude*",
    ".cursor/extensions/*anthropic*",
    ".cursor/extensions/*claude*",
    ".windsurf/extensions/*anthropic*",
    ".windsurf/extensions/*claude*",
)
APP = pathlib.Path("/Applications/Claude.app")
DESKTOP_BUNDLE_ID = "com.anthropic.claudefordesktop"
MIN_FREE_BUFFER_BYTES = 100 * 1024 * 1024


def read_json(path: pathlib.Path, default: object | None = None) -> object:
    if not path.exists() and default is not None:
        return default
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: pathlib.Path, data: object) -> None:
    """以原子方式写入 JSON，保留原有权限或默认 0600。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    mode = stat.S_IMODE(path.stat().st_mode) if path.exists() else 0o600
    fd, name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temp = pathlib.Path(name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temp, mode)
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def safe_path(home: pathlib.Path, target: pathlib.Path) -> pathlib.Path:
    """确保路径位于 home 内（允许系统路径如 /Applications/Claude.app 另行校验）且父级链路不含符号链接。"""
    home_abs = home.absolute()
    target_abs = target.absolute()
    target_abs.relative_to(home_abs)
    for part in [target_abs, *target_abs.parents]:
        if part == home_abs:
            break
        if part.is_symlink():
            raise RuntimeError(f"拒绝穿过符号链接的路径：{target}")
    return target


def settings_env(data: object) -> dict[str, object]:
    if not isinstance(data, dict) or not isinstance(data.get("env", {}), dict):
        raise ValueError("settings.json 的顶层或 env 结构异常，拒绝修改")
    return data.get("env", {})


def telemetry(data: object) -> dict[str, object | None]:
    env = settings_env(data)
    return {key: env.get(key) for key in TELEMETRY_KEYS}


def resolve_claude_dirs(home: pathlib.Path) -> list[pathlib.Path]:
    """返回当前生效的 Claude 配置目录列表（去重，包含 CLAUDE_CONFIG_DIR 与默认 ~/.claude）。"""
    candidates: list[pathlib.Path] = []
    custom = os.environ.get("CLAUDE_CONFIG_DIR", "").strip()
    if custom:
        candidates.append(pathlib.Path(custom).expanduser())
    candidates.append(home / ".claude")
    unique: list[pathlib.Path] = []
    seen: set[pathlib.Path] = set()
    for path in candidates:
        resolved = path.resolve() if path.exists() else path.absolute()
        if resolved not in seen:
            seen.add(resolved)
            unique.append(path)
    return unique


def global_config(home: pathlib.Path) -> pathlib.Path:
    custom = os.environ.get("CLAUDE_CONFIG_DIR", "").strip()
    return (pathlib.Path(custom).expanduser() if custom else home) / ".claude.json"


def config_dir_keychain_services() -> list[str]:
    """计算默认及自定义 CLAUDE_CONFIG_DIR 对应的 Keychain 服务名（不读取密码）。"""
    services = ["Claude Code-credentials"]
    custom = os.environ.get("CLAUDE_CONFIG_DIR", "").strip()
    if custom:
        expanded = str(pathlib.Path(custom).expanduser())
        for raw in {custom, expanded, str(pathlib.Path(expanded).resolve())}:
            digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:8]
            name = f"Claude Code-credentials-{digest}"
            if name not in services:
                services.append(name)
    return services


def keychain_service_exists(service: str) -> bool:
    """仅检测 Keychain 条目是否存在，绝不带 -w 或 -g 读取密码。"""
    if sys.platform != "darwin" or not shutil.which("security"):
        return False
    result = subprocess.run(
        ["security", "find-generic-password", "-s", service],
        capture_output=True,
        text=True,
        check=False,
    )
    return result.returncode == 0


def internet_password_exists(server: str) -> bool:
    if sys.platform != "darwin" or not shutil.which("security"):
        return False
    result = subprocess.run(
        ["security", "find-internet-password", "-s", server],
        capture_output=True,
        text=True,
        check=False,
    )
    return result.returncode == 0


def delete_keychain_service(service: str) -> int:
    """循环删除同名 Keychain 通用密码条目直到不存在，返回删除计数。"""
    deleted = 0
    for _ in range(20):
        result = subprocess.run(
            ["security", "delete-generic-password", "-s", service],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode == 44:
            break
        if result.returncode != 0:
            raise RuntimeError(f"钥匙串条目 {service} 删除失败：{result.stderr.strip()}")
        deleted += 1
    return deleted


def is_account_cache_key(key: str) -> bool:
    if key in ACCOUNT_CACHE_KEYS:
        return True
    if key.startswith("cached"):
        return True
    return key.endswith(DYNAMIC_CACHE_SUFFIXES)


def collect_identity_files(
    home: pathlib.Path, include_cli: bool = True, include_desktop: bool = True
) -> list[pathlib.Path]:
    """收集 ~/.claude.json、目录内 .claude.json、内部备份，以及可选的 Desktop config.json。"""
    candidates: list[pathlib.Path] = []
    if include_cli:
        candidates.extend([global_config(home), home / ".claude.json"])
        for cdir in resolve_claude_dirs(home):
            candidates.append(cdir / ".claude.json")
            backups = cdir / "backups"
            if backups.is_dir():
                candidates.extend(
                    sorted(p for p in backups.glob(".claude.json.backup.*") if p.is_file() and not p.is_symlink())
                )
    if include_desktop:
        candidates.append(home / "Library/Application Support/Claude/config.json")
    found: list[pathlib.Path] = []
    seen: set[pathlib.Path] = set()
    for path in candidates:
        if path.is_file() and not path.is_symlink():
            if home in path.absolute().parents:
                safe_path(home, path)
            resolved = path.resolve()
            if resolved not in seen:
                seen.add(resolved)
                found.append(path)
    return found


def inspect_identity_keys(home: pathlib.Path) -> dict[str, list[str]]:
    """仅返回各身份文件中命中的敏感/账号键名（绝不读取或返回任何键的值）。"""
    report: dict[str, list[str]] = {}
    for path in collect_identity_files(home, include_desktop=True):
        try:
            data = read_json(path)
        except (OSError, ValueError, json.JSONDecodeError):
            report[str(path)] = ["<JSON 解析失败>"]
            continue
        if not isinstance(data, dict):
            continue
        matched = sorted(
            k for k in data.keys() if k in {"userID", "machineID"} or is_account_cache_key(k)
        )
        if matched:
            report[str(path)] = matched
    return report


def existing_paths(paths: list[pathlib.Path], home: pathlib.Path | None = None) -> list[pathlib.Path]:
    """去重、校验符号链接父目录，并剔除已被父目录包含的子路径（防止先移父目录后子路径报错）。"""
    unique: list[pathlib.Path] = []
    seen: set[pathlib.Path] = set()
    for p in paths:
        if p.exists() or p.is_symlink():
            if home is not None and p != APP:
                safe_path(home, p)
            abs_p = p.absolute()
            if abs_p not in seen:
                seen.add(abs_p)
                unique.append(p)
    ordered = sorted(unique, key=str)
    pruned: list[pathlib.Path] = []
    pruned_abs: set[pathlib.Path] = set()
    for p in ordered:
        abs_p = p.absolute()
        if any(parent in pruned_abs for parent in abs_p.parents):
            continue
        pruned.append(p)
        pruned_abs.add(abs_p)
    return pruned


def discover(home: pathlib.Path) -> dict[str, list[pathlib.Path]]:
    """按风险层级盘点本机 Claude 足迹。"""
    cdirs = resolve_claude_dirs(home)
    safe: list[pathlib.Path] = []
    deep: list[pathlib.Path] = []
    creds: list[pathlib.Path] = []

    for cdir in cdirs:
        safe.extend(cdir / rel for rel in CLI_SAFE_RELATIVE)
        deep.extend(cdir / rel for rel in CLI_DEEP_RELATIVE)
        creds.append(cdir / ".credentials.json")

    safe.extend(home / rel for rel in HOME_SAFE_RELATIVE)
    for pattern in HOME_SAFE_GLOBS:
        safe.extend(map(pathlib.Path, glob.glob(str(home / pattern))))

    deep.extend(home / rel for rel in DESKTOP_DEVICE_RECORDS)

    desktop_auth: list[pathlib.Path] = [home / rel for rel in DESKTOP_AUTH_RELATIVE]
    desktop_auth.extend(home / rel for rel in DESKTOP_SYSTEM_RELATIVE)
    desktop_full: list[pathlib.Path] = [home / rel for rel in DESKTOP_FULL_RELATIVE]
    for pattern in DESKTOP_GLOBS:
        matched = list(map(pathlib.Path, glob.glob(str(home / pattern))))
        desktop_auth.extend(matched)
        desktop_full.extend(matched)

    ide_exts: list[pathlib.Path] = []
    for pattern in IDE_EXTENSION_GLOBS:
        ide_exts.extend(map(pathlib.Path, glob.glob(str(home / pattern))))

    return {
        "safe": existing_paths(safe, home),
        "deep": existing_paths(deep, home),
        "credentials_files": existing_paths(creds, home),
        "desktop_auth": existing_paths(desktop_auth, home),
        "desktop_full": existing_paths(desktop_full, home),
        "ide_extensions": existing_paths(ide_exts),
    }


def claude_processes() -> list[str]:
    result = subprocess.run(
        ["ps", "-axo", "pid=,comm=,args="],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    found = []
    for line in result.stdout.splitlines():
        parts = line.strip().split(maxsplit=2)
        if len(parts) < 2 or parts[0] == str(os.getpid()):
            continue
        command = pathlib.Path(parts[1]).name.lower()
        args = parts[2] if len(parts) == 3 else ""
        first = pathlib.Path(args.split(maxsplit=1)[0]).name.lower() if args else ""
        if (
            command in {"claude", "claude-code", "claude helper"}
            or first in {"claude", "claude-code"}
            or "/claude.app/" in line.lower()
            or "com.anthropic.claudefordesktop" in line.lower()
            or "/@anthropic-ai/claude-code" in args.lower()
        ):
            found.append(line.strip())
    return found


def running_under_claude() -> bool:
    if os.environ.get("CLAUDECODE", "").strip() in {"1", "true"} or os.environ.get("CLAUDE_CODE_ENTRYPOINT", "").strip():
        return True
    pid = os.getppid()
    for _ in range(12):
        result = subprocess.run(
            ["ps", "-p", str(pid), "-o", "ppid=,comm=,args="],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
        parts = result.stdout.strip().split(maxsplit=2)
        if len(parts) < 2:
            return False
        command = pathlib.Path(parts[1]).name.lower()
        first = (
            pathlib.Path(parts[2].split(maxsplit=1)[0]).name.lower()
            if len(parts) == 3 and parts[2].strip()
            else ""
        )
        if command in {"claude", "claude-code"} or first in {"claude", "claude-code"}:
            return True
        next_pid = int(parts[0])
        if next_pid <= 1 or next_pid == pid:
            return False
        pid = next_pid
    return False


def current_timezone() -> str:
    try:
        target = pathlib.Path("/etc/localtime").readlink().as_posix()
    except OSError:
        return "未知"
    return target.split("/zoneinfo/", 1)[1] if "/zoneinfo/" in target else "未知"


def file_sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def is_special_file(path: pathlib.Path) -> bool:
    """检测 Unix socket / FIFO 等特殊文件（无法作为普通文件复制，备份时跳过）。"""
    try:
        mode = path.lstat().st_mode
    except OSError:
        return False
    return stat.S_ISSOCK(mode) or stat.S_ISFIFO(mode)


def tree_inventory(root: pathlib.Path) -> dict[str, dict[str, object]]:
    """生成目录树或单文件的 SHA-256 与大小清单（兼容符号链接并跳过 socket/FIFO）。"""
    def describe(path: pathlib.Path) -> dict[str, object] | None:
        if path.is_symlink():
            return {"type": "symlink", "target": os.readlink(path)}
        if path.is_dir():
            return {"type": "directory"}
        if is_special_file(path):
            return None
        if not path.is_file():
            raise RuntimeError(f"拒绝非普通文件：{path}")
        return {"type": "file", "size": path.stat().st_size, "sha256": file_sha256(path)}

    result: dict[str, dict[str, object]] = {}
    root_desc = describe(root)
    if root_desc is not None:
        result["."] = root_desc
    if root.is_dir() and not root.is_symlink():
        for child in sorted(root.rglob("*")):
            desc = describe(child)
            if desc is not None:
                result[str(child.relative_to(root))] = desc
    return result


def dir_stats(root: pathlib.Path) -> tuple[int, int]:
    regular = [p for p in root.rglob("*") if p.is_file() and not p.is_symlink()]
    return len(regular), sum(p.stat().st_size for p in regular)


def path_size(path: pathlib.Path) -> int:
    try:
        if path.is_symlink():
            return 0
        if path.is_file():
            return path.stat().st_size
        if path.is_dir():
            return dir_stats(path)[1]
    except OSError:
        return 0
    return 0


def format_size(num_bytes: int) -> str:
    if num_bytes < 1024:
        return f"{num_bytes} B"
    if num_bytes < 1024 * 1024:
        return f"{num_bytes / 1024:.1f} KB"
    if num_bytes < 1024 * 1024 * 1024:
        return f"{num_bytes / (1024 * 1024):.2f} MB"
    return f"{num_bytes / (1024 * 1024 * 1024):.2f} GB"


def ensure_backups_root(home: pathlib.Path) -> pathlib.Path:
    root = home / "ClaudeBackups"
    root.mkdir(parents=True, exist_ok=True)
    os.chmod(root, 0o700)
    gitignore = root / ".gitignore"
    if not gitignore.exists():
        gitignore.write_text("*\n!.gitignore\n", encoding="utf-8")
    return root


def create_backup(home: pathlib.Path, extra_paths: list[pathlib.Path] | None = None) -> pathlib.Path:
    """完整备份 Claude 配置与待操作目标到 ~/ClaudeBackups/，并逐文件 SHA-256 校验。"""
    cdirs = resolve_claude_dirs(home)
    primary = cdirs[0]
    if not primary.is_dir():
        raise FileNotFoundError(f"{primary} 不存在，无法满足先全量备份的硬要求")

    cdir_abs_set = {cdir.absolute() for cdir in cdirs}

    def inside_claude_dirs(path: pathlib.Path) -> bool:
        p_abs = path.absolute()
        return p_abs in cdir_abs_set or any(root in p_abs.parents for root in cdir_abs_set)

    files, total_bytes = dir_stats(primary)
    for extra_dir in cdirs[1:]:
        if extra_dir.is_dir() and not extra_dir.is_symlink():
            extra_f, extra_b = dir_stats(extra_dir)
            files += extra_f
            total_bytes += extra_b
    extra_bytes = sum(
        (dir_stats(p)[1] if p.is_dir() and not p.is_symlink() else (p.stat().st_size if p.is_file() else 0))
        for p in (extra_paths or [])
        if p.exists() and not p.is_symlink() and not inside_claude_dirs(p)
    )
    if shutil.disk_usage(home).free < total_bytes + extra_bytes + MIN_FREE_BUFFER_BYTES:
        raise RuntimeError("备份可用磁盘空间不足（需预留待备份数据 + 100 MB 余量）")

    backups_root = ensure_backups_root(home)
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    partial = backups_root / f"claude-account-backup-{stamp}.partial"
    final = partial.with_suffix("")
    partial.mkdir(parents=True)
    os.chmod(partial, 0o700)

    hashes: dict[str, dict[str, dict[str, object]]] = {}

    def ignore_special(directory: str, contents: list[str]) -> set[str]:
        base = pathlib.Path(directory)
        return {name for name in contents if is_special_file(base / name)}

    def copy_verified_dir(src: pathlib.Path, dst: pathlib.Path, key: str) -> None:
        expected = tree_inventory(src)
        shutil.copytree(src, dst, symlinks=True, ignore=ignore_special)
        if tree_inventory(dst) != expected:
            raise RuntimeError(f"{src} SHA-256 备份校验失败，保留未完成副本：{partial}")
        hashes[key] = expected

    def copy_verified_file(src: pathlib.Path, dst: pathlib.Path, key: str) -> bool:
        if not src.is_file() or src.is_symlink():
            return False
        expected = tree_inventory(src)
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        if tree_inventory(dst) != expected:
            raise RuntimeError(f"{src} SHA-256 备份校验失败，保留未完成副本：{partial}")
        hashes[key] = expected
        return True

    copy_verified_dir(primary, partial / "dot-claude", "dot-claude")

    extra_dirs: list[str] = []
    for index, extra in enumerate(cdirs[1:], start=1):
        if extra.is_dir():
            dest_name = f"extra-claude-{index}"
            copy_verified_dir(extra, partial / dest_name, dest_name)
            extra_dirs.append(str(extra))

    global_json = global_config(home)
    copied_global = copy_verified_file(global_json, partial / "claude.json", "claude.json")

    default_json = home / ".claude.json"
    copied_default_json = False
    if default_json.is_file() and (not global_json.exists() or default_json.resolve() != global_json.resolve()):
        copied_default_json = copy_verified_file(default_json, partial / "home-claude.json", "home-claude.json")

    dot_claude_json = primary / ".claude.json"
    copied_dot_claude_json = False
    if dot_claude_json.is_file() and (not global_json.exists() or dot_claude_json.resolve() != global_json.resolve()):
        copied_dot_claude_json = copy_verified_file(dot_claude_json, partial / "dot-claude-json", "dot-claude-json")

    desktop_cfg = home / "Library/Application Support/Claude/claude_desktop_config.json"
    copied_desktop_cfg = copy_verified_file(
        desktop_cfg, partial / "desktop-config/claude_desktop_config.json", "desktop-config/claude_desktop_config.json"
    )
    desktop_state_cfg = home / "Library/Application Support/Claude/config.json"
    copied_desktop_state = copy_verified_file(
        desktop_state_cfg, partial / "desktop-config/config.json", "desktop-config/config.json"
    )

    # 对位于配置目录之外的待移入废纸篓目标（如 Desktop 数据/Preferences/CrashReporter）一并做 SHA-256 备份
    for path in extra_paths or []:
        if path == APP or not (path.exists() or path.is_symlink()) or inside_claude_dirs(path):
            continue
        try:
            rel = path.absolute().relative_to(home.absolute())
        except ValueError:
            continue
        dst = partial / "external" / rel
        if dst.exists() or dst.is_symlink():
            continue
        key = f"external/{rel}"
        if path.is_symlink():
            dst.parent.mkdir(parents=True, exist_ok=True)
            os.symlink(os.readlink(path), dst)
            hashes[key] = tree_inventory(dst)
        elif path.is_dir():
            copy_verified_dir(path, dst, key)
        elif path.is_file():
            copy_verified_file(path, dst, key)

    keychain_present = [
        svc
        for svc in config_dir_keychain_services() + list(DESKTOP_KEYCHAIN_SERVICES)
        if keychain_service_exists(svc)
    ]

    write_json(partial / "hashes.json", hashes)
    write_json(
        partial / "manifest.json",
        {
            "createdAt": dt.datetime.now().isoformat(timespec="seconds"),
            "primaryClaudeDir": str(primary),
            "extraClaudeDirs": extra_dirs,
            "files": files,
            "regularFileBytes": total_bytes,
            "claudeJsonCopied": copied_global,
            "homeClaudeJsonCopied": copied_default_json,
            "dotClaudeJsonCopied": copied_dot_claude_json,
            "desktopConfigCopied": copied_desktop_cfg,
            "desktopStateConfigCopied": copied_desktop_state,
            "keychainServicesPresent": keychain_present,
        },
    )
    partial.rename(final)
    os.chmod(final, 0o700)
    return final


def list_backups(home: pathlib.Path) -> list[str]:
    root = home / "ClaudeBackups"
    if not root.is_dir():
        return ["尚未发现备份目录（~/ClaudeBackups 不存在）。"]
    entries = sorted(
        (p for p in root.iterdir() if p.is_dir() and p.name.startswith("claude-")),
        reverse=True,
    )
    if not entries:
        return ["~/ClaudeBackups 下暂无备份快照。"]
    lines = [f"备份根目录：{root}"]
    for entry in entries:
        manifest_path = entry / "manifest.json"
        if manifest_path.is_file():
            try:
                m = read_json(manifest_path, {})
                if isinstance(m, dict):
                    mb = round(int(m.get("regularFileBytes", 0)) / (1024 * 1024), 2)
                    lines.append(
                        f"- {entry.name} | 时间：{m.get('createdAt', '未知')} | "
                        f"文件：{m.get('files', '?')} ({mb} MB) | "
                        f"SHA-256：{'是' if (entry / 'hashes.json').is_file() else '否'} | "
                        f"desktop_config：{'是' if m.get('desktopConfigCopied') else '否'}"
                    )
                    continue
            except (OSError, ValueError, json.JSONDecodeError):
                pass
        lines.append(f"- {entry.name}（无有效 manifest.json）")
    return lines


def move_to_trash(
    target: pathlib.Path,
    allowed: set[pathlib.Path],
    cdirs: list[pathlib.Path],
    batch: pathlib.Path,
    index: int = 0,
) -> pathlib.Path:
    """严格校验白名单与绝对保护路径后，将目标移入时间戳废纸篓批次。"""
    absolute = target.absolute()
    for cdir in cdirs:
        cdir_abs = cdir.absolute()
        if absolute == cdir_abs or absolute in cdir_abs.parents:
            raise RuntimeError(f"拒绝触碰受保护配置根目录或其父级：{target}")
        for name in PROTECTED:
            p_abs = (cdir / name).absolute()
            if absolute == p_abs or p_abs in absolute.parents or absolute in p_abs.parents:
                raise RuntimeError(f"拒绝触碰受保护路径：{target}")
    if absolute not in {path.absolute() for path in allowed}:
        raise RuntimeError(f"目标不在删除白名单：{target}")
    batch.mkdir(parents=True, exist_ok=True)
    destination = batch / f"{index:03d}-{target.name}"
    shutil.move(str(target), str(destination))
    return destination


def protected_paths_for(home: pathlib.Path) -> list[pathlib.Path]:
    return [cdir / name for cdir in resolve_claude_dirs(home) for name in PROTECTED]


def rotate_identity(
    home: pathlib.Path, include_cli: bool = True, include_desktop: bool = False
) -> tuple[int, int, list[dict[str, object]]]:
    """轮换 .claude.json 全家族的 userID/machineID，并清除 CLI / Desktop config.json 中的账号与缓存键。"""
    files = collect_identity_files(home, include_cli=include_cli, include_desktop=include_desktop)
    if not files:
        return 0, 0, []
    ids = {"userID": secrets.token_hex(32), "machineID": secrets.token_hex(32)}
    prepared: list[tuple[pathlib.Path, dict[str, object], list[str]]] = []
    total_removed = 0
    desktop_cfg = (home / "Library/Application Support/Claude/config.json").resolve()
    for path in files:
        data = read_json(path)
        if not isinstance(data, dict):
            raise ValueError(f"身份文件不是 JSON object：{path}")
        updated = dict(data)
        edited_keys: list[str] = []
        # Desktop config.json 不写 CLI 的 userID/machineID，只剥离账号/令牌键
        if path.resolve() != desktop_cfg:
            updated.update(ids)
            edited_keys.extend(["userID(rotated)", "machineID(rotated)"])
        for key in list(updated.keys()):
            if is_account_cache_key(key):
                updated.pop(key, None)
                edited_keys.append(key)
                total_removed += 1
        prepared.append((path, updated, edited_keys))
    audit_edits: list[dict[str, object]] = []
    for path, data, edited_keys in prepared:
        write_json(path, data)
        if read_json(path) != data:
            raise RuntimeError(f"JSON 写入校验失败：{path}")
        audit_edits.append({"path": str(path), "keys": edited_keys})
    return len(files), total_removed, audit_edits


def print_audit_report(home: pathlib.Path) -> int:
    cdirs = resolve_claude_dirs(home)
    found = discover(home)
    processes = claude_processes()
    cli_keychains = [svc for svc in config_dir_keychain_services() if keychain_service_exists(svc)]
    desktop_keychains = [svc for svc in DESKTOP_KEYCHAIN_SERVICES if keychain_service_exists(svc)]
    internet_pwds = [srv for srv in INTERNET_PASSWORD_HOSTS if internet_password_exists(srv)]
    identity_keys = inspect_identity_keys(home)
    env_present = [key for key in AUDIT_ENV_KEYS if os.environ.get(key, "").strip()]

    telemetry_disabled: list[str] = []
    settings_env_secrets: list[str] = []
    for cdir in cdirs:
        for sname in ("settings.json", "settings.local.json"):
            spath = cdir / sname
            if not spath.is_file():
                continue
            try:
                sdata = read_json(spath, {})
                env = settings_env(sdata)
            except (OSError, ValueError, json.JSONDecodeError) as error:
                print(f"审计失败（{spath}）：{error}", file=sys.stderr)
                return 2
            for key in TELEMETRY_KEYS:
                if str(env.get(key, "")).lower() in {"1", "true", "yes", "on"} and key not in telemetry_disabled:
                    telemetry_disabled.append(key)
            for key in ("CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"):
                if env.get(key) and key not in settings_env_secrets:
                    settings_env_secrets.append(key)

    print("Claude 旧账户与本机残留全量只读审计（绝不输出任何密钥/邮箱明文）：\n")
    print("[1] 运行环境与进程")
    print(f"- 配置目录：{', '.join(str(p) for p in cdirs)}")
    print(f"- 活跃 Claude 进程：{len(processes)} 个")
    for proc in processes[:10]:
        print(f"  * {proc}")
    print(f"- Shell 环境变量已设置：{', '.join(env_present) if env_present else '无'}")
    print(f"- settings.json env 中的认证/网关键：{', '.join(settings_env_secrets) if settings_env_secrets else '无'}")
    print(f"- IDE Claude 扩展：{len(found['ide_extensions'])} 个（{', '.join(p.name for p in found['ide_extensions']) or '无'}）")

    print("\n[2] 凭据与钥匙串")
    print(f"- CLI Keychain 条目：{', '.join(cli_keychains) if cli_keychains else '无'}")
    print(f"- CLI 明文凭据文件（.credentials.json）：{len(found['credentials_files'])} 项")
    print(f"- Desktop Keychain 条目：{', '.join(desktop_keychains) if desktop_keychains else '无'}")
    print(f"- macOS Internet Password（claude.ai 等）：{', '.join(internet_pwds) if internet_pwds else '无'}")

    print("\n[3] 身份与账号缓存文件（.claude.json 全家族 + Desktop config.json）")
    if identity_keys:
        for fpath, keys in identity_keys.items():
            print(f"- {fpath}：命中 {len(keys)} 个键（{', '.join(keys[:8])}{' ...' if len(keys) > 8 else ''}）")
    else:
        print("- 未发现含身份/缓存键的配置文件")

    print("\n[4] 可清理缓存、设备记录与桌面端数据")
    print(f"- 自动安全清理（CLI/Desktop 图形缓存、遥测、HUD 缓存、daemon-auth 冷却）：{len(found['safe'])} 项")
    print(f"- 深层运行与设备状态（daemon/ant-did/ant-device-registry/debug/ide/state）：{len(found['deep'])} 项")
    print(
        f"- Claude Desktop 定向登录态/存储：{len(found['desktop_auth'])} 项；"
        f"全量数据目录：{len(found['desktop_full'])} 项（Claude.app：{'存在' if APP.exists() else '不存在'}）"
    )

    print("\n[5] 遥测继承与系统时区")
    print(f"- 遥测关闭键：{', '.join(telemetry_disabled) if telemetry_disabled else '未检测到'}（清理过程保持不变）")
    print(f"- 当前时区：{current_timezone()}")
    return 0


def build_dry_run_report(
    home: pathlib.Path,
    rotate: bool = True,
    clear_creds: bool = True,
    clear_deep: bool = True,
    desktop_mode: int = 1,
    set_timezone: bool = False,
    include_safe: bool = True,
) -> tuple[list[str], list[pathlib.Path]]:
    """生成结构化详细演练报告（Dry-Run Report）：含分类、体积、JSON 键明细、Keychain 与保护核对，零写盘。"""
    cdirs = resolve_claude_dirs(home)
    primary = cdirs[0]
    found = discover(home)
    processes = claude_processes()
    cli_keychains = [svc for svc in config_dir_keychain_services() if keychain_service_exists(svc)]
    desktop_keychains = [svc for svc in DESKTOP_KEYCHAIN_SERVICES if keychain_service_exists(svc)]
    identity_files = collect_identity_files(home, include_cli=rotate, include_desktop=bool(desktop_mode == 1))

    category_map: dict[pathlib.Path, str] = {}
    raw_targets: list[pathlib.Path] = []

    def add_group(items: list[pathlib.Path], label: str) -> None:
        for item in items:
            raw_targets.append(item)
            category_map.setdefault(item.absolute(), label)

    if include_safe:
        add_group(found["safe"], "安全缓存/遥测")
    if clear_creds:
        add_group(found["credentials_files"], "CLI明文凭据")
    if clear_deep:
        add_group(found["deep"], "深层运行/设备记录")
    if desktop_mode == 1:
        add_group(found["desktop_auth"], "Desktop登录态")
    elif desktop_mode in {2, 3}:
        add_group(found["desktop_full"], "Desktop全量数据")
    if desktop_mode == 3 and APP.exists():
        add_group([APP], "Desktop应用本体")

    targets = existing_paths(raw_targets, home)
    trash_bytes = sum(path_size(t) for t in targets)

    files_cnt, total_bytes = dir_stats(primary) if primary.is_dir() else (0, 0)
    free_bytes = shutil.disk_usage(home).free
    space_ok = free_bytes >= total_bytes + trash_bytes + MIN_FREE_BUFFER_BYTES

    desktop_desc = {
        0: "0（保留桌面版不动）",
        1: "1（定向清登录态/Electron存储/SafeStorage/config.json账号键与journal，保留会话与MCP）",
        2: "2（清空全部桌面端数据，自动恢复 claude_desktop_config.json）",
        3: "3（清空全部桌面端数据并移除 /Applications/Claude.app）",
    }.get(desktop_mode, str(desktop_mode))

    lines = [
        "================ [DRY-RUN] 详细演练报告（只读零写盘） ================",
        f"演练范围：身份轮换={'是' if rotate else '否'} | CLI凭据={'是' if clear_creds else '否'} | "
        f"深层运行与设备状态={'是' if clear_deep else '否'} | Desktop模式={desktop_desc} | "
        f"改时区={'是' if set_timezone else '否'}",
    ]
    if processes:
        lines.append(f"活跃进程提醒：检测到 {len(processes)} 个 Claude 进程在线；正式执行前必须全部退出。")

    lines.extend([
        "",
        "[1/5] 全量备份与磁盘空间预检（目标：~/ClaudeBackups/claude-account-backup-<timestamp>/）",
        f"- 主配置目录：{primary}（{files_cnt} 个普通文件，{format_size(total_bytes)}）",
        f"- 额外备份项：.claude.json、claude_desktop_config.json、Desktop config.json 及 {len(targets)} 项待移除目标（共约 {format_size(total_bytes + trash_bytes)}）",
        f"- 校验机制：逐文件 SHA-256（hashes.json）+ 操作日志（report.json / dry-run-report.md），目录权限 0700",
        f"- 磁盘可用空间：{format_size(free_bytes)}（余量预检：{'通过' if space_ok else '不足，正式执行将拒绝'}）",
        "",
        "[2/5] 身份轮换与账号缓存键剥离明细",
    ])

    desktop_cfg = (home / "Library/Application Support/Claude/config.json").resolve()
    if identity_files:
        for path in identity_files:
            try:
                data = read_json(path, {})
            except (OSError, ValueError, json.JSONDecodeError):
                lines.append(f"- {path}：<JSON 解析失败>")
                continue
            if not isinstance(data, dict):
                continue
            keys = sorted(k for k in data.keys() if is_account_cache_key(k))
            action = "仅剥离账号键" if path.resolve() == desktop_cfg else "轮换 userID/machineID + 剥离账号键"
            lines.append(
                f"- {path}（{action}）：将移除 {len(keys)} 个键"
                + (f" -> {', '.join(keys)}" if keys else "（无额外缓存键）")
            )
    else:
        lines.append("- 无匹配的身份或配置文件需要修改")

    lines.extend([
        "",
        "[3/5] 钥匙串（Keychain）与凭据清理明细",
        f"- CLI Keychain（循环删除至 44）：{', '.join(cli_keychains) if (clear_creds and cli_keychains) else '无/不清理'}",
        f"- CLI 明文凭据（.credentials.json）：{len(found['credentials_files']) if clear_creds else 0} 项",
        f"- Desktop Keychain（循环删除至 44）：{', '.join(desktop_keychains) if (desktop_mode and desktop_keychains) else '无/不清理'}",
        "",
        f"[4/5] 待移入废纸篓逐项路径表（共 {len(targets)} 项，合计 {format_size(trash_bytes)} -> ~/.Trash/claude-account-cleanup-<timestamp>/）",
    ])
    for idx, target in enumerate(targets):
        kind = "目录" if target.is_dir() and not target.is_symlink() else ("软链" if target.is_symlink() else "文件")
        cat = category_map.get(target.absolute(), "其他")
        size_str = format_size(path_size(target))
        lines.append(f"  [{idx:03d}] [{cat}] ({kind}, {size_str}) {target}")
    if not targets:
        lines.append("  （无待移动路径）")

    protected_existing = [p for p in protected_paths_for(home) if p.exists() or p.is_symlink()]
    lines.extend([
        "",
        f"[5/5] 绝对受保护资产核对（共 {len(protected_existing)} 项现存路径，代码级门禁保护绝不触碰）",
        "  " + (", ".join(p.name for p in protected_existing) if protected_existing else "无"),
        "======================================================================",
    ])
    return lines, targets


def print_dry_run_report(
    home: pathlib.Path,
    rotate: bool = True,
    clear_creds: bool = True,
    clear_deep: bool = True,
    desktop_mode: int = 1,
) -> int:
    """只读演练（Dry Run）入口：先输出 6 层全量审计，再输出详细演练报告，零写盘。"""
    rc = print_audit_report(home)
    if rc != 0:
        return rc
    print("")
    lines, _ = build_dry_run_report(
        home,
        rotate=rotate,
        clear_creds=clear_creds,
        clear_deep=clear_deep,
        desktop_mode=desktop_mode,
    )
    print("\n".join(lines))
    return 0


def print_post_checklist(
    has_env_overrides: bool,
    has_settings_secrets: bool,
    has_ide_exts: bool,
    has_internet_pwds: bool,
) -> None:
    items = [
        "[网页端] 在旧账号 claude.ai -> Settings -> Security 执行 'Log out of all devices'。",
        "[浏览器] 按 references/browser-cleanup.md 在 Chrome 等浏览器按精准域名（claude.ai / claude.com / anthropic.com / 扩展 fcoeoabgfenejglbffodgkkbkcdhcgfn）清理，切勿误删 Persona / Cloudflare 共享分区。",
    ]
    if has_env_overrides or has_settings_secrets:
        items.append("[环境变量/settings] 审计发现当前环境或 settings.json 设置了认证/网关变量，请检查 ~/.zshrc、~/.bashrc 与 settings.json 是否残留旧账号凭据。")
    else:
        items.append("[环境变量] Shell 与 settings.json 未发现硬编码 Token。")
    if has_ide_exts:
        items.append("[IDE 扩展] 检测到 VS Code / Cursor / Windsurf 的 Claude 扩展，请重启对应 IDE 并在扩展内重新登录。")
    if has_internet_pwds:
        items.append("[系统钥匙串网页密码] 检测到 claude.ai 相关 Internet Password，建议在「钥匙串访问」App 中核查清理。")
    items.append("[硬件密钥与服务端边界] 若使用过官方设备绑定（Secure Enclave 访问组 Q6L2SF6YDW.com.anthropic.claude.hwkey），删除本地 ant-did/ant-device-registry.json 不会撤销服务端设备登记；请到网页端 Trusted devices 核查。")
    items.append("[网络与时区] 确认当前出口 IP 与新账号所属区域一致，避免短时间内高频跨区或多号混切。")
    print("\n防串号 / 防封号外部核查清单（登录新账号前请逐项确认）：")
    for idx, text in enumerate(items, start=1):
        print(f"{idx}. {text}")


def ask_yes(prompt: str) -> bool:
    return input(f"{prompt} [y/N]：").strip().lower() == "y"


def ask_choice(prompt: str, allowed: set[int]) -> int:
    value = input(prompt).strip() or "0"
    if not value.isdigit() or int(value) not in allowed:
        raise ValueError("输入不在允许范围内，已停止且未修改")
    return int(value)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="在 macOS 上完整审计、SHA-256 备份并清理 Claude Code / Claude Desktop 旧账户信息"
    )
    parser.add_argument("--audit", action="store_true", help="6 层全量只读审计（不写盘，绝不输出密钥明文）")
    parser.add_argument("--dry-run", action="store_true", help="只读演练模式：展开完整执行清单、待改键名与待删路径，不写盘")
    parser.add_argument(
        "--desktop-mode",
        type=int,
        choices=[0, 1, 2, 3],
        default=1,
        help="配合 --dry-run 指定 Desktop 清理档位（默认 1：定向清登录态保留会话与 MCP）",
    )
    parser.add_argument("--no-rotate", action="store_true", help="配合 --dry-run 跳过身份轮换预览")
    parser.add_argument("--no-creds", action="store_true", help="配合 --dry-run 跳过 CLI 凭据清理预览")
    parser.add_argument("--no-deep", action="store_true", help="配合 --dry-run 跳过深层运行态清理预览")
    parser.add_argument("--backup-only", action="store_true", help="仅创建并 SHA-256 校验全量账户与配置备份快照")
    parser.add_argument("--list-backups", action="store_true", help="列出 ~/ClaudeBackups 下的历史备份")
    args = parser.parse_args(argv)

    home = pathlib.Path.home()
    errors = (OSError, ValueError, RuntimeError, subprocess.SubprocessError, json.JSONDecodeError)

    if args.list_backups:
        print("\n".join(list_backups(home)))
        return 0

    if args.backup_only:
        try:
            procs = claude_processes()
            if procs:
                print(f"提示：检测到 {len(procs)} 个正在运行的 Claude 进程，快照可能包含写入中的会话日志。")
            found = discover(home)
            backup = create_backup(home, found["desktop_full"])
            print(f"全量备份已完成并通过 SHA-256 校验：{backup}")
            if running_under_claude():
                print("当前处于 Claude Code 会话内；如需继续清理旧账号，请退出所有 Claude 进程后在普通终端运行本脚本。")
            return 0
        except errors as error:
            print(f"备份失败：{error}", file=sys.stderr)
            return 2

    if sys.platform != "darwin":
        print("本机账户审计与清理目前仅支持 macOS（darwin）。", file=sys.stderr)
        return 2

    if args.audit:
        return print_audit_report(home)

    if args.dry_run:
        return print_dry_run_report(
            home,
            rotate=not args.no_rotate,
            clear_creds=not args.no_creds,
            clear_deep=not args.no_deep,
            desktop_mode=args.desktop_mode,
        )

    if running_under_claude():
        print(
            "拒绝执行：当前脚本由 Claude Code 会话启动。请改在普通终端（或 Codex）运行清理；"
            "在 Claude Code 内仅允许 --audit、--dry-run、--backup-only、--list-backups。",
            file=sys.stderr,
        )
        return 2

    if not sys.stdin.isatty():
        print("拒绝执行：需要真实终端 TTY 完成知情确认。", file=sys.stderr)
        return 2

    report_path: pathlib.Path | None = None
    report_data: dict[str, object] = {}
    try:
        if print_audit_report(home) != 0:
            return 2

        found = discover(home)
        processes = claude_processes()
        cli_keychains = [svc for svc in config_dir_keychain_services() if keychain_service_exists(svc)]
        desktop_keychains = [svc for svc in DESKTOP_KEYCHAIN_SERVICES if keychain_service_exists(svc)]
        internet_pwds = [srv for srv in INTERNET_PASSWORD_HOSTS if internet_password_exists(srv)]
        env_present = [key for key in AUDIT_ENV_KEYS if os.environ.get(key, "").strip()]

        print("\n接下来逐项询问高敏/风险操作（可再生缓存与遥测残片在无进程运行时自动纳入）：")
        rotate = ask_yes("1) 轮换 .claude.json 全家族的 userID/machineID 并清除全部账号与实验缓存键？")
        clear_creds = ask_yes("2) 清理全部 CLI 凭据（macOS Keychain Claude Code-credentials* 与明文 .credentials.json）？")
        clear_deep = ask_yes("3) 清理深层运行与设备状态（daemon/含控制密钥与名册、ant-did、ant-device-registry.json、debug、ide、state）？")
        desktop_mode = ask_choice(
            "4) Claude Desktop 处理：0 保留；1 定向清理登录态/Electron存储/SafeStorage/config.json账号键与journal（保留MCP与会话）；"
            "2 清全部桌面版数据（自动恢复 claude_desktop_config.json）；3 再移除 Claude.app。选择 [0]：",
            {0, 1, 2, 3},
        )
        set_timezone = current_timezone() != "Asia/Taipei" and ask_yes("5) 把 macOS 时区改为 Asia/Taipei？")

        risky = rotate or clear_creds or clear_deep or desktop_mode
        clean_safe = not processes
        if processes and risky:
            print("\n检测到 Claude 相关进程仍在运行（内存里的旧 Token 会继续发请求导致串号）。")
            print("请先手动正常退出所有 Claude Code 终端、IDE 扩展窗口和 Claude Desktop（脚本绝不自动 kill）。")
            input("全部退出后按 Enter 重新检查：")
            if claude_processes():
                print("仍检测到 Claude 进程，已取消且未写入任何内容。", file=sys.stderr)
                return 2
            clean_safe = True

        dry_run_lines, targets = build_dry_run_report(
            home,
            rotate=rotate,
            clear_creds=clear_creds,
            clear_deep=clear_deep,
            desktop_mode=desktop_mode,
            set_timezone=set_timezone,
            include_safe=clean_safe,
        )
        print("\n" + "\n".join(dry_run_lines))

        if input("请审阅上方 Dry-Run 详细演练报告，完全确认后输入 CONFIRM 开始执行；其他输入取消：").strip() != "CONFIRM":
            print("已取消，没有修改任何内容。")
            return 1

        cdirs = resolve_claude_dirs(home)
        before_telemetry: dict[pathlib.Path, dict[str, object | None]] = {}
        for cdir in cdirs:
            for sname in ("settings.json", "settings.local.json"):
                spath = cdir / sname
                if spath.is_file():
                    before_telemetry[spath] = telemetry(read_json(spath, {}))
        protected_before = [p for p in protected_paths_for(home) if p.exists() or p.is_symlink()]

        backup = create_backup(home, targets)
        (backup / "dry-run-report.md").write_text("\n".join(dry_run_lines) + "\n", encoding="utf-8")
        batch = home / ".Trash" / f"claude-account-cleanup-{dt.datetime.now().strftime('%Y%m%d-%H%M%S-%f')}"
        report_path = backup / "report.json"
        report_data = {
            "status": "applying",
            "backup": str(backup),
            "trash": str(batch),
            "desktopMode": desktop_mode,
            "moved": [],
            "edited": [],
            "keychainDeleted": [],
        }
        write_json(report_path, report_data)
        print(f"\n[1/6] 全量备份已通过 SHA-256 校验：{backup}")

        if claude_processes() and risky:
            raise RuntimeError("备份期间检测到 Claude 进程重新启动，已停止清理")

        if set_timezone:
            print("[人工步骤] 请在 macOS 原生 sudo 隐藏提示中输入开机密码；脚本不会读取或保存密码。")
            subprocess.run(["sudo", "-v"], check=True)

        if rotate or desktop_mode == 1:
            file_count, key_count, edits = rotate_identity(
                home, include_cli=rotate, include_desktop=bool(desktop_mode == 1)
            )
            report_data["edited"] = edits
            write_json(report_path, report_data)
            print(f"[2/6] 本地身份/账号键已清理：更新 {file_count} 份配置文件，清除 {key_count} 个账号缓存键")
        else:
            print("[2/6] 本地身份保持不变")

        deleted_kc_count = 0
        if clear_creds:
            for svc in cli_keychains:
                cnt = delete_keychain_service(svc)
                deleted_kc_count += cnt
                if cnt:
                    report_data["keychainDeleted"].append({"service": svc, "count": cnt})
        if desktop_mode:
            for svc in desktop_keychains:
                cnt = delete_keychain_service(svc)
                deleted_kc_count += cnt
                if cnt:
                    report_data["keychainDeleted"].append({"service": svc, "count": cnt})
        write_json(report_path, report_data)
        print(f"[3/6] 钥匙串清理：已删除 {deleted_kc_count} 条记录")

        allowed_set = set(targets)
        moved = [
            move_to_trash(target, allowed_set, cdirs, batch, index=idx)
            for idx, target in enumerate(targets)
        ]
        report_data["moved"] = [str(p) for p in moved]
        write_json(report_path, report_data)
        print(f"[4/6] 已安全移入废纸篓：{len(moved)} 项")

        if desktop_mode:
            subprocess.run(["defaults", "delete", DESKTOP_BUNDLE_ID], capture_output=True, text=True, check=False)
            if desktop_mode == 2:
                backed_cfg = backup / "desktop-config/claude_desktop_config.json"
                if backed_cfg.is_file():
                    restored = home / "Library/Application Support/Claude/claude_desktop_config.json"
                    restored.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(backed_cfg, restored)
                    print(f"      已自动恢复桌面端 MCP 配置：{restored}")

        if set_timezone:
            subprocess.run(["sudo", "/usr/sbin/systemsetup", "-settimezone", "Asia/Taipei"], check=True)
            if current_timezone() != "Asia/Taipei":
                raise RuntimeError("时区修改后验证失败")
        print(f"[5/6] 系统时区：{current_timezone()}")

        for spath, expected in before_telemetry.items():
            if telemetry(read_json(spath, {})) != expected:
                raise RuntimeError(f"遥测设置发生变化，已停止：{spath}")
        missing = [path for path in protected_before if not (path.exists() or path.is_symlink())]
        if missing:
            raise RuntimeError("受保护路径丢失：" + ", ".join(map(str, missing)))

        report_data["status"] = "complete"
        write_json(report_path, report_data)
        print(f"[6/6] 完整性校验通过：遥测设置未变，受保护资产完好。\n\n清理完成（未清空废纸篓）。\n备份快照：{backup}\n操作报告：{report_path}")
        if moved:
            print(f"废纸篓批次：{batch}")

        has_settings_secrets = False
        for cdir in cdirs:
            for sname in ("settings.json", "settings.local.json"):
                spath = cdir / sname
                if spath.is_file():
                    env = settings_env(read_json(spath, {}))
                    if any(env.get(k) for k in ("CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN")):
                        has_settings_secrets = True
        print_post_checklist(
            has_env_overrides=bool(env_present),
            has_settings_secrets=has_settings_secrets,
            has_ide_exts=bool(found["ide_extensions"]),
            has_internet_pwds=bool(internet_pwds),
        )
        return 0
    except errors as error:
        if report_path is not None:
            report_data["status"] = "partial-or-stopped"
            report_data["errorType"] = type(error).__name__
            try:
                write_json(report_path, report_data)
            except OSError:
                pass
            print(f"停止（操作报告：{report_path}）：{error}", file=sys.stderr)
        else:
            print(f"停止：{error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
