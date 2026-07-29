---
name: codex-delegate-worker
description: Run a one-off Codex worker through the configured custom model node. Use only when the user explicitly requests the custom worker or custom node. Do not use for native Codex subagents, parallel agents, ChatGPT subscription usage, or OpenAI GPT models; those must use Codex's native agent path.
---

# Codex Delegate Worker

Use this skill to hand work to the configured custom-node worker. The user only needs to express that intent, such as "让自定义节点做", "交给自定义 worker", or "use the custom node"; the parent Codex session is responsible for writing the worker prompt.

This is not a native Codex subagent role file and not an application worker thread. It starts a separate `codex exec --ephemeral` process with one-run provider overrides.

## Provider Gate

Before invoking the launcher, resolve the requested execution channel:

- For a native Codex subagent, parallel agent, ChatGPT subscription, or OpenAI model such as `gpt-*`, do not use this skill. Use Codex's native subagent tools instead.
- Use this skill only when the user explicitly wants the configured custom node.

Do not infer the provider from the word "agent" or "subagent". If the user names both a native subagent and an OpenAI model, the native path wins.

## Launcher

Run:

```bash
node <skill-dir>/scripts/codex-delegate-worker.mjs "<worker task>"
```

Pass any `codex exec` flags before the task:

```bash
node <skill-dir>/scripts/codex-delegate-worker.mjs --sandbox read-only "summarize this repository"
```

For setup details, config examples, auth modes, and troubleshooting, read `README.md` in this skill directory only when the user asks about configuration or a launcher run fails because configuration is missing.

## Workflow

1. Inspect available config without printing secrets. The launcher reads global config, local `.codex-delegate-worker.json`, explicit config file, then environment overrides.
2. Convert the user's intent into a focused worker prompt. Include the concrete task, relevant files, constraints, expected output, and when the worker should stop.
3. Run a small smoke test first if the provider or credentials have not been verified in this repo.
4. Run the real delegated task through the launcher.
5. Summarize what the external Agent did, including any files changed or commands run.

## Prompt Rules

Write a fresh prompt for every worker run. Do not rely on a generic default prompt, and do not ask the user to provide provider wiring or prompt mechanics unless the task is genuinely ambiguous.

Keep the worker prompt narrow. The worker is expected to do the delegated work, not make product decisions outside the user's request.

## Safety

Never write API keys to `SKILL.md`, examples, tracked repo files, logs, or persistent Codex config. Do not print config values that may contain secrets.

Prefer command-backed auth for real credentials. If direct API keys are used for low-risk runs, the launcher passes the key to the child process environment and configures Codex to exclude `CODEX_DELEGATE_WORKER_API_KEY` from model-initiated shell environments.
