---
name: codex-delegate-worker
description: Let an external Agent handle delegated Codex work through a separate one-off `codex exec` run. Use when the user says to hand a task to an external Agent, outside Agent, cheap Agent, isolated Agent, alternate-model Agent, provider-backed Agent, or similar separate helper, especially when the run should use temporary provider config and avoid changing durable Codex config.
---

# Codex Delegate Worker

Use this skill when the user wants an external Agent to do the work. Treat "let an external Agent do this" as enough intent; do not require the user to describe prompt-writing, provider wiring, or `codex exec` mechanics.

The parent Codex session must infer the worker task from the user's request, write a focused worker prompt, then use the bundled Node launcher to invoke `codex exec --ephemeral` with one-run provider overrides. By default the launcher uses Codex `-c` overrides; `temp-home` mode can write a temporary `CODEX_HOME/config.toml` for debugging.

This is not a native Codex subagent role file and not an application worker thread. It is a separate `codex exec` process used when provider isolation matters more than native subagent orchestration.

## Launcher

Run:

```bash
node <skill-dir>/scripts/codex-delegate-worker.mjs "<worker task>"
```

Pass any `codex exec` flags before the task:

```bash
node <skill-dir>/scripts/codex-delegate-worker.mjs --sandbox read-only "summarize this repository"
```

## Configuration

Prefer config files for stable non-secret settings and secret-helper references. Use environment variables for one-off overrides, low-risk API key fallback, or debugging.

Config load order, from lowest to highest priority:

1. Defaults.
2. Global config: `$CODEX_HOME/codex-delegate-worker.json`, or `~/.codex/codex-delegate-worker.json` when `CODEX_HOME` is unset.
3. Current directory config: `./.codex-delegate-worker.json`.
4. Explicit config: `CODEX_DELEGATE_WORKER_CONFIG_FILE=/path/to/config.json`.
5. Environment variables.

Current directory example:

```json
{
  "baseUrl": "https://provider.example/v1",
  "model": "deepseek-flash",
  "providerId": "codex_delegate_worker",
  "providerName": "External Agent provider",
  "auth": {
    "command": "op",
    "args": ["read", "op://Private/Provider API Key/credential"]
  }
}
```

Global config example:

```json
{
  "baseUrl": "http://127.0.0.1:8000/v1",
  "model": "local-worker-model",
  "auth": {
    "command": "bw",
    "args": ["get", "password", "Local Worker API Key"]
  }
}
```

Supported config keys:

| Config key | Purpose |
| --- | --- |
| `baseUrl` | Provider base URL, usually ending in `/v1`. |
| `apiKey` | Low-security direct API key. Prefer `auth.command` for real credentials. |
| `model` | Model name. Defaults to `deepseek-flash`. |
| `providerId` | Codex provider id. Defaults to `codex_delegate_worker`. |
| `providerName` | Human-readable provider name. |
| `wireApi` | Optional Codex `wire_api`, for example `responses`. |
| `configMode` | `inline` or `temp-home`. Defaults to `inline`. |
| `codexBin` | Optional Codex executable path or command. |
| `keepHome` | Set `"1"` to keep the temp `CODEX_HOME` for debugging. |
| `auth.command` | Secret helper command for command-backed auth. |
| `auth.args` | Array of arguments for `auth.command`. |

Avoid raw API keys in config files when possible. Use `auth.command` for real credentials. If the user explicitly accepts lower security, `apiKey` is supported and the launcher injects it into the child process environment instead of writing it into temporary Codex config.

Environment overrides:

| Variable | Required | Purpose |
| --- | --- | --- |
| `CODEX_DELEGATE_WORKER_CONFIG_FILE` | No | Explicit JSON config file path. |
| `CODEX_DELEGATE_WORKER_BASE_URL` | Yes | Provider base URL, usually ending in `/v1`. |
| `CODEX_DELEGATE_WORKER_API_KEY` | One auth mode | Low-friction provider API key passed through Codex `env_key`. |
| `CODEX_DELEGATE_WORKER_AUTH_COMMAND` | One auth mode | High-security secret helper command used as Codex command-backed auth. |
| `CODEX_DELEGATE_WORKER_AUTH_ARGS_JSON` | No | JSON string array of arguments for `CODEX_DELEGATE_WORKER_AUTH_COMMAND`. |
| `CODEX_DELEGATE_WORKER_MODEL` | No | Model name. Defaults to `deepseek-flash`. |
| `CODEX_DELEGATE_WORKER_PROVIDER_ID` | No | Codex provider id. Defaults to `codex_delegate_worker`. |
| `CODEX_DELEGATE_WORKER_PROVIDER_NAME` | No | Human-readable provider name. |
| `CODEX_DELEGATE_WORKER_WIRE_API` | No | Optional Codex `wire_api`, for example `responses`. Leave unset for broad compatibility trials. |
| `CODEX_DELEGATE_WORKER_CONFIG_MODE` | No | `temp-home` or `inline`. |
| `CODEX_DELEGATE_WORKER_CODEX_BIN` | No | Codex executable path or command. Defaults to `codex`. |
| `CODEX_DELEGATE_WORKER_KEEP_HOME` | No | Set `1` to keep the temp `CODEX_HOME` for debugging. |

