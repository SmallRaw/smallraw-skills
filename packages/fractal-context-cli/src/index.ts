// INPUT: CLI process arguments and project files under the selected root
// OUTPUT: Fractal Context command output on stdout or actionable errors on stderr
// POS: Node executable entrypoint for the fractal-context command

import { parseArgs, usage } from "./args.js";
import { getStatus, listContext, readContext, searchContext } from "./core.js";
import { formatJson, formatMarkdown } from "./format.js";

async function main() {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.length === 0 || rawArgs.includes("--help") || rawArgs.includes("-h")) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const parsed = parseArgs(rawArgs);
  let result;

  switch (parsed.command) {
    case "status":
      result = getStatus({ root: parsed.root, max: parsed.max });
      break;
    case "list":
      result = listContext(parsed.path ?? ".", { root: parsed.root, depth: parsed.depth, max: parsed.max });
      break;
    case "read":
      result = readContext(parsed.path!, { root: parsed.root, mode: parsed.mode, max: parsed.max });
      break;
    case "search":
      result = searchContext(parsed.query!, { root: parsed.root, scope: parsed.scope, max: parsed.max });
      break;
  }

  process.stdout.write(parsed.json ? formatJson(result) : formatMarkdown(result));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Usage:")) {
    process.stderr.write(`${usage()}\n`);
  } else {
    process.stderr.write(`${message}\n`);
  }
  process.exit(1);
});
