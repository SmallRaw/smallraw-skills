# Local Workspaces

This directory is the only repository location for generated agent work:

```text
workspaces/<skill-or-task>/<purpose>/
```

Examples include evaluation iterations, benchmark output, review HTML, snapshots,
loop state, and temporary task artifacts.

Git does not track generated contents under this directory. Only this README is
versioned. Durable Skill code, tests, fixtures, references, and `evals/evals.json`
belong under `skills/<skill-name>/`.
