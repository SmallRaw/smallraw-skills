---
name: codex-delegate-worker
description: Run a one-off Codex worker through the configured custom model node. Use only when the user explicitly requests the custom worker or custom node. Do not use for native Codex subagents, parallel agents, ChatGPT subscription usage, or OpenAI GPT models; those must use Codex's native agent path.
---

# Codex Delegate Worker

Use this skill to hand work to the configured custom-node worker. The user only needs to express that intent, such as "让自定义节点做", "交给自定义 worker", or "use the custom node". Write the worker prompt from the user's intent.

This is not a native Codex subagent role or application worker thread.

## Provider Gate

Before invoking the launcher, resolve the requested execution channel:

- For a native Codex subagent, parallel agent, ChatGPT subscription, or OpenAI model such as `gpt-*`, do not use this skill. Use Codex's native subagent tools instead.
- Use this skill only when the user explicitly wants the configured custom node.

Do not infer the provider from the word "agent" or "subagent". If the user names both a native subagent and an OpenAI model, the native path wins.

## Launcher

Invoke the launcher with only the worker task:

```bash
node <skill-dir>/scripts/codex-delegate-worker.mjs "<worker task>"
```

Treat the launcher as an opaque boundary. Do not inspect its source, private setup, credential sources, environment, or user documentation. Do not add model, provider, authentication, or configuration overrides.

## Workflow

1. Convert the user's intent into a focused worker prompt with the task, relevant files, constraints, expected output, and stopping condition.
2. Invoke the launcher once with that prompt.
3. Summarize what the custom-node worker did, including files changed or commands run.

## Prompt Rules

Write a fresh prompt for every worker run. Do not rely on a generic default prompt, and do not ask the user to provide provider wiring or prompt mechanics unless the task is genuinely ambiguous.

Keep the worker prompt narrow. The worker is expected to do the delegated work, not make product decisions outside the user's request.

If the launcher reports that the custom node is unavailable or misconfigured, return the sanitized error to the user. Do not investigate the private setup.
