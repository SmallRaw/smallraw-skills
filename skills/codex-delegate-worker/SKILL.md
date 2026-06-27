---
name: codex-delegate-worker
description: Delegate work to an external Agent through a separate one-off `codex exec` process. Use when the user asks to let an external Agent handle a task, or when the work should run in an isolated alternate-provider Codex worker without changing durable Codex config.
---

# Codex Delegate Worker

Use this skill to hand work to an external Agent. The user only needs to express the delegation intent, such as "让外部 Agent 做", "交给外部 Agent", or "use an outside worker"; the parent Codex session is responsible for writing the worker prompt.

This is not a native Codex subagent role file and not an application worker thread. It starts a separate `codex exec --ephemeral` process with one-run provider overrides.

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
