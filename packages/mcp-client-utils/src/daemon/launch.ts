import { spawn } from "child_process";
import { resolve } from "path";

export function launchDaemonDetached(
  registryPath: string,
  socketPath: string,
  metadataPath: string
): void {
  const cliEntry = resolve(process.argv[1]);
  const args = [
    ...process.execArgv,
    cliEntry,
    "daemon",
    "start",
    "--foreground",
    "--registry-path", registryPath,
    "--socket-path", socketPath,
    "--metadata-path", metadataPath,
  ];
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: "ignore",
    env: { ...process.env },
  });
  child.unref();
}
