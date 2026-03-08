import { printContent } from "../core/client.js";
import type { ContentItem } from "../types.js";
import type { DaemonClient } from "../daemon/client.js";
import { USAGE } from "../cli/usage.js";
import { parseJsonArg } from "../cli/args.js";

export async function runCommandViaDaemon(daemon: DaemonClient, serverName: string, commandArgs: string[]): Promise<void> {
  if (!commandArgs.length) { console.log(USAGE); process.exit(0); }
  const command = commandArgs[0];
  let result: unknown;
  switch (command) {
    case "info":
      result = await daemon.invoke("serverInfo", { server: serverName });
      break;
    case "tools":
      result = await daemon.invoke("listTools", { server: serverName });
      break;
    case "call": {
      const name = commandArgs[1];
      if (!name) { console.error("Usage: call <tool-name> [json-args]"); process.exit(1); }
      const args = parseJsonArg(commandArgs[2]);
      const callResult = await daemon.invoke("callTool", { server: serverName, name, args }) as {
        isError?: boolean;
        content?: ContentItem[];
      };
      if (callResult?.isError) {
        const msg = callResult.content?.[0]?.text ?? "Unknown error";
        console.error(`Tool error: ${msg}`);
        process.exit(1);
      }
      if (callResult?.content) { printContent(callResult.content); }
      return;
    }
    case "resources":
      result = await daemon.invoke("listResources", { server: serverName });
      break;
    case "templates":
      result = await daemon.invoke("listResourceTemplates", { server: serverName });
      break;
    case "read": {
      const uri = commandArgs[1];
      if (!uri) { console.error("Usage: read <resource-uri>"); process.exit(1); }
      result = await daemon.invoke("readResource", { server: serverName, uri });
      break;
    }
    case "prompts":
      result = await daemon.invoke("listPrompts", { server: serverName });
      break;
    case "prompt": {
      const name = commandArgs[1];
      if (!name) { console.error("Usage: prompt <name> [json-args]"); process.exit(1); }
      const args = parseJsonArg(commandArgs[2]);
      result = await daemon.invoke("getPrompt", { server: serverName, name, args });
      break;
    }
    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
  console.log(JSON.stringify(result, null, 2));
}
