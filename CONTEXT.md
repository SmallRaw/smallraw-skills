# Guardrails

The four policy modules and the hook that runs them. They sit between an agent
and the machine it is working on, and exist to stop one thing: harm that cannot
be undone.

Tuned against one person's work — several thousand real sessions of monorepo,
mobile, and embedded development on macOS — and published for anyone. Where the
two pull apart, the tuning wins and the difference is written down rather than
smoothed over: removing a container is allowed here because every container in
that corpus was a smoke test, which is not true of a machine running a database
locally.

## Language

### What is being prevented

**不可恢复的伤害**:
Harm with no path back on this machine. The single thing the guardrails exist to
prevent, in three categories: leaked privacy, deleted work, published artifacts.
_Avoid_: 危险, dangerous — those name a feeling, and hid four unrelated ideas
behind one word until the distinction was forced.

**隐私泄露**:
An agent reading, or sending onward, a secret that belongs to the user — keys,
credential stores, environment values. Reading and exfiltrating are the same
category because a read that stays local is only one command away from leaving.

**误删**:
Removing something the user did not authorize removing, where no copy remains.
A file tracked in git is not this; an uncommitted change is.

**对外发布**:
Reaching a remote that other people read — a push, a registry publish. Belongs to
不可恢复 rather than beside it: a wrong publish cannot be taken back, and npm has
no force-push equivalent at all.

**授权**:
The user having asked for a particular act in this session. The approval prompt
is where authorization is established, and it is the only place that can be:
anything stored — a file, a flag, a session marker — is something the agent can
write, and therefore something it can grant itself.

**越界写**:
Writing to a path outside the workspace the session started in. This, not
crossing the boundary, is what is worth stopping: reading another repository is
ordinary work, while writing into one damages something nobody asked to touch.
Overwriting counts as much as deleting — `echo x > other/package.json` destroys
the contents as completely as removing the file, and more quietly, because the
file is still there.
_Avoid_: 越界 alone — it does not say read or write, and only one of those
matters.

### How a rule answers

**allow / confirm / deny**:
The three verdicts a policy module returns. `confirm` becomes the host's `ask`
in `guard.mjs`; the two words name one tier.
_Avoid_: block, warn, flag.

**绝对拒绝**:
A `deny` with no permitted spelling, used only by the privacy gate. Distinct from
the other modules' `deny`, which refuses one phrasing and expects a different one.

**包装**:
A command that carries another command inside it — `bash -c '…'`, `$( … )`,
backticks, `xargs … sh -c '…'`. What matters is not that it wraps, but whether
what it wraps can be read.

**可读的包装**:
A wrapper whose payload is a literal sitting in the command text. It is judged by
reading the payload and evaluating it as the command it is. Not reading one is a
choice, not a limitation — 1,781 of the wrappers in this user's history are this
kind.

**运行时才成形**:
A wrapper whose payload only exists once the shell expands it — `bash -c "$CMD"`,
`| sh`, `eval`. Refused outright, because nothing can be said about it and the
alternative is every gate going blind at once. Rare enough to cost nothing: nine
occurrences in 27,319 calls.

**免审写法**:
A spelling of the same intent that no rule stops — `npm ci --ignore-scripts`
against a committed lockfile, a `pkill` pattern naming one process.
_Avoid_: 安全写法, safe spelling. "Safe" invites reading the goal as "gets past
the gate", which is the evasion the guidelines forbid; the point is that these
genuinely do less, and needing no approval is the consequence.

### Constraints on the system itself

**心智预算**:
The ceiling on how much rule, prompt, and interruption an agent can carry before
its capability degrades. A rule that prevents nothing irreversible spends this
budget for nothing, and is therefore a cost rather than a neutral addition.

**声明外**:
Something these gates do not cover and do not claim to. A boundary written down
is safer than one implied, because only the written one stops anybody counting
on coverage that is not there. The current boundaries: prompt injection, which
this cannot defend against and does not try to; anything sent to another machine
through `ssh` or `adb shell`; code reached by writing a script and then running
it, since the gates read commands rather than files; and build entry points —
`make`, `./configure`, `docker build` — which run downloaded code by design,
where gating them would mean gating compilation itself.

**开发副本 / 在用副本**:
This repository is where the policies are written; `~/.claude/skills/` holds the
copies the hooks actually load. Both exist on purpose and drift is expected — a
finding about behaviour has to name which one it came from.
