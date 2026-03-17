/**
 * github-kb 共享工具模块
 * 封装 gh CLI 调用、文件输出等通用操作，跨平台兼容
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const DEFAULT_OUTPUT_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || ".",
  "docs",
  "github-article"
);

/**
 * 执行 gh CLI 命令
 * @param {string} args - gh 命令参数
 * @param {object} opts
 * @param {boolean} opts.json - 是否解析为 JSON
 * @returns {string|object|null}
 */
function gh(args, { json = false } = {}) {
  try {
    const output = execSync(`gh ${args}`, {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return json ? JSON.parse(output) : output;
  } catch {
    return json ? null : "";
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeArticle(filePath, content) {
  fs.writeFileSync(filePath, content, "utf-8");
  console.log(`==> Saved: ${filePath}`);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function safeName(str) {
  return str
    .replace(/\//g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .toLowerCase()
    .slice(0, 80);
}

/**
 * 前置检查：gh 已安装且有活跃的认证账号
 * gh auth status 在有失效账号时也会返回非零退出码，所以检查输出内容而非退出码
 */
function preflight() {
  try {
    execSync("gh --version", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
  } catch {
    console.error("Error: gh CLI not found.\n  Install: https://cli.github.com");
    process.exit(1);
  }
  try {
    const output = execSync("gh auth status 2>&1", {
      encoding: "utf-8",
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (!output.includes("Logged in")) {
      throw new Error("not logged in");
    }
  } catch (e) {
    // gh auth status 可能返回非零退出码但仍有活跃账号（比如有多个账号其中一个失效）
    const stderr = e.stderr || e.stdout || "";
    if (!stderr.includes("Logged in")) {
      console.error("Error: gh not authenticated.\n  Run: gh auth login");
      process.exit(1);
    }
  }
}

module.exports = { gh, ensureDir, writeArticle, today, safeName, preflight, DEFAULT_OUTPUT_DIR };
