from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

SCRIPT = pathlib.Path(__file__).parents[1] / "scripts" / "claude_account_cleanup.py"
SPEC = importlib.util.spec_from_file_location("claude_account_cleanup", SCRIPT)
assert SPEC and SPEC.loader
cleanup = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = cleanup
SPEC.loader.exec_module(cleanup)


class ClaudeAccountCleanupTests(unittest.TestCase):
    def setUp(self) -> None:
        patcher = mock.patch.dict(os.environ)
        patcher.start()
        self.addCleanup(patcher.stop)
        for key in (
            "CLAUDECODE",
            "CLAUDE_CODE_ENTRYPOINT",
            "CLAUDE_CONFIG_DIR",
            "CLAUDE_CODE_OAUTH_TOKEN",
            "ANTHROPIC_API_KEY",
            "ANTHROPIC_AUTH_TOKEN",
            "ANTHROPIC_BASE_URL",
        ):
            os.environ.pop(key, None)

    def home(self) -> pathlib.Path:
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        home = pathlib.Path(temp.name)
        (home / ".claude").mkdir()
        (home / ".Trash").mkdir()
        return home

    def seed_protected(self, claude_dir: pathlib.Path) -> dict[str, str]:
        files = {
            "projects/demo/session.jsonl": "session",
            "skills/demo/SKILL.md": "skill",
            "plugins/demo.json": "plugin",
            "hooks/guard.sh": "hook",
            "scheduled-tasks/daily/SKILL.md": "task",
            "hud-config.json": '{"display": {}}',
            "settings.json": '{"env": {"DISABLE_TELEMETRY": "1"}}',
        }
        for relative, content in files.items():
            target = claude_dir / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
        return files

    def test_backup_only_writes_sha256_hashes_and_all_configs(self):
        home = self.home()
        files = self.seed_protected(home / ".claude")
        (home / ".claude.json").write_text('{"userID":"old-u"}', encoding="utf-8")
        (home / ".claude/.claude.json").write_text('{"userID":"inner-u"}', encoding="utf-8")
        desktop_dir = home / "Library/Application Support/Claude"
        desktop_dir.mkdir(parents=True)
        (desktop_dir / "claude_desktop_config.json").write_text('{"mcpServers":{"fs":{}}}', encoding="utf-8")
        (desktop_dir / "config.json").write_text('{"oauthAccount":{"x":1}}', encoding="utf-8")

        with (
            mock.patch.object(pathlib.Path, "home", return_value=home),
            mock.patch.object(cleanup, "keychain_service_exists", return_value=False),
            mock.patch.object(cleanup, "claude_processes", return_value=[]),
            mock.patch.object(cleanup, "running_under_claude", return_value=False),
        ):
            rc = cleanup.main(["--backup-only"])
        self.assertEqual(rc, 0)
        backups = list((home / "ClaudeBackups").glob("claude-account-backup-*"))
        self.assertEqual(len(backups), 1)
        backup = backups[0]
        self.assertEqual(backup.stat().st_mode & 0o777, 0o700)
        for relative, content in files.items():
            self.assertEqual((backup / "dot-claude" / relative).read_text(encoding="utf-8"), content)
        self.assertEqual((backup / "claude.json").read_text(encoding="utf-8"), '{"userID":"old-u"}')
        self.assertEqual((backup / "dot-claude-json").read_text(encoding="utf-8"), '{"userID":"inner-u"}')
        self.assertEqual(
            (backup / "desktop-config/claude_desktop_config.json").read_text(encoding="utf-8"),
            '{"mcpServers":{"fs":{}}}',
        )
        self.assertEqual(
            (backup / "desktop-config/config.json").read_text(encoding="utf-8"),
            '{"oauthAccount":{"x":1}}',
        )
        hashes = json.loads((backup / "hashes.json").read_text(encoding="utf-8"))
        self.assertIn("dot-claude", hashes)
        self.assertIn("claude.json", hashes)
        manifest = json.loads((backup / "manifest.json").read_text(encoding="utf-8"))
        self.assertTrue(manifest["claudeJsonCopied"])
        self.assertTrue(manifest["dotClaudeJsonCopied"])
        self.assertTrue(manifest["desktopConfigCopied"])
        self.assertTrue(manifest["desktopStateConfigCopied"])
        self.assertTrue((home / "ClaudeBackups/.gitignore").is_file())

    def test_list_backups_reports_existing_snapshots(self):
        home = self.home()
        self.seed_protected(home / ".claude")
        with (
            mock.patch.object(pathlib.Path, "home", return_value=home),
            mock.patch.object(cleanup, "keychain_service_exists", return_value=False),
        ):
            cleanup.create_backup(home)
        lines = "\n".join(cleanup.list_backups(home))
        self.assertIn("claude-account-backup-", lines)
        self.assertIn("SHA-256：是", lines)

    def test_deletion_gate_rejects_protected_parents_and_unknown_paths(self):
        home = self.home()
        claude = home / ".claude"
        batch = home / ".Trash/run"
        cdirs = [claude]
        for name in cleanup.PROTECTED:
            with self.subTest(name=name), self.assertRaises(RuntimeError):
                cleanup.move_to_trash(claude / name, {claude / name}, cdirs, batch)
        with self.assertRaises(RuntimeError):
            cleanup.move_to_trash(claude, {claude}, cdirs, batch)
        with self.assertRaises(RuntimeError):
            cleanup.move_to_trash(home, {home}, cdirs, batch)
        with self.assertRaises(RuntimeError):
            cleanup.move_to_trash(home / "Documents", set(), cdirs, batch)

    def test_safe_path_refuses_symlink_ancestors(self):
        with tempfile.TemporaryDirectory() as t:
            root = pathlib.Path(t)
            home = root / "home"
            home.mkdir()
            outside = root / "outside"
            outside.mkdir()
            (outside / "cache").mkdir()
            (home / ".claude").symlink_to(outside)
            with self.assertRaises(RuntimeError):
                cleanup.discover(home)
            self.assertTrue((outside / "cache").exists())

    def test_safe_hud_caches_move_while_hud_config_stays_protected(self):
        home = self.home()
        (home / ".claude/hud-config.json").write_text('{"keep":true}', encoding="utf-8")
        hud_cache = home / ".claude/hud/usage-cache.json"
        hud_cache.parent.mkdir(parents=True)
        hud_cache.write_text('{"pct":99}', encoding="utf-8")
        batch = home / ".Trash/run"
        dest = cleanup.move_to_trash(hud_cache, {hud_cache}, [home / ".claude"], batch)
        self.assertFalse(hud_cache.exists())
        self.assertTrue(dest.exists())
        self.assertEqual((home / ".claude/hud-config.json").read_text(encoding="utf-8"), '{"keep":true}')

    def test_identity_rotation_clears_cli_and_desktop_account_keys(self):
        home = self.home()
        payload = {
            "userID": "old-user",
            "machineID": "old-machine",
            "anonymousId": "old-anon",
            "accountUuid": "acc-1",
            "lastKnownAccountUuid": "acc-1",
            "oauth:tokenCache": {"k": "v"},
            "oauth:tokenCacheV2": {"k": "v"},
            "oauthAccount": {"emailAddress": "secret@example.com", "organizationUuid": "org-1"},
            "claudeCodeFirstTokenDate": "2026-01-01",
            "cachedFutureFlag": {"x": 1},
            "customTierAccessCache": {"y": 2},
            "mcpServers": {"keep-me": {"command": "echo"}},
        }
        cleanup.write_json(home / ".claude.json", payload)
        cleanup.write_json(home / ".claude/.claude.json", dict(payload))
        internal = home / ".claude/backups/.claude.json.backup.1"
        internal.parent.mkdir()
        cleanup.write_json(internal, dict(payload))
        desktop_cfg = home / "Library/Application Support/Claude/config.json"
        desktop_cfg.parent.mkdir(parents=True)
        cleanup.write_json(
            desktop_cfg,
            {"oauthAccount": {"x": 1}, "oauth:tokenCacheV2": {"t": 1}, "windowBounds": {"w": 100}},
        )

        files, removed, _ = cleanup.rotate_identity(home, include_cli=True, include_desktop=True)
        self.assertEqual(files, 4)
        self.assertGreaterEqual(removed, 20)

        main_data = cleanup.read_json(home / ".claude.json")
        inner_data = cleanup.read_json(home / ".claude/.claude.json")
        backup_data = cleanup.read_json(internal)
        for doc in (main_data, inner_data, backup_data):
            self.assertEqual((doc["userID"], doc["machineID"]), (main_data["userID"], main_data["machineID"]))
            self.assertNotEqual(doc["userID"], "old-user")
            for k in ("oauthAccount", "accountUuid", "lastKnownAccountUuid", "oauth:tokenCache", "oauth:tokenCacheV2", "cachedFutureFlag"):
                self.assertNotIn(k, doc)
            self.assertIn("mcpServers", doc)

        desktop_after = cleanup.read_json(desktop_cfg)
        self.assertNotIn("oauthAccount", desktop_after)
        self.assertNotIn("oauth:tokenCacheV2", desktop_after)
        self.assertNotIn("userID", desktop_after)
        self.assertEqual(desktop_after["windowBounds"], {"w": 100})

    def test_backup_disk_space_check_rejects_before_writing(self):
        home = self.home()
        self.seed_protected(home / ".claude")
        fake_usage = mock.Mock(free=1024)
        with (
            mock.patch.object(pathlib.Path, "home", return_value=home),
            mock.patch.object(cleanup.shutil, "disk_usage", return_value=fake_usage),
        ):
            with self.assertRaises(RuntimeError):
                cleanup.create_backup(home)
        self.assertFalse((home / "ClaudeBackups").exists())

    def test_config_dir_hashed_keychain_service_name(self):
        custom = "/tmp/custom-claude-profile"
        os.environ["CLAUDE_CONFIG_DIR"] = custom
        expected_hash = hashlib.sha256(custom.encode("utf-8")).hexdigest()[:8]
        services = cleanup.config_dir_keychain_services()
        self.assertIn("Claude Code-credentials", services)
        self.assertIn(f"Claude Code-credentials-{expected_hash}", services)

    def test_delete_keychain_service_loops_until_not_found(self):
        side_effects = [
            subprocess.CompletedProcess([], 0, "", ""),
            subprocess.CompletedProcess([], 0, "", ""),
            subprocess.CompletedProcess([], 44, "", ""),
        ]
        with mock.patch.object(cleanup.subprocess, "run", side_effect=side_effects) as run_mock:
            count = cleanup.delete_keychain_service("Claude Code-credentials")
        self.assertEqual(count, 2)
        self.assertEqual(run_mock.call_count, 3)

    def test_process_and_env_detection_precision(self):
        os.environ["CLAUDECODE"] = "1"
        self.assertTrue(cleanup.running_under_claude())
        os.environ.pop("CLAUDECODE", None)

        ps_out = "\n".join([
            "101 /usr/bin/vim vim /Users/me/claude-code-notes/todo.md",
            "202 /Applications/Claude.app/Contents/Frameworks/Squirrel.framework/Resources/ShipIt com.anthropic.claudefordesktop.ShipIt",
            "303 node node /opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/cli.js",
        ])
        with mock.patch.object(
            cleanup.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, ps_out, "")
        ):
            procs = cleanup.claude_processes()
        self.assertEqual(len(procs), 2)
        self.assertFalse(any("claude-code-notes" in p for p in procs))

    def test_audit_never_leaks_secret_values(self):
        home = self.home()
        os.environ["ANTHROPIC_API_KEY"] = "sk-ant-super-secret-value-12345"
        cleanup.write_json(
            home / ".claude/settings.json",
            {"env": {"DISABLE_TELEMETRY": "1", "ANTHROPIC_AUTH_TOKEN": "tok-super-secret-999"}},
        )
        cleanup.write_json(
            home / ".claude/settings.local.json",
            {"env": {"DO_NOT_TRACK": "true", "CLAUDE_CODE_OAUTH_TOKEN": "oauth-local-secret-888"}},
        )
        cleanup.write_json(
            home / ".claude.json",
            {"userID": "secret-uid-value", "oauthAccount": {"emailAddress": "hidden@secret.test"}},
        )
        (home / ".claude/.credentials.json").write_text('{"accessToken":"top-secret-tok"}', encoding="utf-8")
        (home / ".claude/daemon-auth-cooldown").write_text("12345", encoding="utf-8")
        (home / ".vscode/extensions/anthropic.claude-code-1.0.0").mkdir(parents=True)

        printed: list[str] = []
        with (
            mock.patch.object(pathlib.Path, "home", return_value=home),
            mock.patch.object(cleanup.sys, "platform", "darwin"),
            mock.patch.object(cleanup, "claude_processes", return_value=[]),
            mock.patch.object(cleanup, "keychain_service_exists", return_value=False),
            mock.patch.object(cleanup, "internet_password_exists", return_value=False),
            mock.patch.object(cleanup, "current_timezone", return_value="Asia/Taipei"),
            mock.patch("builtins.print", side_effect=lambda *a, **k: printed.append(" ".join(map(str, a)))),
        ):
            rc = cleanup.main(["--audit"])
        self.assertEqual(rc, 0)
        output = "\n".join(printed)
        self.assertIn("ANTHROPIC_API_KEY", output)
        self.assertIn("ANTHROPIC_AUTH_TOKEN", output)
        self.assertIn("CLAUDE_CODE_OAUTH_TOKEN", output)
        self.assertIn("DO_NOT_TRACK", output)
        self.assertIn("anthropic.claude-code-1.0.0", output)
        self.assertIn("CLI 明文凭据文件（.credentials.json）：1 项", output)
        self.assertNotIn("sk-ant-super-secret-value-12345", output)
        self.assertNotIn("tok-super-secret-999", output)
        self.assertNotIn("oauth-local-secret-888", output)
        self.assertNotIn("secret-uid-value", output)
        self.assertNotIn("hidden@secret.test", output)
        self.assertNotIn("top-secret-tok", output)

    def test_claude_agent_allows_audit_and_backup_only_but_refuses_cleanup(self):
        home = self.home()
        self.seed_protected(home / ".claude")
        with (
            mock.patch.object(pathlib.Path, "home", return_value=home),
            mock.patch.object(cleanup.sys, "platform", "darwin"),
            mock.patch.object(cleanup, "running_under_claude", return_value=True),
            mock.patch.object(cleanup, "current_timezone", return_value="Asia/Taipei"),
            mock.patch.object(cleanup, "claude_processes", return_value=[]),
            mock.patch.object(cleanup, "keychain_service_exists", return_value=False),
            mock.patch.object(cleanup, "internet_password_exists", return_value=False),
        ):
            self.assertEqual(cleanup.main([]), 2)
            self.assertEqual(cleanup.main(["--audit"]), 0)
            self.assertEqual(cleanup.main(["--dry-run"]), 0)
            self.assertEqual(cleanup.main(["--backup-only"]), 0)

    def test_desktop_mode_1_preserves_sessions_and_cli_when_rotate_false(self):
        home = self.home()
        self.seed_protected(home / ".claude")
        cleanup.write_json(home / ".claude.json", {"userID": "keep-cli-uid", "oauthAccount": {"e": "x"}})
        desktop_dir = home / "Library/Application Support/Claude"
        desktop_dir.mkdir(parents=True)
        (desktop_dir / "Cookies").write_text("cookie-data", encoding="utf-8")
        (desktop_dir / "config.json.journal").write_text("journal", encoding="utf-8")
        (desktop_dir / "ant-did").write_text("did-123", encoding="utf-8")
        (desktop_dir / "ant-device-registry.json").write_text("{}", encoding="utf-8")
        (desktop_dir / "claude_desktop_config.json").write_text('{"mcpServers":{"m":{}}}', encoding="utf-8")
        (desktop_dir / "local-agent-mode-sessions/s1").mkdir(parents=True)
        (desktop_dir / "local-agent-mode-sessions/s1/chat.json").write_text("keep-cowork", encoding="utf-8")
        cleanup.write_json(desktop_dir / "config.json", {"oauthAccount": {"a": 1}, "theme": "dark"})

        answers = iter(["n", "n", "n", "1", "CONFIRM"])
        with (
            mock.patch.object(pathlib.Path, "home", return_value=home),
            mock.patch.object(cleanup.sys, "platform", "darwin"),
            mock.patch.object(cleanup, "running_under_claude", return_value=False),
            mock.patch.object(cleanup, "claude_processes", return_value=[]),
            mock.patch.object(cleanup, "current_timezone", return_value="Asia/Taipei"),
            mock.patch.object(cleanup, "keychain_service_exists", side_effect=lambda s: s == "Claude Safe Storage"),
            mock.patch.object(cleanup, "delete_keychain_service", return_value=1) as kc_del,
            mock.patch.object(cleanup, "internet_password_exists", return_value=False),
            mock.patch.object(cleanup.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "", "")),
            mock.patch.object(sys.stdin, "isatty", return_value=True),
            mock.patch("builtins.input", side_effect=lambda _="": next(answers)),
        ):
            rc = cleanup.main([])

        self.assertEqual(rc, 0)
        kc_del.assert_called_once_with("Claude Safe Storage")
        # Desktop mode 1 cleaned auth/journal/device-records, kept sessions & MCP & config theme
        self.assertFalse((desktop_dir / "Cookies").exists())
        self.assertFalse((desktop_dir / "config.json.journal").exists())
        self.assertFalse((desktop_dir / "ant-did").exists())
        self.assertFalse((desktop_dir / "ant-device-registry.json").exists())
        self.assertEqual((desktop_dir / "claude_desktop_config.json").read_text(encoding="utf-8"), '{"mcpServers":{"m":{}}}')
        self.assertEqual((desktop_dir / "local-agent-mode-sessions/s1/chat.json").read_text(encoding="utf-8"), "keep-cowork")
        self.assertEqual(cleanup.read_json(desktop_dir / "config.json"), {"theme": "dark"})
        # CLI .claude.json untouched because user answered 'n' to rotate
        self.assertEqual(cleanup.read_json(home / ".claude.json")["userID"], "keep-cli-uid")

    def test_desktop_mode_2_full_wipe_restores_mcp_config_and_writes_report(self):
        home = self.home()
        protected = self.seed_protected(home / ".claude")
        cleanup.write_json(
            home / ".claude.json",
            {"userID": "old-u", "machineID": "old-m", "oauthAccount": {"email": "a@b.c"}, "keep": True},
        )
        (home / ".claude/.credentials.json").write_text("{}", encoding="utf-8")
        (home / ".claude/daemon").mkdir()
        (home / ".claude/daemon/control.key").write_text("k", encoding="utf-8")
        (home / ".claude/daemon-auth-status.json").write_text("{}", encoding="utf-8")
        (home / ".claude.json.tmp.123.abc").write_text("tmp", encoding="utf-8")
        desktop_dir = home / "Library/Application Support/Claude"
        desktop_dir.mkdir(parents=True)
        (desktop_dir / "Cookies").write_text("cookie-data", encoding="utf-8")
        (desktop_dir / "Cache").mkdir()
        (desktop_dir / "Cache/entry").write_text("gpu", encoding="utf-8")
        (desktop_dir / "ant-did").write_text("did", encoding="utf-8")
        (desktop_dir / "claude_desktop_config.json").write_text('{"mcpServers":{"m":{}}}', encoding="utf-8")
        os.mkfifo(home / ".claude/test.fifo")

        answers = iter(["y", "y", "y", "2", "CONFIRM"])
        deleted_services: list[str] = []

        def fake_kc_exists(svc: str) -> bool:
            return svc in {"Claude Code-credentials", "Claude Safe Storage"}

        def fake_kc_del(svc: str) -> int:
            deleted_services.append(svc)
            return 1

        with (
            mock.patch.object(pathlib.Path, "home", return_value=home),
            mock.patch.object(cleanup.sys, "platform", "darwin"),
            mock.patch.object(cleanup, "running_under_claude", return_value=False),
            mock.patch.object(cleanup, "claude_processes", return_value=[]),
            mock.patch.object(cleanup, "current_timezone", return_value="Asia/Taipei"),
            mock.patch.object(cleanup, "keychain_service_exists", side_effect=fake_kc_exists),
            mock.patch.object(cleanup, "delete_keychain_service", side_effect=fake_kc_del),
            mock.patch.object(cleanup, "internet_password_exists", return_value=False),
            mock.patch.object(cleanup.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "", "")),
            mock.patch.object(sys.stdin, "isatty", return_value=True),
            mock.patch("builtins.input", side_effect=lambda _="": next(answers)),
        ):
            rc = cleanup.main([])

        self.assertEqual(rc, 0)
        self.assertEqual(set(deleted_services), {"Claude Code-credentials", "Claude Safe Storage"})
        self.assertFalse((home / ".claude/.credentials.json").exists())
        self.assertFalse((home / ".claude/daemon").exists())
        self.assertFalse((home / ".claude/daemon-auth-status.json").exists())
        self.assertFalse((home / ".claude.json.tmp.123.abc").exists())
        self.assertFalse((desktop_dir / "Cookies").exists())
        self.assertEqual((desktop_dir / "claude_desktop_config.json").read_text(encoding="utf-8"), '{"mcpServers":{"m":{}}}')
        for relative, content in protected.items():
            self.assertEqual((home / ".claude" / relative).read_text(encoding="utf-8"), content)
        updated = cleanup.read_json(home / ".claude.json")
        self.assertNotEqual(updated["userID"], "old-u")
        self.assertNotIn("oauthAccount", updated)
        self.assertTrue(updated["keep"])
        report = next((home / "ClaudeBackups").glob("claude-account-backup-*/report.json"))
        report_json = json.loads(report.read_text(encoding="utf-8"))
        self.assertEqual(report_json["status"], "complete")
        self.assertEqual(report_json["desktopMode"], 2)
        dry_run_md = report.parent / "dry-run-report.md"
        self.assertTrue(dry_run_md.is_file())
        self.assertIn("[DRY-RUN] 详细演练报告", dry_run_md.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
