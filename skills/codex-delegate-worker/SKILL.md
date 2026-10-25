---
name: codex-delegate-worker
description: Run Codex through a configured custom model node with native settings and session features. Configure Local or Global nodes privately. Use when the user requests the custom worker, custom node, or its setup.
---

# Codex Delegate Worker

## Configure privately

For provider setup or management, open the program's private terminal:

```bash
node <skill-dir>/scripts/codex-delegate-worker.mjs init
```

The user enters the address, model, and Key there and manages Local or Global providers. Do not capture or automate the private input, ask for these values in chat, or read provider configuration or credential storage. Configuration changes go through the program. `status` returns configuration flags without private values; when configuration is missing, open `init` and wait for the user to finish.

## Run Codex

For an automated task:

```bash
node <skill-dir>/scripts/codex-delegate-worker.mjs "<task>"
```

Use native Codex arguments for the task's permissions and features. `codex exec` defaults to read-only without permission settings; `--sandbox workspace-write` is the native mode for file edits. Preserve the user's selected permissions and profiles.

Pass a complete native command after `--`, for example `-- exec resume --last`. For the user's normal interactive Codex, run `open`; arguments after `open` go to the CLI in a separate user terminal. The user can also run `interactive` in their own terminal or SSH session. These displays may contain private provider details, so leave their interaction to the user.

The launcher changes the configured model connection, inherits normal Codex settings and session storage, and filters private values from captured task output. Summarize the result. For provider setup errors, use the configuration manager without exposing private settings.
