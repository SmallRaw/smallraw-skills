# Repository Agent Rules

## Generated Workspaces

- Put all generated evaluation, benchmark, review, loop, snapshot, and temporary
  task artifacts under `workspaces/<skill-or-task>/<purpose>/`.
- Never create `*-workspace`, `*-runs`, iteration, loop, or evaluation-output
  directories at the repository root or beside a directory in `skills/`.
- Treat `workspaces/` as local disposable state. Git tracks only
  `workspaces/README.md`; do not stage or commit its generated contents.
- Keep durable Skill sources, scripts, references, tests, fixtures, and eval
  definitions in `skills/<skill-name>/`. Move an artifact out of `workspaces/`
  only when the user explicitly wants it to become maintained project source.
- Reuse a workspace only when it belongs to the current task. Otherwise create a
  clearly named purpose subdirectory instead of mixing unrelated runs.
- Do not delete an existing workspace without listing its exact path, reason, and
  impact and receiving explicit user confirmation.
