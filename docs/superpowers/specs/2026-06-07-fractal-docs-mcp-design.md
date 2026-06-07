# Fractal Docs MCP Design

## Goal

Build a fast NPM package, `fractal-docs-mcp`, that exposes existing Fractal Documentation Protocol artifacts as system-discoverable project navigation tools.

The current `skills/fractal-docs` flow is useful for creating and maintaining `FRACTAL-DOCS.md`, directory `AGENTS.md`, and source file INPUT/OUTPUT/POS headers. Its weakness is discovery: an AI agent has to know to invoke the skill before it benefits from the documentation. The new package should make the same information available through MCP tool discovery, so an agent can list, descend, read, and search project context without first remembering a special skill.

## Non-Goals

- Do not replace `skills/fractal-docs` init/update/check.
- Do not generate or rewrite project documentation in the MCP server.
- Do not index entire repositories eagerly on startup.
- Do not require projects to adopt a new documentation format beyond the existing protocol.

## Package Shape

Add a new package at `packages/fractal-docs-mcp`.

The package ships one bundled Node executable with two modes:

```bash
npx fractal-docs-mcp
npx fractal-docs-mcp list [path]
npx fractal-docs-mcp read <path>
npx fractal-docs-mcp search <query>
npx fractal-docs-mcp status
```

Default invocation starts a stdio MCP server. CLI subcommands are thin wrappers over the same core reader functions used by the MCP tools.

The implementation should use TypeScript and esbuild, matching `packages/mcp-client-utils` conventions where practical.

## MCP Tools

### `fractal_status`

Reports whether the current project appears to use Fractal Documentation Protocol.

Inputs:

- `root?: string` defaults to current working directory.

Output:

- project root
- whether `FRACTAL-DOCS.md` exists
- whether root `AGENTS.md` exists
- count of discovered directory `AGENTS.md` files within scan limits
- count of source files with detectable INPUT/OUTPUT/POS headers within scan limits
- concise guidance for the next tool call

### `fractal_list`

Lists one level or a bounded depth of project structure with fractal summaries.

Inputs:

- `path?: string` relative path, defaults to `.`
- `depth?: number` default `1`, maximum `3`
- `includeDocs?: boolean` default `true`
- `maxEntries?: number` default `80`

Output:

- node path and type
- child directories and files
- if present, summary extracted from local `AGENTS.md`
- for files, detected INPUT/OUTPUT/POS header only, not full file content
- truncation metadata when max limits are reached
- suggested next paths to inspect

This is the main discovery tool. It should expose enough context for an agent to choose the next directory without flooding context.

### `fractal_read`

Reads the documentation view for a specific path.

Inputs:

- `path: string`
- `mode?: "auto" | "docs" | "headers" | "full"` default `"auto"`

Output:

- for directories: parsed `AGENTS.md` sections when available, plus immediate child summary
- for files: INPUT/OUTPUT/POS header and optionally full file content
- for root protocol files: compact protocol summary

`mode: "full"` is allowed only for files and should still enforce a size cap with clear truncation metadata.

### `fractal_search`

Searches fractal documentation metadata, not full source content by default.

Inputs:

- `query: string`
- `path?: string` default `.`
- `scope?: "docs" | "headers" | "all"` default `"docs"`
- `maxResults?: number` default `20`

Output:

- matched paths
- match type: `agents-section`, `business-domain-row`, `header`, or `filename`
- short excerpt
- score or ordering reason

Search should prefer `AGENTS.md` business-domain rows and source headers before falling back to filenames.

## CLI Commands

CLI output should be deterministic, compact Markdown by default:

```bash
fractal-docs-mcp status
fractal-docs-mcp list src --depth 2
fractal-docs-mcp read src/foo.ts --mode headers
fractal-docs-mcp search wallet
```

The CLI is secondary. It exists for manual debugging, tests, and non-MCP agent environments.

## Data Flow

1. Resolve the project root from the supplied `root` or current working directory.
2. Apply ignore rules for `.git`, `node_modules`, build outputs, caches, and hidden tool directories.
3. For list/read/search calls, walk only the requested subtree and enforce limits.
4. Parse `FRACTAL-DOCS.md` as a protocol marker and compact summary.
5. Parse each `AGENTS.md` into sections and business-domain table rows.
6. Detect source file headers using language-aware comment prefixes where feasible, with a generic fallback for `INPUT:`, `OUTPUT:`, and `POS:`.
7. Return structured MCP content plus concise human-readable text.

## Performance

The server should feel instant on normal repositories:

- startup should avoid full-tree indexing
- list depth defaults to one level
- all walks should have entry and byte caps
- file reads should stop after header detection unless full mode is requested
- search may scan more broadly, but must cap file count and bytes read

No persistent index is required in the first version.

## Error Handling

- Missing fractal docs should not be a hard error. `fractal_status` should explain that the project is not initialized and suggest using the existing `fractal-docs` skill or CLI maintenance flow.
- Paths must stay inside the resolved root.
- Binary files and oversized files should be skipped with explicit metadata.
- Invalid arguments should produce MCP errors with actionable messages.
- Partial results are acceptable when limits are reached, but the response must include truncation details and suggested narrower calls.

## Testing

Use focused fixtures under the package test area:

- project with only `FRACTAL-DOCS.md` and root `AGENTS.md`
- nested project with directory `AGENTS.md` files and source headers
- project without fractal docs
- oversized file and binary file behavior
- path traversal rejection

Verification should cover:

- pure parser functions
- tree walking and ignore behavior
- CLI output smoke tests
- MCP tool call smoke tests through stdio where practical

## Relationship To Existing Skill

`skills/fractal-docs` remains the maintenance layer:

- `init` creates the protocol files and headers
- `update` keeps docs synchronized after changes
- `check` validates consistency

`packages/fractal-docs-mcp` becomes the runtime discovery layer:

- list project context
- descend into relevant modules
- read directory and file documentation views
- search documentation metadata

The two should reference each other in documentation, but implementation should stay separate.

## Acceptance Criteria

- A new NPM package can be installed or invoked with `npx fractal-docs-mcp`.
- Running with no subcommand starts a stdio MCP server exposing the four tools above.
- `fractal_list` reveals root-level fractal docs and next-step paths without dumping the whole repo.
- `fractal_read` can read a directory `AGENTS.md` view or file header view.
- `fractal_status` clearly distinguishes initialized and uninitialized projects.
- Existing `skills/fractal-docs` behavior is not changed except for documentation links if needed.
