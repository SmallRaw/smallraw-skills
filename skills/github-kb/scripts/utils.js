/**
 * github-kb 共享工具模块
 * 封装 gh CLI 调用、文件输出等通用操作，跨平台兼容
 */

const { execFileSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DEFAULT_OUTPUT_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || ".",
  "docs",
  "github-article"
);

/**
 * 执行 gh CLI 命令
 * @param {string[]} args - gh argv，不经过 shell
 * @param {object} opts
 * @param {boolean} opts.json - 是否解析为 JSON
 * @returns {string|object|null}
 */
function gh(args, { json = false } = {}) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
    throw new TypeError("gh args must be an array of strings");
  }

  try {
    const output = execFileSync("gh", args, {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (!json) return output;
    if (!output) throw new Error("gh returned empty JSON output");
    return JSON.parse(output);
  } catch (error) {
    const stderr = String(error.stderr || "").trim();
    const stdout = String(error.stdout || "").trim();
    const details = stderr || stdout || error.message;
    const command = ["gh", ...args].map((part) => JSON.stringify(part)).join(" ");
    const wrapped = new Error(`${command} failed: ${details}`);
    wrapped.name = "GitHubCliError";
    wrapped.exitCode = error.status ?? null;
    wrapped.args = args;
    throw wrapped;
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeArticle(filePath, content) {
  const existed = fs.existsSync(filePath);
  fs.writeFileSync(filePath, content, "utf-8");
  console.log(`==> ${existed ? "Updated" : "Saved"}: ${filePath}`);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function nowIso() {
  return new Date().toISOString();
}

function yamlString(value) {
  return JSON.stringify(String(value));
}

function safeName(str) {
  const normalized = String(str).normalize("NFKC").trim().toLowerCase();
  const hash = crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 8);
  const readable = normalized
    .replace(/[\/\\]+/g, "-")
    .replace(/[\u0000-\u001f<>:"|?*]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .toLowerCase()
    .slice(0, 48);
  return `${readable || "item"}-${hash}`;
}

function validateRepo(repo) {
  if (typeof repo !== "string") throw new TypeError("repo must be a string");
  const parts = repo.split("/");
  const owner = parts[0] || "";
  const name = parts[1] || "";
  const validOwner = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner);
  const validName = /^[A-Za-z0-9._-]+$/.test(name);
  if (parts.length !== 2 || !validOwner || !validName) {
    throw new Error(`Invalid GitHub repository: ${repo}. Expected owner/repo.`);
  }
  return repo;
}

function validatePositiveInteger(value, label = "number") {
  const text = String(value);
  if (!/^[1-9]\d*$/.test(text)) {
    throw new Error(`Invalid ${label}: ${value}. Expected a positive integer.`);
  }
  return text;
}

/**
 * 前置检查：gh 已安装且有活跃的认证账号
 * gh auth status 在有失效账号时也会返回非零退出码，所以检查输出内容而非退出码
 */
function preflight() {
  try {
    execFileSync("gh", ["--version"], { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
  } catch {
    console.error("Error: gh CLI not found.\n  Install: https://cli.github.com");
    process.exit(1);
  }
  try {
    const output = execFileSync("gh", ["auth", "status"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (!output.includes("Logged in")) {
      throw new Error("not logged in");
    }
  } catch (e) {
    // gh auth status 可能返回非零退出码但仍有活跃账号（比如有多个账号其中一个失效）
    const combined = `${e.stdout || ""}\n${e.stderr || ""}`;
    if (!combined.includes("Logged in")) {
      console.error("Error: gh not authenticated.\n  Run: gh auth login");
      process.exit(1);
    }
  }
}

module.exports = {
  gh,
  ensureDir,
  writeArticle,
  today,
  nowIso,
  yamlString,
  safeName,
  validateRepo,
  validatePositiveInteger,
  preflight,
  DEFAULT_OUTPUT_DIR,
};
