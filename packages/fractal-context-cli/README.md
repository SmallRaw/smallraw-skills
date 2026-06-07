# fractal-context-cli

Read-only CLI for Fractal Documentation Protocol context.

## Usage

Local repository usage:

```bash
npm install
npm run build
node dist/index.js status --root /path/to/project
node dist/index.js list src --depth 2 --root /path/to/project
node dist/index.js read src/wallet.ts --root /path/to/project
node dist/index.js search wallet --root /path/to/project
```

After publishing to npm:

```bash
npx fractal-context-cli status
npx fractal-context-cli list src --depth 2
npx fractal-context-cli read src/wallet.ts
npx fractal-context-cli search wallet
```

Installed binary:

```bash
fractal-context status
fractal-context list
fractal-context read src/wallet.ts --mode headers
fractal-context search wallet --json
```

`fractal-context` reads `FRACTAL-DOCS.md`, directory `AGENTS.md`, and source INPUT/OUTPUT/POS headers. It does not create, update, or repair documentation.

## Commands

```bash
fractal-context status [--root <path>] [--json]
fractal-context list [path] [--depth 1-3] [--max 80] [--root <path>] [--json]
fractal-context read <path> [--mode auto|docs|headers|full] [--root <path>] [--json]
fractal-context search <query> [--scope docs|headers|all] [--max 20] [--root <path>] [--json]
```

## Design Boundary

`fractal-context` is a compact context reader, not a full language service. It helps agents answer "where should I read next?" by prioritizing project documentation and source headers before raw source content.

Use `/fractal-docs init`, `/fractal-docs update`, and `/fractal-docs check` to maintain the protocol. Use `fractal-context` to consume it.

## Publishing

Publishing is only needed for `npx fractal-context-cli ...` from machines that do not have this repository checked out.

```bash
npm login
npm test
npm publish --access public
```
