# Codex Delegate Worker

This skill delegates work to a separate one-off `codex exec` process backed by a configured custom model node. It is useful when the main Codex session should write the prompt, but the actual work should run through that isolated worker.

It is intentionally limited to the configured custom node. Native Codex
subagents and OpenAI models backed by a ChatGPT subscription must use Codex's
native agent path instead.

## Run

```bash
node skills/codex-delegate-worker/scripts/codex-delegate-worker.mjs "reply with OK"
```

Any `codex exec` flags go before the task:

```bash
node skills/codex-delegate-worker/scripts/codex-delegate-worker.mjs --sandbox read-only "summarize this repo"
```

The launcher rejects OpenAI model ids supplied through config, `-m` /
`--model`, or `-c model=...`. To run a separate subscription-backed OpenAI
worker, bypass this skill and use the normal Codex login:

```bash
codex exec --ephemeral --ignore-user-config -c 'model_provider="openai"' -m gpt-5.5 "task"
```

Model availability depends on the active ChatGPT account and workspace.

## Config Files

Config is loaded in this order, from lowest to highest priority:

1. Defaults.
2. Global config: `$CODEX_HOME/codex-delegate-worker.json`, or `~/.codex/codex-delegate-worker.json` when `CODEX_HOME` is unset.
3. Current directory config: `./.codex-delegate-worker.json`.
4. Explicit config: `CODEX_DELEGATE_WORKER_CONFIG_FILE=/path/to/config.json`.
5. Environment variables.

Keep local secrets in `.codex-delegate-worker.json`; this repo ignores that file.

## Recommended Auth

Use command-backed auth for real credentials, so the API key is produced by a secret helper instead of being stored in the JSON file.

1Password:

```json
{
  "baseUrl": "https://provider.example/v1",
  "model": "custom-worker-model",
  "auth": {
    "command": "op",
    "args": ["read", "op://Private/Provider API Key/credential"]
  }
}
```

Bitwarden:

```json
{
  "baseUrl": "https://provider.example/v1",
  "model": "local-worker-model",
  "auth": {
    "command": "bw",
    "args": ["get", "password", "Provider API Key"]
  }
}
```

Unlock the vault before running the worker so the command can complete non-interactively.

## Direct API Key

For disposable local keys or quick smoke tests, the config file can contain the API key directly:

```json
{
  "baseUrl": "https://provider.example/v1",
  "model": "custom-worker-model",
  "apiKey": "sk-or-provider-token-here"
}
```

This is lower security than command-backed auth. The launcher does not write this key into generated Codex config; it injects it into the child process as `CODEX_DELEGATE_WORKER_API_KEY`.

## Environment Override

Environment variables are useful for one-off runs:

```bash
CODEX_DELEGATE_WORKER_BASE_URL="https://provider.example/v1" \
CODEX_DELEGATE_WORKER_API_KEY="..." \
node skills/codex-delegate-worker/scripts/codex-delegate-worker.mjs "reply with OK"
```

Command-backed auth can also be configured through environment variables:

```bash
CODEX_DELEGATE_WORKER_BASE_URL="https://provider.example/v1" \
CODEX_DELEGATE_WORKER_AUTH_COMMAND="op" \
CODEX_DELEGATE_WORKER_AUTH_ARGS_JSON='["read","op://Private/Provider API Key/credential"]' \
node skills/codex-delegate-worker/scripts/codex-delegate-worker.mjs "reply with OK"
```

## Keys

| Config key | Environment variable | Purpose |
| --- | --- | --- |
| `baseUrl` | `CODEX_DELEGATE_WORKER_BASE_URL` | Provider base URL, usually ending in `/v1`. |
| `apiKey` | `CODEX_DELEGATE_WORKER_API_KEY` | Low-friction API key fallback. Prefer `auth.command` for real credentials. |
| `model` | `CODEX_DELEGATE_WORKER_MODEL` | Required model name exposed by the custom node. |
| `providerId` | `CODEX_DELEGATE_WORKER_PROVIDER_ID` | Codex provider id. Defaults to `codex_delegate_worker`. |
| `providerName` | `CODEX_DELEGATE_WORKER_PROVIDER_NAME` | Human-readable provider name. |
| `configMode` | `CODEX_DELEGATE_WORKER_CONFIG_MODE` | `inline` or `temp-home`. Defaults to `inline`. |
| `codexBin` | `CODEX_DELEGATE_WORKER_CODEX_BIN` | Optional Codex executable path or command. |
| `keepHome` | `CODEX_DELEGATE_WORKER_KEEP_HOME` | Set `"1"` to keep the temp `CODEX_HOME` for debugging. |
| `auth.command` | `CODEX_DELEGATE_WORKER_AUTH_COMMAND` | Secret helper command for command-backed auth. |
| `auth.args` | `CODEX_DELEGATE_WORKER_AUTH_ARGS_JSON` | JSON string array of args for the auth command. |

Keep node-specific overrides under the `CODEX_DELEGATE_WORKER_` namespace instead of introducing unrelated credential variable names.

## Config Mode

The default mode is `inline`, which passes provider settings through `codex exec -c key=value` overrides.

Use `"configMode": "temp-home"` only when debugging generated Codex config. Set `"keepHome": "1"` or `CODEX_DELEGATE_WORKER_KEEP_HOME=1` to inspect the temporary `CODEX_HOME`.

## Chat Completions Providers

Current Codex releases send custom-node traffic through the Responses API path. A node that only implements OpenAI-compatible Chat Completions will not work directly.

```json
{
  "baseUrl": "http://127.0.0.1:8000/v1",
  "model": "custom-worker-model",
  "apiKey": "proxy-or-provider-token"
}
```

Use a local bridge, proxy, or gateway that exposes a Responses-compatible `/v1/responses` endpoint and translates to the provider's Chat Completions API. This launcher no longer exposes `wireApi`; remove old `wireApi` or `CODEX_DELEGATE_WORKER_WIRE_API` settings if they exist.

## Security Notes

The model does not automatically see provider credentials just because the process can call the provider. Still, avoid putting secrets in prompts, logs, tracked files, or command-line arguments.

Command-backed auth is the preferred mode because the launcher does not need the API key in its startup environment. The strongest isolation is a local proxy or bridge where the real provider key stays in the proxy and Codex receives only a dummy or scoped credential.
