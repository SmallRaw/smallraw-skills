# ACPX Worker Protocol

Use this reference when supervising concrete tasks delegated through ACPX.

## Architecture

```text
Codex / Claude Code supervisor
        |
        | shell command
        v
acpx
        |
        | Agent Client Protocol (ACP)
        v
pi / codex / qwen / claude / opencode / custom ACP worker
        |
        | worker-specific model configuration
        v
local OpenAI-compatible model endpoint, remote provider, or built-in account model
        |
        v
repo worktree + ACPX session history + normal git diff
```

ACPX is the protocol and session layer. Do not add tmux unless ACPX cannot keep the worker alive for the chosen mode.

## Session Rules

- Use `--cwd <repo>` for every delegated command.
- Use `-s <name>` to keep independent workstreams separate.
- Use `sessions new --name <name>` when a fresh context is required.
- Use `exec` for one-shot work that should not reuse session history.
- Use `--no-wait` for long-running work only when the supervisor will later check `status` and `sessions history`.
- Use `cancel` instead of killing the process when a running task should stop.

## Permission Rules

- Default to `--approve-reads` for investigation and planning.
- Use `--approve-all` only for tightly scoped implementation packets in disposable worktrees or low-risk paths.
- Use `--deny-all` when asking for analysis that should not use tools or mutate files.

## Output Rules

Use text output for human inspection:

```bash
acpx --cwd /path/to/repo pi -s backend "<task>"
acpx --cwd /path/to/repo codex -s backend "<task>"
acpx --cwd /path/to/repo qwen -s backend "<task>"
```

Use JSON output when another agent or script needs to parse progress:

```bash
acpx --cwd /path/to/repo --format json pi exec "<task>" > workspaces/agent-farm-delegation/runs/task-id/events.ndjson
```

For long-running tasks, keep a small task artifact directory if useful:

```text
workspaces/agent-farm-delegation/runs/<task-id>/
  task.md
  events.ndjson
  review.md
```

Do not require the worker to create custom artifact schemas unless the user asks for a durable audit trail.

## Supervisor Review Checklist

- Confirm the worker stayed inside allowed paths.
- Inspect `git diff` and changed files.
- Read ACPX final output and session history if needed.
- Run targeted verification commands.
- Reject output that invents requirements, changes unrelated files, or skips acceptance criteria.

## Common Commands

```bash
# Create a named session
acpx --cwd /path/to/repo pi sessions new --name backend

# Send a scoped task
acpx --cwd /path/to/repo pi -s backend "<task>"

# Queue a follow-up
acpx --cwd /path/to/repo pi -s backend --no-wait "<follow-up>"

# Check state/history
acpx --cwd /path/to/repo pi -s backend status
acpx --cwd /path/to/repo pi sessions history backend --limit 10

# Cancel active work
acpx --cwd /path/to/repo pi -s backend cancel
```
