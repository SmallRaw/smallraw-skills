import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { configPaths, makeProfileStore } from "./provider-config.mjs";

const launcher = fileURLToPath(new URL("./codex-delegate-worker.mjs", import.meta.url));

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function windowsQuote(value) {
  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, "$1$1")}"`;
}

function findExecutable(command) {
  return (process.env.PATH || "").split(path.delimiter).map((directory) => path.join(directory, command)).find((file) => {
    try { fs.accessSync(file, fs.constants.X_OK); return true; } catch { return false; }
  });
}

export function terminalLaunchSpec({ platform = process.platform, cwd = process.cwd(), scope, node = process.execPath, script = launcher, globalConfig = configPaths().global, find = findExecutable, action = "configure", nativeArgs = [] } = {}) {
  const commandArgs = [script, action === "native" ? "_native-terminal" : "configure", "--directory", cwd, "--global-config", globalConfig,
    ...(action === "native" ? ["--", ...nativeArgs] : scope ? [`--${scope}`] : [])];
  if (platform === "darwin") {
    const command = [node, ...commandArgs].map(shellQuote).join(" ");
    const literal = `"${command.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n").replaceAll("\r", "\\r")}"`;
    return { command: "/usr/bin/osascript", args: ["-e", `tell application "Terminal"\ndo script ${literal}\nactivate\nend tell`], wait: true };
  }
  if (platform === "win32") {
    const quote = (value) => `'${value.replaceAll("'", "''")}'`;
    const argumentLine = commandArgs.map(windowsQuote).join(" ");
    const scriptText = `$ErrorActionPreference='Stop'; Start-Process -FilePath ${quote(node)} -ArgumentList ${quote(argumentLine)}`;
    return { command: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(scriptText, "utf16le").toString("base64")], wait: true };
  }
  for (const [terminal, separator] of [["x-terminal-emulator", "-e"], ["gnome-terminal", "--"], ["konsole", "-e"], ["xterm", "-e"]]) {
    const executable = find(terminal);
    if (executable) return { command: executable, args: [separator, node, ...commandArgs], wait: false };
  }
  throw new Error(`No desktop terminal was found. Run ${action === "native" ? "interactive" : "configure"} in your own terminal.`);
}

export async function openConfiguration(options = {}) {
  const spec = terminalLaunchSpec(options);
  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, { stdio: "ignore", detached: true, windowsHide: true });
    child.once("error", () => reject(new Error("Could not open a private configuration terminal.")));
    if (spec.wait) {
      child.once("close", (code) => code === 0 ? resolve() : reject(new Error("Could not open a private configuration terminal. Allow the terminal application to open, or run configure in your own terminal.")));
    } else {
      child.once("spawn", () => { child.unref(); resolve(); });
    }
  });
}

export function normalizeBaseUrl(value) {
  let url;
  try { url = new URL(value.includes("://") ? value : `https://${value}`); } catch { throw new Error("请输入有效的服务地址。"); }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname) throw new Error("请输入 HTTP 或 HTTPS 服务地址。");
  return url.href.replace(/\/$/, "");
}

export async function runConfiguration({ ask, write, store = makeProfileStore(), scope: initialScope } = {}) {
  let scope = initialScope;
  const chooseScope = async () => (await ask("保存范围：1 Global（所有项目，默认）  2 Local（当前目录）：")).trim() === "2" ? "local" : "global";
  async function select(document) {
    const value = Number(await ask("选择节点编号："));
    return Number.isInteger(value) && value >= 1 && value <= document.providers.length ? document.providers[value - 1].name : null;
  }
  async function required(label, previous = "") {
    while (true) {
      const answer = (await ask(label)).trim();
      if (answer || previous) return answer || previous;
      write("此项不能为空。\n");
    }
  }
  write("Codex Worker 配置。输入仅留在此终端，Key 不回显。\n");
  while (true) {
    if (!scope) scope = await chooseScope();
    try {
      store.migrate(scope);
      const document = store.read(scope);
      write(`\n${scope === "local" ? "Local（当前目录）" : "Global（所有项目）"}\n`);
      document.providers.forEach((provider, index) => write(`${index + 1}. ${provider.name}${provider.name === document.defaultProvider ? " [默认]" : ""}\n`));
      if (!document.providers.length) write("尚未添加节点。\n");
      const action = (await ask("\n1 添加  2 编辑  3 删除  4 设为默认  5 切换范围  0 退出：")).trim();
      if (action === "0") return;
      if (action === "5") { scope = null; continue; }
      if (!["1", "2", "3", "4"].includes(action)) continue;
      const name = action === "1" ? await required("节点别名：") : await select(document);
      if (!name) { write("未选择有效节点。\n"); continue; }
      const existing = document.providers.some((provider) => provider.name === name);
      if (action === "1" && existing) { write("别名已存在，请选择编辑。\n"); continue; }
      if (action === "3") {
        if ((await ask("确认删除此节点和保存的凭据？[y/N]：")).trim().toLowerCase() === "y") {
          store.remove(scope, name);
          write("已删除。\n");
        }
        continue;
      }
      if (action === "4") { store.use(scope, name); write("已设为默认。\n"); continue; }
      const previous = action === "2" ? store.get(scope, name) : {};
      let baseUrl;
      while (!baseUrl) {
        try { baseUrl = normalizeBaseUrl(await required(`服务地址${previous.baseUrl ? "（留空保留）" : "（包含 /v1 等实际 API 路径）"}：`, previous.baseUrl)); }
        catch (error) { write(`${error.message}\n`); }
      }
      const model = await required(`模型名称${previous.model ? "（留空保留）" : ""}：`, previous.model);
      let authentication = {};
      const keepAuth = action === "2" && (await ask("认证：1 保留现有（默认）  2 更换 Key  3 无需认证：")).trim();
      if (action === "2" && keepAuth !== "2" && keepAuth !== "3") {
        authentication = { apiKey: previous.apiKey, auth: previous.auth, authCommand: previous.authCommand, authArgs: previous.authArgs };
      } else if (keepAuth !== "3") {
        const apiKey = await ask("API Key（不回显；留空表示无需认证）：", { secret: true });
        if (apiKey) authentication.apiKey = apiKey;
      }
      const { apiKey: _key, auth: _auth, authCommand: _command, authArgs: _args, configMode: _mode, keepHome: _keep, ...settings } = previous;
      store.put(scope, name, { ...settings, baseUrl, model, ...authentication });
      write("已保存到本机私有配置文件。\n");
    } catch (error) {
      write(`${error.message}\n`);
      if ((await ask("按 Enter 重试，输入 0 退出：")).trim() === "0") return;
    }
  }
}

export async function configureInTerminal(options = {}) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Configuration needs your own interactive terminal. Use init to open one.");
  }
  let muted = false;
  const output = new Writable({ write(chunk, _encoding, callback) { if (!muted) process.stdout.write(chunk); callback(); } });
  output.isTTY = true;
  output.columns = process.stdout.columns;
  const interface_ = readline.createInterface({ input: process.stdin, output, terminal: true, historySize: 0 });
  const onInterrupt = () => interface_.close();
  interface_.on("SIGINT", onInterrupt);
  try {
    await runConfiguration({
      ...options,
      write: (text) => process.stdout.write(text),
      ask: async (label, { secret = false } = {}) => {
        if (!secret) return interface_.question(label);
        process.stdout.write(label);
        muted = true;
        try { return await interface_.question(""); }
        finally { muted = false; process.stdout.write("\n"); }
      },
    });
  } finally {
    interface_.close();
  }
}
