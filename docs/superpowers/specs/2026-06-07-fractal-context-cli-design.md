# Fractal Context CLI Design

## Goal

Build `fractal-context`, a read-only CLI that exposes Fractal Documentation Protocol artifacts as compact project context for AI agents and humans reading code.

The tool is not a full language service. It is a docs-aware project navigation layer: it uses `FRACTAL-DOCS.md`, directory `AGENTS.md`, and source INPUT/OUTPUT/POS headers to help agents choose where to read next before falling back to raw source inspection.

## Non-Goals

- Do not replace `skills/fractal-docs` init/update/check.
- Do not generate, edit, or repair project documentation.
- Do not implement a full LSP, type checker, reference graph, or call graph.
- Do not build an eager persistent index in the first version.
- Do not require MCP support for the first release.

## Package Shape

Create `packages/fractal-context-cli`.

The package ships one bundled Node executable:

```bash
npx fractal-context-cli status
npx fractal-context-cli list [path]
npx fractal-context-cli read <path>
npx fractal-context-cli search <query>
```

The binary name is:

```bash
fractal-context
```

The package is CLI-first. MCP can be added later as a wrapper around the same core reader functions.

## Commands

### `status`

Reports whether the current project appears to use Fractal Documentation Protocol.

Output includes:

- resolved root
- whether `FRACTAL-DOCS.md` exists
- whether root `AGENTS.md` exists
- count of discovered directory `AGENTS.md` files within limits
- count of source files with detectable INPUT/OUTPUT/POS headers within limits
- stale signals such as missing docs, deleted paths listed in docs, or files newer than nearby docs
- suggested next command

### `list [path]`

Lists one directory level by default, with optional bounded depth.

Options:

- `--depth <n>` default `1`, maximum `3`
- `--max <n>` default `80`
- `--json`

Output includes:

- directory path
- local `AGENTS.md` summary when present
- child directories and files
- file INPUT/OUTPUT/POS headers when detectable
- suggested next paths
- truncation metadata

### `read <path>`

Reads the documentation view for a directory or file.

Options:

- `--mode auto|docs|headers|full`, default `auto`
- `--json`

Behavior:

- directories read parsed `AGENTS.md` sections plus immediate child summary
- files read INPUT/OUTPUT/POS headers by default
- `--mode full` reads file content with a byte cap and truncation metadata
- root protocol files return compact protocol content

### `search <query>`

Searches documentation metadata before raw source content.

Options:

- `--scope docs|headers|all`, default `docs`
- `--max <n>` default `20`
- `--json`

Result priority:

1. `AGENTS.md` business-domain rows and section text
2. INPUT/OUTPUT/POS headers
3. filenames
4. source content only when `--scope all`

## Output Rules

Markdown is the default because agents can read it without extra parsing.

JSON is available for programmatic use. JSON output must contain the same core facts as Markdown plus structured truncation and stale metadata.

All output should be compact and include a "Next" section or `next` field that suggests narrower follow-up commands.

## Data Flow

1. Resolve the root from `--root <path>` or current working directory.
2. Keep all requested paths inside the root.
3. Apply ignore rules for `.git`, `node_modules`, build outputs, caches, package manager directories, and hidden tool state.
4. Walk only the requested subtree and enforce entry and byte caps.
5. Parse `FRACTAL-DOCS.md` as the root protocol marker.
6. Parse each `AGENTS.md` into titled sections and business-domain table rows.
7. Detect INPUT/OUTPUT/POS headers using generic line scanning that works across common comment syntaxes.
8. Return a compact documentation view plus stale/truncation metadata.

## Stale Signals

The first version should report lightweight signals, not auto-fix them:

- `AGENTS.md` mentions a path that no longer exists.
- source file exists without detectable INPUT/OUTPUT/POS header.
- source file `mtime` is newer than the nearest directory `AGENTS.md`.
- project lacks `FRACTAL-DOCS.md` or root `AGENTS.md`.

These are warnings. They should not block `list`, `read`, or `search`.

## Testing

Use fixture projects under the package test area:

- initialized project with `FRACTAL-DOCS.md`, root `AGENTS.md`, nested `AGENTS.md`, and source headers
- project without fractal docs
- path traversal rejection
- oversized file/full read truncation
- search ranking across docs, headers, filenames, and source content

Verification should cover:

- parser functions
- tree walking and ignore behavior
- CLI smoke tests for Markdown output
- JSON output for each command

## Relationship To Existing Skill

`skills/fractal-docs` remains the maintenance layer:

- `init` creates protocol files and headers
- `update` keeps docs synchronized after changes
- `check` validates consistency

`fractal-context` is the runtime read layer:

- status project context health
- list docs-aware structure
- read directory and file context views
- search docs and header metadata

## Acceptance Criteria

- `packages/fractal-context-cli` builds a Node CLI named `fractal-context`.
- `fractal-context status` distinguishes initialized and uninitialized projects.
- `fractal-context list` shows docs-aware structure without dumping the whole repo.
- `fractal-context read` reads directory docs and file header views.
- `fractal-context search` prioritizes `AGENTS.md` and INPUT/OUTPUT/POS headers.
- `--json` works for all commands.
- Existing `skills/fractal-docs` behavior is not changed except documentation links if useful.
