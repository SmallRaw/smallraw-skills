# fractal-context-cli

Optional, read-only navigation for module knowledge in ordinary Markdown. The documents work with normal file readers, search, Git and project tests; neither this CLI nor a generated protocol is required.

## Usage

Local repository usage:

```bash
npm install
npm run build
node dist/index.js list src --depth 2 --root /path/to/project
node dist/index.js read src/parser/MODULE.md --root /path/to/project
node dist/index.js search parser --root /path/to/project
```

After publishing to npm, use `npx fractal-context-cli ...`, or install the `fractal-context` binary.

```text
fractal-context status [--root <path>] [--json]
fractal-context list [path] [--depth 1-3] [--max 80] [--root <path>] [--json]
fractal-context read <path> [--mode auto|docs|headers|full] [--root <path>] [--json]
fractal-context search <query> [--scope docs|headers|all] [--max 20] [--root <path>] [--json]
```

## Reading conventions

- Directory navigation prefers `MODULE.md`, then `README.md`, then legacy `AGENTS.md`. Existing project instructions stay in their original files; the CLI never changes them.
- Direct `read` of any `.md` / `.markdown` file returns its text in `auto`, `docs` or `full` mode, with a 64 KiB display limit and a truncation flag. Arbitrarily named design documents in `docs/` can be read and searched without a module registry.
- Source files retain the compact header view in `auto` / `headers` mode. Headers are optional; use `--mode full` to read source, or `--mode docs` to read the nearest directory documentation. Suggested next reads point to relevant module documentation when available.
- Search includes Markdown body text (including old `FRACTAL-DOCS.md` / `AGENTS.md`), optional source headers and filenames; `--scope headers` skips document bodies, and `--scope all` also checks the first 16 KiB of source content. Results and traversal are bounded, so this is a navigation aid rather than an exhaustive repository search. `truncated` indicates limits reached while collecting results, traversing files or reading searched document/source text.
- `status` reports what exists. For legacy navigation it can also report missing project-local literal paths in explicitly headed path tables. Only bare paths or single-backtick paths are inferred; linked cells, escaped-pipe rows and other ambiguous syntax stay in the original body without guessed paths. Ordinary Markdown links are not validated. Check links and design evidence with normal project tools or the maintenance skill.
- Missing headers, missing protocol / instruction files and newer source timestamps are not errors. No stale signals does not establish that links or design knowledge are correct.

JSON results expose selected documentation in `document`. Legacy directory `AGENTS.md` results also retain `agents`; the existing `hasProtocol`, `hasRootAgents`, `agentsCount` and `headerCount` fields remain informational. `documentCount` counts scanned Markdown files.

## Maintenance

Use ordinary editors and project tests, or `/fractal-docs init`, `/fractal-docs update --base <ref>` and `/fractal-docs check`. The CLI does not create, update, repair or require documentation.

## Publishing

Publishing is only needed for machines that do not have this repository checked out:

```bash
npm login
npm test
npm publish --access public
```
