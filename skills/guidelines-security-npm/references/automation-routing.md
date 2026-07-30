# NPM Review Automation

Read this reference only when automating a new or changed dependency review.

Run automated checks once after the dependency edit is coherent. Scope them to changed
direct and transitive lockfile entries instead of repeatedly rescanning the unchanged
tree after every small edit.

## Levels

| Level | Purpose | Normal action |
| --- | --- | --- |
| L0 | Deterministic manifest and lockfile checks | Run the bundled lockfile preflight. |
| L1 | Current malware and vulnerability intelligence | Use an already trusted scanner against the complete changed graph. |
| L2 | Exact published tarball inspection | Verify integrity, extract safely, and statically scan the artifact. |
| L3 | Semantic review | Inspect suspicious scripts, binaries, native code, WASM, obfuscation, and source-to-tarball differences. |
| L4 | Dynamic evidence | Run only a justified target with synthetic data in a credential-free sandbox. |

L0 does not replace L1-L4. A clean level advances the review; it never proves safety.

## Script Output Contract

The L0 preflight and L4 launcher write one JSON result to stdout for every attempted run:

- `status` identifies the state, never package safety;
- `code` or `error.code` is the stable machine-readable reason;
- `nextAction` or `error.nextAction` tells the operator what to do next;
- each L0 finding contains its own `code`, `detail`, and `action`.

Branch on stable codes, not message text. Follow the returned action instead of
inventing a bypass. Exit `0` advances to the next required gate, exit `1` requires
review or reports bounded dynamic evidence, and exit `2` means
`blocked-pending-review`. `--help` prints command syntax without running a review.

## L0 Lockfile Preflight

The bundled script uses only the Node.js standard library. It reads only explicitly
named, regular `package.json` and `package-lock.json` files, defaults to the official
npm registry, and supports package-lock versions 2 and 3.

```sh
node scripts/preflight-lockfile.mjs \
  --manifest /review/current/package.json \
  --lockfile /review/current/package-lock.json \
  --baseline /review/baseline/package-lock.json
```

Add `--allow-host <exact-host>` only for a registry already approved by the user.
The baseline makes the scan target only added or changed lockfile entries. Without a
baseline, the entire lockfile is treated as new.

Exit codes:

- `0`: no lockfile change or mechanical finding; continue with any other required gate.
- `1`: changed dependency state or a finding requires the next review level.
- `2`: input, format, or coverage is incomplete; return `Blocked Pending Review`.

When findings are present, address every `findings[].action`. Rerun only after the
coherent dependency state or review input changed.

## L1-L3 Routing

- Known malware, invalid integrity, unexpected sources, or a scanner failure: reject
  or block immediately; do not detonate the package.
- New lifecycle scripts, native code, WASM, obfuscation, unexplained downloads, or
  source-to-tarball differences: require L3 before considering L4.
- Critical or clearly malicious behavior: `Rejected`. Dynamic execution adds risk
  without useful evidence.
- Missing trusted scanners, private-registry-safe intelligence, or safe extraction:
  `Blocked Pending Review`. Do not install a scanner ad hoc to keep going.

## L4 SRT Launcher

The bundled launcher reuses a separately reviewed Anthropic Sandbox Runtime (SRT)
installation. It does not install, update, discover, or trust SRT automatically.
The caller must supply the reviewed package root, exact version, and SHA-256 digest of
`dist/cli.js`. A mismatch blocks before execution. Versions older than `0.0.50` are
rejected because that release added positional-argument quoting and protected-ancestor
write fixes required by this launcher.

The launcher:

- invokes SRT with `shell: false`, passes target argv after `--`, and never accepts
  SRT `-c`; SRT itself may use a shell inside the OS sandbox on macOS and Linux;
- always supplies a generated settings file instead of reading
  `~/.srt-settings.json`;
- constructs a small literal child environment instead of inheriting host variables;
- denies network, local binding, Unix sockets, Apple Events, and weaker SRT modes;
- denies reads from common home, mounted-volume, and temporary-data roots, then
  re-allows only the quarantine and reviewed runtime;
- allows writes only inside the dedicated quarantine;
- enforces wall-clock and captured-output limits;
- writes policy, output, and result evidence outside the writable quarantine without
  overwriting existing files.

```sh
node scripts/run-srt-review.mjs \
  --node /reviewed/runtime/node \
  --srt-package-root /reviewed/runtime/node_modules/@anthropic-ai/sandbox-runtime \
  --expected-srt-version <exact-version> \
  --expected-srt-sha256 <reviewed-cli-sha256> \
  --workdir /review/quarantine \
  --evidence-dir /review/evidence \
  --runtime-bin-dir /reviewed/runtime/bin \
  -- /review/quarantine/target [arg ...]
```

`quarantine/` and `evidence/` must be sibling directories. Use
`--runtime-bin-dir` only when a reviewed SRT prerequisite such as `rg` is outside
the Node executable directory or system path.

SRT is a beta filesystem and network isolation layer. This launcher does not enforce
CPU, memory, process-count, file-count, or disk quotas. Native code, fork bombs,
resource-exhaustion payloads, sandbox probes, and other high-risk targets remain
`Blocked Pending Review` unless a stronger external resource boundary is available.

If SRT is absent, unreviewed, version-mismatched, unsupported, or cannot enforce the
generated policy, do not fall back to direct host execution.
