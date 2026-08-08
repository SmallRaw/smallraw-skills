---
name: agent-farm-delegation
description: Use when the user explicitly invokes $agent-farm-delegation or asks to delegate a small, already-scoped task to an ACPX-backed Pi, Codex, or local ACP worker. Do not use for ordinary planning, broad architecture work, local model setup without delegation, ambiguous coding tasks, or implicit subagent use.
---

# Agent Farm Delegation

Delegate narrow, verifiable work to coding-agent workers through `acpx`, while the main Codex or Claude Code session remains the supervisor. The worker adapter and the model are separate: for example, `acpx pi` can run Pi while Pi is configured to use a local OpenAI-compatible Qwen 27B endpoint.

## Core Rules

1. **Explicit only** - Use this skill only after the user clearly asks for ACPX/local/Pi/Codex/Qwen worker delegation or invokes `$agent-farm-delegation`.
2. **Plan first, delegate second** - Split large work into small packets before invoking a worker.
3. **Do not confuse worker with model** - Choose `acpx pi`, `acpx codex`, or another ACP worker by harness/runtime. Configure the local OpenAI-compatible model endpoint inside that worker's own model settings.
4. **ACPX first** - Use `acpx pi` when Pi is the worker, `acpx codex` when Codex is the worker, and `acpx qwen` only when Qwen Code itself is the desired worker.
5. **No raw tmux scraping** - Do not scrape PTY output or drive a TUI with `send-keys` unless ACPX/ACP is unavailable and the user explicitly accepts the fallback.
6. **Local workers are not decision owners** - Do not delegate architecture choices, unclear requirements, safety-sensitive actions, releases, destructive commands, or final acceptance.
7. **Main agent verifies everything** - Treat worker output as a draft. Inspect diffs, run relevant checks, and decide what to adopt.

## Delegation Gate

Delegate only when all are true:

- The task can be described in 5-10 sentences.
- The expected files or search area are known.
- Acceptance criteria are concrete.
- The worker can make progress without more product judgment.
- The result can be verified by tests, diff review, logs, or exact output.
- The blast radius is limited to a worktree or explicitly listed paths.

Do not delegate when any are true:

- The user is asking what should be built.
- The task requires nuanced tradeoffs or cross-system design.
- The worker would need broad filesystem, production, credential, or network access.
- The output cannot be objectively checked.
- A wrong change would be expensive to unwind.

## Workflow

1. **Create a work packet**
   - State the goal, allowed paths, forbidden actions, and acceptance criteria.
   - Include the repo path and preferred session name.
   - Keep the packet narrow enough for a weaker local model.

2. **Choose the worker**
   - Use `acpx pi` when Pi should run the task against a configured local model.
   - Use `acpx codex` when Codex should run the task against a configured local model.
   - Use `acpx qwen` only when Qwen Code is the worker CLI, not merely because the model is Qwen.
   - Use `acpx --agent <command>` only for a custom ACP server.

3. **Run through ACPX**
   - Use `--cwd <repo>` to bind the worker to the right repository.
   - Use `-s <name>` for persistent named sessions.
   - Use `exec` for one-shot tasks.
   - Use `--format json` when the supervisor needs machine-readable events.
   - Use `--no-wait` only when a long-running task can be checked later with `status` and session history.

4. **Verify**
   - Review ACPX output and any changed files.
   - Run the smallest commands that prove the acceptance criteria.
   - Apply only the parts that pass review.

## Command Patterns

```bash
# Persistent Pi worker using its configured local model
acpx --cwd /path/to/repo pi -s local-qwen '<work packet>'

# Persistent Codex worker using its configured local model/profile
acpx --cwd /path/to/repo codex -s local-qwen '<work packet>'

# One-shot analysis with machine-readable output
acpx --cwd /path/to/repo --format json pi exec '<work packet>'

# Queue a long task without blocking
acpx --cwd /path/to/repo pi -s tests --no-wait '<work packet>'

# Inspect worker state later
acpx --cwd /path/to/repo pi -s tests status
acpx --cwd /path/to/repo pi sessions history tests --limit 10
```

## Work Packet Template

```markdown
# Worker Task: <short title>

## Goal
<one concrete outcome>

## Context
- Repo: <absolute path>
- Allowed files/search area: <paths>
- Forbidden actions: <actions and paths>

## Steps
1. Inspect only the relevant files.
2. Make the smallest useful change or produce the requested analysis.
3. Run the listed verification commands when possible.
4. Report changed files, commands run, result, risks, and remaining questions.

## Acceptance Criteria
- <criterion 1>
- <criterion 2>
```

## References

| File | When to read |
|------|--------------|
| `references/configuration.md` | Need to configure ACPX, Pi/Codex worker selection, local model aliases, endpoints, or ports |
| `references/worker-protocol.md` | Need ACPX session, JSON output, long-running task, or supervisor review details |