Keep every provider-specific environment override under the `CODEX_DELEGATE_WORKER_` namespace. Do not introduce provider-specific names such as `KAPI_API_KEY` or `DEEPSEEK_API_KEY` for this skill.

### Config modes

By default, the launcher passes provider settings with Codex `-c key=value` overrides instead of writing a temporary `config.toml`:

```json
{
  "configMode": "inline",
  "baseUrl": "https://provider.example/v1",
  "model": "deepseek-flash",
  "apiKey": "sk-or-provider-token-here"
}
```

Inline mode is the normal path. Use `configMode: "temp-home"` only when you need easier debugging via `CODEX_DELEGATE_WORKER_KEEP_HOME=1` or want to inspect a generated config file.

## Authentication

Prefer command-backed auth for real credentials. Use direct environment variables only for low-risk smoke tests, disposable local keys, or short-lived manual runs.

### High-security mode: secret helper command

Set `auth.command` in config, or set `CODEX_DELEGATE_WORKER_AUTH_COMMAND` and optional `CODEX_DELEGATE_WORKER_AUTH_ARGS_JSON`. The launcher writes Codex provider auth config instead of `env_key`, so the API key value is produced by the helper command at auth time and is not stored in the temporary config.

1Password example:

```bash
CODEX_DELEGATE_WORKER_BASE_URL="https://provider.example/v1" \
CODEX_DELEGATE_WORKER_AUTH_COMMAND="op" \
CODEX_DELEGATE_WORKER_AUTH_ARGS_JSON='["read","op://Private/Provider API Key/credential"]' \
node <skill-dir>/scripts/codex-delegate-worker.mjs "external Agent task"
```

Bitwarden example:

```bash
CODEX_DELEGATE_WORKER_BASE_URL="https://provider.example/v1" \
CODEX_DELEGATE_WORKER_AUTH_COMMAND="bw" \
CODEX_DELEGATE_WORKER_AUTH_ARGS_JSON='["get","password","Provider API Key"]' \
node <skill-dir>/scripts/codex-delegate-worker.mjs "external Agent task"
```

For Bitwarden, unlock the vault before running the worker so `bw get password ...` can complete non-interactively.

### Low-friction mode: scoped environment key

Use this when setup speed matters more than secret isolation.

Direct config-file key:

```json
{
  "baseUrl": "https://provider.example/v1",
  "model": "deepseek-flash",
  "apiKey": "sk-or-provider-token-here"
}
```

Environment key:

```bash
CODEX_DELEGATE_WORKER_BASE_URL="https://provider.example/v1" \
CODEX_DELEGATE_WORKER_API_KEY="..." \
node <skill-dir>/scripts/codex-delegate-worker.mjs "external Agent task"
```

## Workflow

1. Check config files first. Confirm the user has a base URL, model name, and either command-backed auth or an API key. If the model is unspecified, use `deepseek-flash`.
2. Prefer config-file `auth.command` or `CODEX_DELEGATE_WORKER_AUTH_COMMAND` for real credentials. Fall back to `CODEX_DELEGATE_WORKER_API_KEY` only for low-risk runs.
3. Translate the user's intent into a concise worker prompt. Include the target files, command expectations, output format, and boundaries the external Agent needs.
4. Run the launcher with a small smoke-test task first, such as "reply with OK and the model/provider you are using".
5. If the smoke test succeeds, run the real worker task.
6. If it fails, retry with a different `CODEX_DELEGATE_WORKER_MODEL` or set `CODEX_DELEGATE_WORKER_WIRE_API=responses` only when the provider supports the Responses API shape.

## Safety

Never write API keys to `SKILL.md`, examples, tracked repo files, or persistent Codex config. In command-backed mode, the launcher writes only the helper command and args. In env-key or config-file `apiKey` mode, it writes only the env var name `CODEX_DELEGATE_WORKER_API_KEY` into temporary config, not the secret value.

The model does not automatically see provider credentials just because the Codex process can use them. In env-key or config-file `apiKey` mode, the launcher also writes a temporary `shell_environment_policy.exclude` entry for `CODEX_DELEGATE_WORKER_API_KEY`, so model-initiated shell commands should not inherit that secret. Command-backed auth is still preferred because it avoids putting the key in shell env at launcher startup.
