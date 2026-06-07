# ACPX Worker Configuration

Use this reference when setting local OpenAI-compatible model endpoints, worker model aliases, ports, or ACPX defaults.

## Install ACPX

Prefer a global install for repeated use:

```bash
npm install -g acpx@latest
```

Or run without installing:

```bash
npx acpx@latest pi exec "summarize this repo"
```

## Mental Model

Keep these layers separate:

```text
Supervisor: Codex or Claude Code
Client/session layer: acpx
Worker harness: Pi, Codex, Qwen Code, or another ACP agent
Model backend: local OpenAI-compatible Qwen 27B endpoint
```

Do not choose `acpx qwen` just because the model is Qwen. If the worker should be Pi, configure Pi to call the local Qwen endpoint and run `acpx pi`. If the worker should be Codex, configure Codex to call the local Qwen endpoint and run `acpx codex`.

## Configure ACPX Defaults

ACPX reads:

1. Global config: `~/.acpx/config.json`
2. Project config: `<repo>/.acpxrc.json`
3. CLI flags, which override config

Useful defaults:

```json
{
  "defaultAgent": "pi",
  "defaultPermissions": "approve-reads",
  "format": "text",
  "ttl": 300,
  "agents": {}
}
```

Use:

```bash
acpx config show
acpx config init
```

## Worker Selection

Use one of these:

```bash
acpx pi "<task>"
acpx codex "<task>"
acpx qwen "<task>"
acpx --agent "./my-acp-server" "<task>"
```

Built-in ACPX mappings:

```text
pi    -> npx pi-acp
codex -> npx -y @agentclientprotocol/codex-acp
qwen  -> qwen --acp
```

## Pi Worker With Local Qwen 27B

Configure the local endpoint in Pi, then call Pi through ACPX.

Pi custom models live in:

```text
~/.pi/agent/models.json
```

Example for a local OpenAI-compatible server:

```json
{
  "providers": {
    "local-qwen": {
      "baseUrl": "http://127.0.0.1:8000/v1",
      "api": "openai-completions",
      "apiKey": "local",
      "compat": {
        "supportsDeveloperRole": false,
        "supportsReasoningEffort": false
      },
      "models": [
        {
          "id": "qwen27b-local",
          "name": "Qwen 27B Local",
          "reasoning": false,
          "contextWindow": 32768,
          "maxTokens": 8192
        }
      ]
    }
  }
}
```

Pi requires an `apiKey` field for this provider shape. For local OpenAI-compatible servers that do not enforce authentication, use any non-empty dummy string such as `"local"` or `"ollama"`. Do not use Python `None`, JSON `null`, or an omitted field. If the local server requires a key, replace the dummy string with that key. Do not put a real external provider key in repo-local files or work packets.

Use the model selector in Pi to pick `qwen27b-local`, or make it the default in Pi if Pi supports a default model setting in the installed version.

To make Pi default to this local worker model, set:

```text
~/.pi/agent/settings.json
```

```json
{
  "defaultProvider": "local-qwen",
  "defaultModel": "qwen27b-local",
  "defaultThinkingLevel": "off"
}
```

Then delegate:

```bash
acpx --cwd /path/to/repo pi -s local-qwen "<task>"
```

## Codex Worker With Local Qwen 27B

Use Codex as the worker only after confirming the local backend is compatible with Codex's current provider protocol. For a generic OpenAI-compatible `/v1/chat/completions` endpoint, prefer the Pi worker path above.

Configure the local endpoint in Codex's user config:

```text
~/.codex/config.toml
```

Use user-level config for provider/profile routing; project-local `.codex/config.toml` may not be allowed to override provider and profile keys.

Example:

```toml
model_provider = "local-qwen"
model = "qwen27b-local"
model_reasoning_summary = "none"
model_supports_reasoning_summaries = false

[model_providers.local-qwen]
name = "Local Qwen 27B"
base_url = "http://127.0.0.1:8000/v1"
env_key = "LOCAL_QWEN_API_KEY"
requires_openai_auth = false

[profiles.local-qwen-worker]
model_provider = "local-qwen"
model = "qwen27b-local"
model_reasoning_summary = "none"
model_supports_reasoning_summaries = false
```

If the local server ignores auth, set a dummy key before launching the worker:

```bash
export LOCAL_QWEN_API_KEY=local
```

Then delegate:

```bash
acpx --cwd /path/to/repo codex -s local-qwen "<task>"
```

If `acpx codex` does not use the intended Codex profile in the installed adapter version, make the local-Qwen provider/model the default for the worker environment or launch a custom ACP command that pins the profile.

## Qwen Code Worker

Use this only when Qwen Code itself should be the worker CLI. Do not use this path merely because the model backend is Qwen.

Configure the local endpoint inside Qwen Code, not in the skill prompt.

Project config: `.qwen/settings.json`
User config: `~/.qwen/settings.json`

Ollama example:

```json
{
  "modelProviders": {
    "openai": [
      {
        "id": "qwen3:32b",
        "name": "Qwen local",
        "baseUrl": "http://127.0.0.1:11434/v1",
        "generationConfig": {
          "contextWindowSize": 131072
        }
      }
    ]
  },
  "security": {
    "auth": {
      "selectedType": "openai"
    }
  },
  "model": {
    "name": "qwen3:32b"
  }
}
```

vLLM example:

```json
{
  "modelProviders": {
    "openai": [
      {
        "id": "Qwen/Qwen3-32B",
        "name": "Qwen vLLM",
        "baseUrl": "http://127.0.0.1:8000/v1"
      }
    ]
  },
  "security": {
    "auth": {
      "selectedType": "openai"
    }
  },
  "model": {
    "name": "Qwen/Qwen3-32B"
  }
}
```

Then delegate with:

```bash
acpx --cwd /path/to/repo qwen -s local-worker "<task>"
```

## Common Local Endpoints

```text
Ollama:     http://127.0.0.1:11434/v1
vLLM:       http://127.0.0.1:8000/v1
LM Studio:  http://127.0.0.1:1234/v1
```

Do not scatter raw ports across work packets. Configure ports in the worker runtime and use stable model aliases in commands.

## What To Ask The User For

If configuration is missing, ask for only the smallest missing piece:

- "Should the worker harness be Pi, Codex, Qwen Code, or another ACP agent?"
- "What model alias should the worker use?"
- "Is the local endpoint Ollama, vLLM, LM Studio, or another OpenAI-compatible server?"
- "Should ACPX use `approve-reads` or `approve-all` for this worker?"
