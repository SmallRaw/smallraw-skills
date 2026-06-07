import type { McpClient } from "../core/client.js";
import { USAGE } from "../cli/usage.js";
import { parseJsonArg } from "../cli/args.js";

export async function runCommand(client: McpClient, commandArgs: string[], serverName?: string): Promise<void> {
  if (!commandArgs.length) {
    console.log(USAGE);
    process.exit(0);
  }

  const command = commandArgs[0];

  switch (command) {
    case "info":
      await client.serverInfo();
      break;

    case "tools":
      await client.listTools({ compact: commandArgs.includes("--compact"), serverName });
      break;

    case "call": {
      const name = commandArgs[1];
      if (!name) {
        await client.printToolCallGuide(serverName);
        process.exit(1);
      }
      if (commandArgs[2] === "--help" || commandArgs[2] === "-h") {
        const found = await client.printSingleToolGuide(name, serverName);
        if (!found) {
          console.error(`Tool not found: ${name}`);
          await client.printToolCallGuide(serverName);
          process.exit(1);
        }
        return;
      }
      await client.callTool(name, parseJsonArg(commandArgs[2]));
      break;
    }

    case "resources":
      await client.listResources();
      break;

    case "templates":
      await client.listResourceTemplates();
      break;

    case "read": {
      const uri = commandArgs[1];
      if (!uri) { console.error("Usage: read <resource-uri>"); process.exit(1); }
      await client.readResource(uri);
      break;
    }

    case "prompts":
      await client.listPrompts();
      break;

    case "prompt": {
      const name = commandArgs[1];
      if (!name) { console.error("Usage: prompt <name> [json-args]"); process.exit(1); }
      await client.getPrompt(name, parseJsonArg(commandArgs[2]) as Record<string, string>);
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error(USAGE);
      process.exit(1);
  }
}
