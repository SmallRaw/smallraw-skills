# Fractal Context CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build a CLI-first `fractal-context` package that reads Fractal Documentation Protocol artifacts for docs-aware project navigation.

**Architecture:** The package is split into focused TypeScript modules: CLI argument parsing, filesystem/root walking, protocol parsers, command handlers, and formatters. The first version is read-only and does not include MCP.

**Tech Stack:** Node.js 18+, TypeScript, esbuild, Node test runner, built-in `fs/path/child_process` APIs.

---

## File Structure

- Create `packages/fractal-context-cli/package.json`: package metadata, `fractal-context` bin, build/test scripts.
- Create `packages/fractal-context-cli/tsconfig.json`: TypeScript config matching the existing package style.
- Create `packages/fractal-context-cli/README.md`: install and command usage.
- Create `packages/fractal-context-cli/src/index.ts`: CLI entrypoint.
- Create `packages/fractal-context-cli/src/args.ts`: small argument parser.
- Create `packages/fractal-context-cli/src/core.ts`: root resolution, safe paths, walking, parsing, command data functions.
- Create `packages/fractal-context-cli/src/format.ts`: Markdown and JSON output formatting.
- Create `packages/fractal-context-cli/test/fractal-context.test.mjs`: CLI and core smoke tests against fixtures.
- Create `packages/fractal-context-cli/test/fixtures/*`: initialized and uninitialized sample projects.
- Modify `README.md`: mention Fractal Context CLI as companion to `fractal-docs`.
- Modify `skills/fractal-docs/README.md`: mention CLI read layer.

## Tasks

### Task 1: Scaffold Package

**Files:**
- Create: `packages/fractal-context-cli/package.json`
- Create: `packages/fractal-context-cli/tsconfig.json`
- Create: `packages/fractal-context-cli/README.md`

- [x] Add package metadata with `fractal-context` bin and scripts.
- [x] Add TypeScript config.
- [x] Add README with status/list/read/search examples.
- [x] Run `npm install` in the package directory.

### Task 2: Core Reader

**Files:**
- Create: `packages/fractal-context-cli/src/core.ts`

- [x] Implement root resolution and path traversal rejection.
- [x] Implement ignored directory/file filtering.
- [x] Implement `AGENTS.md` section parsing and business-domain row extraction.
- [x] Implement INPUT/OUTPUT/POS header detection.
- [x] Implement `getStatus`, `listContext`, `readContext`, and `searchContext`.

### Task 3: CLI And Formatters

**Files:**
- Create: `packages/fractal-context-cli/src/args.ts`
- Create: `packages/fractal-context-cli/src/format.ts`
- Create: `packages/fractal-context-cli/src/index.ts`

- [x] Parse commands and options: `--root`, `--json`, `--depth`, `--max`, `--mode`, `--scope`.
- [x] Format compact Markdown with "Next" suggestions.
- [x] Print JSON when `--json` is present.
- [x] Return non-zero exit codes for invalid commands and unsafe paths.

### Task 4: Tests And Fixtures

**Files:**
- Create: `packages/fractal-context-cli/test/fractal-context.test.mjs`
- Create: `packages/fractal-context-cli/test/fixtures/initialized/*`
- Create: `packages/fractal-context-cli/test/fixtures/plain/*`

- [x] Add initialized fixture with root docs, nested docs, and source headers.
- [x] Add plain fixture without fractal docs.
- [x] Test status, list, read, search, JSON output, and traversal rejection.
- [x] Run build and tests.

### Task 5: Repository Documentation

**Files:**
- Modify: `README.md`
- Modify: `skills/fractal-docs/README.md`

- [x] Document `fractal-context` as the runtime read layer.
- [x] Keep `fractal-docs` documented as the maintenance layer.
- [x] Run final build and test commands.
