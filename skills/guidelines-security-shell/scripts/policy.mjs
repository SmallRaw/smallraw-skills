#!/usr/bin/env node

import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_INPUT_BYTES = 1024 * 1024;
const PRIVILEGE_ESCALATION = new Set(["sudo", "su", "doas"]);
const SHELLS = new Set(["sh", "bash", "zsh", "ksh", "dash", "fish"]);
const PROCESS_SWEEPERS = new Set(["killall", "pkill"]);
// Names worth interrupting a sweep over: the runtime this agent is itself
// running under, the editors and shells holding unsaved buffers, the browser
// the user actually browses in, and the databases behind a running service.
// A headless browser or a dev server the agent started is not on this list —
// killing one costs a restart, which is not what a confirm is for.
const COSTLY_TO_KILL = new Set([
  "node", "deno", "bun", "npm", "yarn", "pnpm",
  "python", "python2", "python3", "ruby", "perl", "php",
  "java", "jvm", "gradle", "kotlin",
  "claude", "codex", "cursor", "code", "electron", "vim", "nvim", "emacs", "nano",
  "zsh", "bash", "fish", "sh", "tmux", "screen", "ssh", "sshd",
  "chrome", "chromium", "safari", "firefox", "edge", "arc",
  "postgres", "postgresql", "mysql", "mysqld", "mariadb", "redis",
  "redis-server", "mongod", "mongodb", "clickhouse", "elasticsearch",
  "docker", "dockerd", "containerd", "colima", "orbstack",
  "finder", "dock", "windowserver", "loginwindow", "launchd", "systemd",
  // Not a process name but a flag every browser process carries, so matching it
  // bare is `pkill -f chrome` by another spelling. With a value after it the
  // pattern points somewhere, and the path test below judges it on that.
  "user-data-dir",
]);
// Naming an automation harness says the match is a driven process, not the
// session a person is working in — a headless browser has no window to lose.
// This wins over the name check above, since the harness usually spells out
// the very runtime that list is guarding.
const AUTOMATION_MARKERS = [
  "headless",
  "puppeteer",
  "playwright",
  "selenium",
  "webdriver",
  "chromedriver",
  "geckodriver",
  "remote-debugging-port",
  "chrome for testing",
];
const DELETERS = new Set(["rm", "unlink"]);
const OWNERSHIP_COMMANDS = new Set(["chmod", "chown", "chgrp"]);
// Deleting or re-permissioning these roots takes out the system or the user's
// whole world; no interactive confirmation makes that reasonable.
const CRITICAL_ROOTS = new Set([
  "/",
  "/applications",
  "/bin",
  "/dev",
  "/etc",
  "/home",
  "/library",
  "/opt",
  "/private",
  "/sbin",
  "/system",
  "/users",
  "/usr",
  "/var",
  "/volumes",
]);
// Fetching and running third-party code is the same risk whatever ecosystem it
// comes from. guidelines-security-npm reviews the npm graph in depth; these have
// no equivalent pipeline, so they get a look rather than a full gate.
const FOREIGN_INSTALLERS = [
  { match: (exe, args) => ["pip", "pip3", "uv"].includes(exe) && args.includes("install") },
  {
    match: (exe, args) =>
      ["python", "python3"].includes(exe) &&
      args.includes("pip") &&
      args.includes("install"),
  },
  { match: (exe, args) => exe === "cargo" && args[0] === "install" },
  { match: (exe, args) => exe === "go" && args[0] === "install" },
  { match: (exe, args) => exe === "gem" && args[0] === "install" },
  {
    match: (exe, args) =>
      exe === "brew" && ["install", "reinstall", "upgrade", "tap"].includes(args[0]),
  },
  {
    match: (exe, args) =>
      ["apt", "apt-get", "dnf", "yum", "pacman", "apk"].includes(exe) &&
      args.some((value) => ["install", "-S", "add"].includes(value)),
  },
];
// Subcommand words that sit between the installer and the package it fetches,
// so the message can name what is actually being downloaded.
const INSTALLER_VERBS = new Set([
  "install",
  "reinstall",
  "upgrade",
  "tap",
  "add",
  "pip",
  "-s",
]);
const DISK_ERASE_VERBS = new Set([
  "erasedisk",
  "erasevolume",
  "partitiondisk",
  "zerodisk",
  "secureerase",
  "resetfusion",
]);

function result(decision, ruleId, reason, nextAction) {
  const value = { decision, ruleId };
  if (reason) value.reason = reason;
  if (nextAction) value.nextAction = nextAction;
  return value;
}

function allow(ruleId = "not-a-destructive-command") {
  return result("allow", ruleId);
}

function confirm(ruleId, reason, nextAction) {
  return result("confirm", ruleId, reason, nextAction);
}

function deny(ruleId, reason, nextAction) {
  return result("deny", ruleId, reason, nextAction);
}

// A substitution runs its own little shell whose quoting is independent of the
// text around it. Read character by character, the apostrophe in
// `"$(grep -c '^"x' f)"` closed the enclosing double quote and left the rest
// dangling, so an ordinary read-only pipeline came back as unclosed. Return the
// index just past the substitution so callers can carry it as one opaque piece.
function skipSubstitution(source, start) {
  if (source[start] === "`") {
    for (let index = start + 1; index < source.length; index += 1) {
      if (source[index] === "\\") index += 1;
      else if (source[index] === "`") return index + 1;
    }
    return -1;
  }
  let depth = 0;
  let quote = "";
  for (let index = start + 2; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === "\\" && quote !== "'") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "\\") index += 1;
    else if (character === "'" || character === '"') quote = character;
    else if (character === "(") depth += 1;
    else if (character === ")") {
      if (depth === 0) return index + 1;
      depth -= 1;
    }
  }
  return -1;
}

function opensSubstitution(source, index, quote) {
  if (quote === "'") return false;
  return source[index] === "`" || (source[index] === "$" && source[index + 1] === "(");
}

function tokenize(segment) {
  const tokens = [];
  let token = "";
  let quote = "";
  let escaped = false;

  for (let index = 0; index < segment.length; index += 1) {
    const character = segment[index];
    if (escaped) {
      token += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (opensSubstitution(segment, index, quote)) {
      const end = skipSubstitution(segment, index);
      if (end === -1) return null;
      token += segment.slice(index, end);
      index = end - 1;
      continue;
    }
    if (quote) {
      if (character === quote) quote = "";
      else token += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (/\s/u.test(character)) {
      if (token) {
        tokens.push(token);
        token = "";
      }
      continue;
    }
    token += character;
  }
  if (escaped || quote) return null;
  if (token) tokens.push(token);
  return tokens;
}

// A heredoc body is data delivered to the receiving command, not shell syntax;
// tokenizing it turned every stray quote inside a script body into an
// "unclosed quote" confirm. Splice bodies out before segmenting. A body under
// an unquoted delimiter may still run `$()` or backticks when the shell
// expands it, so those stay in place for the ambiguity confirm to see; a
// shell fed by heredoc executes its body, but bare shell invocations are
// denied wholesale, so nothing hides there.
function stripHeredocBodies(command) {
  const opener = /<<(-?)(?!<)[ \t]*(?:'([^'\n]+)'|"([^"\n]+)"|([A-Za-z0-9_][\w.-]*))/gu;
  let output = "";
  let cursor = 0;
  let match;
  while ((match = opener.exec(command)) !== null) {
    if (match.index < cursor) continue;
    const literal = match[2] !== undefined || match[3] !== undefined;
    const delimiter = match[2] ?? match[3] ?? match[4];
    const bodyStart = command.indexOf("\n", opener.lastIndex);
    if (bodyStart === -1) continue;
    const terminator = new RegExp(
      `(?:^|\n)${match[1] ? "\t*" : ""}${delimiter.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}[ \t]*(?=\n|$)`,
      "u",
    );
    const tail = command.slice(bodyStart + 1);
    const found = terminator.exec(tail);
    if (!found) continue;
    const body = tail.slice(0, found.index);
    if (!literal && /`|\$\(/u.test(body)) continue;
    output += command.slice(cursor, bodyStart + 1);
    cursor = bodyStart + 1 + found.index + found[0].length;
  }
  return output + command.slice(cursor);
}

// What a substitution contains runs before the command around it does, so it is
// a command in its own right. Carrying it as one opaque token fixed the
// quoting, but on its own it would also stop anything inside from being read —
// the old segmenter used to catch `$(…; sudo …)` by accidentally splitting on
// the separator. Hand the bodies back for their own evaluation instead, which
// reaches every one of them rather than only the ones that happened to split.
function substitutionBodies(command) {
  const bodies = [];
  let quote = "";
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (character === "\\" && quote !== "'") {
      index += 1;
      continue;
    }
    if (opensSubstitution(command, index, quote)) {
      const end = skipSubstitution(command, index);
      if (end !== -1) {
        bodies.push(
          character === "`"
            ? command.slice(index + 1, end - 1)
            : command.slice(index + 2, end - 1),
        );
        index = end - 1;
        continue;
      }
    }
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === "'" || character === '"') quote = character;
  }
  return bodies;
}

function commandSegments(command) {
  const segments = [];
  let segment = "";
  let quote = "";

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (character === "\\" && quote !== "'") {
      // A backslash before a newline is a line continuation: the shell removes
      // both and joins the lines. Keeping it stranded the backslash at the end
      // of a segment whenever the next line opened with `|` or `&&`, and a
      // trailing escape reads as unfinished input — which is how an ordinary
      // multi-line pipeline came back as ambiguous syntax.
      if (command[index + 1] === "\n") {
        index += 1;
        continue;
      }
      segment += character;
      if (index + 1 < command.length) {
        segment += command[index + 1];
        index += 1;
      }
      continue;
    }
    if (opensSubstitution(command, index, quote)) {
      const end = skipSubstitution(command, index);
      if (end !== -1) {
        segment += command.slice(index, end);
        index = end - 1;
        continue;
      }
    }
    if (quote) {
      segment += character;
      if (character === quote) quote = "";
      continue;
    }
    if (character === "'" || character === '"') {
      segment += character;
      quote = character;
      continue;
    }
    // `#` opening a word starts a comment. The prose inside one routinely
    // carries an apostrophe — "Dockerfile's build context", "in case it's
    // readable" — which used to open a quote that never closed.
    if (character === "#" && (index === 0 || /\s/u.test(command[index - 1]))) {
      const newline = command.indexOf("\n", index);
      if (newline === -1) break;
      index = newline - 1;
      continue;
    }
    const pair = command.slice(index, index + 2);
    if (character === "\n" || character === ";" || character === "|" || character === "&") {
      if (segment.trim()) segments.push(segment.trim());
      segment = "";
      if (pair === "||" || pair === "&&") index += 1;
      continue;
    }
    segment += character;
  }
  if (segment.trim()) segments.push(segment.trim());
  return segments;
}

function stripInvocationPrefixes(tokens) {
  let index = 0;
  let changed = true;
  while (changed && index < tokens.length) {
    changed = false;
    if (tokens[index] === "command" || tokens[index] === "nohup" || tokens[index] === "nice" || tokens[index] === "caffeinate") {
      index += 1;
      changed = true;
      continue;
    }
    if (tokens[index] === "timeout" && /^\d/u.test(tokens[index + 1] ?? "")) {
      index += 2;
      changed = true;
      continue;
    }
    if (tokens[index] === "xargs") {
      index += 1;
      while (index < tokens.length && tokens[index].startsWith("-")) index += 1;
      changed = true;
      continue;
    }
    if (tokens[index] === "env") {
      index += 1;
      while (
        index < tokens.length &&
        (tokens[index].startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/u.test(tokens[index]))
      ) {
        index += 1;
      }
      changed = true;
      continue;
    }
    while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/u.test(tokens[index])) {
      index += 1;
      changed = true;
    }
  }
  return tokens.slice(index);
}

// Commands routinely park a path in a variable and use it a few segments
// later — `S=/private/tmp/.../scratchpad; cd $S/work && rm -f ../out.zip`.
// The assignment is right there in literal form, so read it rather than giving
// up on every path that mentions it.
function collectAssignments(tokens, vars) {
  for (const token of tokens) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/su.exec(token);
    if (!match) break;
    if (/\$\(|`/u.test(match[2])) vars.delete(match[1]);
    else vars.set(match[1], expandVariables(match[2], vars));
  }
}

function expandVariables(target, vars) {
  return target.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/gu,
    (whole, braced, bare) => {
      const name = braced ?? bare;
      if (name === "HOME") return os.homedir();
      return vars?.has(name) ? vars.get(name) : whole;
    },
  );
}

function expandHome(target) {
  if (target === "~") return os.homedir();
  if (target.startsWith("~/")) return path.join(os.homedir(), target.slice(2));
  if (target === "$HOME" || target === "${HOME}") return os.homedir();
  if (target.startsWith("$HOME/")) return path.join(os.homedir(), target.slice(6));
  if (target.startsWith("${HOME}/")) return path.join(os.homedir(), target.slice(8));
  return target;
}

function workspaceRootFor(cwd) {
  const base = path.resolve(cwd || process.cwd());
  try {
    return realpathSync(base);
  } catch {
    return base;
  }
}

function isWithin(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isTempPath(resolved) {
  const roots = [os.tmpdir(), "/tmp", "/private/tmp", "/private/var/folders", "/var/folders"];
  return roots.some((root) => {
    if (isWithin(resolved, root)) return true;
    try {
      return isWithin(resolved, realpathSync(root));
    } catch {
      return false;
    }
  });
}

// Anything under one of these belongs to the operating system rather than to a
// workspace, so the leniency given to a file the agent owns does not apply.
const SYSTEM_ROOTS = [
  "/bin",
  "/sbin",
  "/usr",
  "/etc",
  "/var",
  "/dev",
  "/opt",
  "/system",
  "/library",
  "/applications",
  "/private/etc",
  "/private/var",
];

function isSystemPath(resolved) {
  if (typeof resolved !== "string") return false;
  const lowered = resolved.toLowerCase().replace(/\/+$/u, "");
  return SYSTEM_ROOTS.some((root) => lowered === root || lowered.startsWith(`${root}/`));
}

// The host hands the agent a place to keep notes across sessions. Working in it
// is the agent using its own store, which stands with the workspace rather than
// with someone else's repository. What sits next to it does not: the skills,
// settings, and plugin directories hold the rules the agent runs under, and a
// write there is it editing its own guardrails — that keeps asking.
// Most of what sits under the host's own directory is the runtime keeping its
// own state: job scratch, caches, transcripts, shell snapshots, the notes the
// agent keeps between sessions. Writing there is the agent working in the space
// handed to it, and it stands with the workspace rather than with someone
// else's repository. The exception is small and specific — the files that
// decide what the agent is allowed to do. A write there is it editing its own
// guardrails, and that keeps asking however routine it looks.
const AGENT_HOME = /(^|\/)\.(claude|codex)(\/|$)/u;
const AGENT_RULE_SURFACE = [
  /\/settings[^/]*\.json[^/]*$/u,
  /\/keybindings\.json$/u,
  /\/(CLAUDE|AGENTS)\.md$/u,
  /\/mcp[^/]*\.json$/u,
  /\/\.(claude|codex)\/(skills|plugins|hooks|agents|commands|rules)(\/|$)/u,
  /\/statusline-[^/]*$/u,
];

function isAgentStore(resolved) {
  if (!AGENT_HOME.test(resolved)) return false;
  return !AGENT_RULE_SURFACE.some((pattern) => pattern.test(resolved));
}

function isCriticalRoot(resolved) {
  const normalized = resolved.replace(/\/+$/u, "") || "/";
  if (CRITICAL_ROOTS.has(normalized.toLowerCase())) return true;
  const home = path.resolve(os.homedir());
  return normalized === home;
}

// Returns { scope: "critical" | "outside" | "inside" | "unknown", path, why }.
// Paths resolve against wherever the shell currently stands, but inside/outside
// is judged against the workspace the tool call started in.
function classifyTargets(targets, context) {
  if (targets.length === 0) return { scope: "unknown", why: "no-path" };
  let outside = null;
  let unknown = null;
  for (const raw of targets) {
    if (raw === "/*" || raw === "/**") return { scope: "critical", path: raw };
    // A target still carrying a substitution names whatever the shell resolves
    // it to, which is not something this gate gets to see.
    const resolvedVars = expandVariables(raw, context.vars);
    if (/\$|`/u.test(resolvedVars)) {
      unknown ??= { why: "substitution", path: raw };
      continue;
    }
    const expanded = expandHome(resolvedVars);
    if (context.cwd === null && !path.isAbsolute(expanded)) {
      unknown ??= { why: "cwd", path: raw };
      continue;
    }
    const resolved = path.resolve(context.cwd ?? process.cwd(), expanded);
    if (isCriticalRoot(resolved)) return { scope: "critical", path: resolved };
    if (!isWithin(resolved, context.workspace) && !isTempPath(resolved) && !isAgentStore(resolved)) {
      outside ??= { scope: "outside", path: resolved };
    }
  }
  if (outside) return outside;
  if (unknown) return { scope: "unknown", ...unknown };
  return { scope: "inside" };
}

// `cd` moves the shell, and every later relative path in the same command is
// relative to where it landed. Judging them against the tool's own cwd got it
// wrong in both directions: `cd /tmp/x && rm -f ../y` looked like it reached
// outside the workspace, and `cd /etc && rm -rf .` looked like it stayed in.
function nextCwd(segment, current, vars) {
  const tokens = tokenize(segment);
  if (!tokens) return current;
  collectAssignments(tokens, vars);
  const stripped = stripInvocationPrefixes(tokens);
  if (stripped[0] !== "cd" && stripped[0] !== "pushd") return current;
  const raw = stripped.slice(1).find((value) => !value.startsWith("-"));
  if (raw === undefined) return os.homedir();
  const target = expandVariables(raw, vars);
  if (target === "-" || /\$|`|\*|\?/u.test(target)) return null;
  if (current === null) return null;
  return path.resolve(current, expandHome(target));
}

function pathTargets(args) {
  const targets = [];
  let noMoreFlags = false;
  for (const value of args) {
    if (!noMoreFlags && value === "--") {
      noMoreFlags = true;
      continue;
    }
    if (!noMoreFlags && value.startsWith("-")) continue;
    targets.push(value);
  }
  return targets;
}

function evaluateDeletion(executable, args, context) {
  const found = classifyTargets(pathTargets(args), context);
  if (found.scope === "critical") {
    return deny(
      "critical-root-deletion",
      `${executable} 的目标是 ${found.path} 本身，那是系统根目录或你的主目录。`,
      "只删属于自己的确切路径。",
    );
  }
  if (found.scope === "inside") return allow("workspace-deletion");
  if (found.scope === "outside") {
    return confirm("outside-workspace-deletion", `会删掉工作区之外的 ${found.path}。`);
  }
  if (found.why === "substitution") {
    return confirm("unknown-scope-deletion", `${executable} 要删的 ${found.path} 展开后才知道是什么。`);
  }
  if (found.why === "cwd") {
    return confirm("unknown-scope-deletion", `${found.path} 是相对路径，而前面 cd 去了哪读不出来。`);
  }
  return confirm("unknown-scope-deletion", `${executable} 没写明删哪里，范围要到运行时才定。`);
}

function evaluateOwnership(executable, args, context) {
  const positional = pathTargets(args);
  const mode = positional[0] ?? "";
  const found = classifyTargets(positional.slice(1), context);
  if (found.scope === "critical") {
    return deny(
      "critical-root-permission-change",
      `${executable} 会改写 ${found.path} 本身的权限，那是系统根目录或你的主目录。`,
      "只改属于自己的路径。",
    );
  }
  // Location is the wrong axis on its own: `chmod +x build.sh` in a sibling
  // repo costs nothing and undoes itself, while a recursive sweep or a
  // world-writable bit is what actually leaves the tree wrong. Gate by what the
  // change does, and only then by where it reaches.
  const recursive = args.some((value) => value === "-R" || value === "--recursive");
  const octal = /^[0-7]{3,4}$/u.test(mode) ? Number(mode.at(-1)) : null;
  const worldWritable =
    octal === null ? /[ao]\+w|[ao]=[rwx]*w/u.test(mode) : [2, 3, 6, 7].includes(octal);
  // Flipping one file executable is free wherever the file lives — except on the
  // system itself, where a single mode change is enough to lock the machine out
  // of its own passwd file or strip a binary of its setuid bit.
  if (
    !recursive &&
    !worldWritable &&
    executable === "chmod" &&
    found.scope !== "unknown" &&
    !isSystemPath(found.path)
  ) {
    return allow("single-path-permission-change");
  }
  if (found.scope === "inside") return allow("workspace-permission-change");
  if (found.scope === "outside") {
    return confirm(
      "outside-workspace-permission-change",
      recursive
        ? `${executable} -R 会改掉工作区之外 ${found.path} 整棵树的权限。`
        : `会改掉工作区之外的 ${found.path} 的权限或归属。`,
    );
  }
  return confirm("outside-workspace-permission-change", `${executable} 要改谁的权限读不出来。`);
}

// Overwriting a file destroys its contents as completely as deleting it, and
// more quietly, because the file is still there afterwards. Deletion was gated
// and overwriting was not, which left the larger half of "wrote to the wrong
// place" uncovered.
const COPY_VERBS = new Set(["cp", "mv", "rsync", "install", "ln"]);

function redirectTargets(tokens) {
  const targets = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const match = /^\d?>>?\|?(.*)$/u.exec(tokens[index]);
    if (!match) continue;
    // `2>&1` points at a descriptor, and /dev/null is not a file anyone loses.
    let target = match[1];
    if (target.startsWith("&")) continue;
    if (target === "") {
      target = tokens[index + 1] ?? "";
      index += 1;
    }
    if (target && !/^\/dev\//u.test(target)) targets.push(target);
  }
  return targets;
}

function writeTargets(executable, args) {
  if (executable === "tee") return pathTargets(args);
  if (executable === "sed") {
    if (!args.some((value) => value === "-i" || /^-i/u.test(value))) return [];
    // sed -i 'script' file… — the script is positional too, so drop the first.
    return pathTargets(args).slice(1);
  }
  if (executable === "tar") {
    const index = args.indexOf("-C");
    return index >= 0 && args[index + 1] ? [args[index + 1]] : [];
  }
  if (COPY_VERBS.has(executable)) {
    const positional = pathTargets(args);
    return positional.length > 1 ? [positional.at(-1)] : [];
  }
  return [];
}

function evaluateWrite(targets, context) {
  const found = classifyTargets(targets, context);
  if (found.scope === "critical") {
    return deny(
      "critical-root-write",
      `会写进 ${found.path} 本身，那是系统根目录或你的主目录。`,
      "只写属于自己的确切路径。",
    );
  }
  if (found.scope === "outside") {
    return confirm("outside-workspace-write", `会覆盖工作区之外的 ${found.path}。`);
  }
  return null;
}

function evaluateSegment(segment, context) {
  const rawTokens = tokenize(segment);
  if (!rawTokens) {
    return confirm(
      "ambiguous-shell-syntax",
      "命令里有未闭合的引号，看不出它要做什么。",
      "简化或拆开后重发。",
    );
  }
  const tokens = stripInvocationPrefixes(rawTokens);
  if (tokens.length === 0) return allow();

  const executable = tokens[0].split("/").at(-1).toLowerCase();
  const args = tokens.slice(1);

  if (PRIVILEGE_ESCALATION.has(executable)) {
    return deny(
      "privilege-escalation",
      `${executable} 会提权执行，超出授权范围。`,
      "需要提权请说明，由用户执行。",
    );
  }
  if (executable === "shred") {
    return deny(
      "data-destruction",
      "shred 会不可恢复地销毁文件内容。",
      "要删就用普通 rm 删确切路径。",
    );
  }
  if (executable === "mkfs" || executable.startsWith("mkfs.")) {
    return deny(
      "disk-destruction",
      "mkfs 会重新格式化设备并销毁其中所有内容。",
      "绝不格式化设备；说明需求后停下。",
    );
  }
  if (executable === "dd") {
    const output = args.find((value) => /^of=/iu.test(value));
    // Without an output file dd only reads; with one inside the workspace it is
    // an ordinary file write, the same as any redirect.
    if (output === undefined) return allow("read-only-raw-copy");
    const target = output.slice(3);
    if (/^\/dev\//iu.test(target)) {
      return deny(
        "disk-destruction",
        `dd 写入块设备 ${target} 会销毁设备上的内容。`,
        "绝不写入块设备；说明需求后停下。",
      );
    }
    const found = classifyTargets([target], context);
    if (found.scope === "critical") {
      return deny("disk-destruction", `dd 会直接覆盖 ${found.path} 本身。`, "只写属于自己的确切路径。");
    }
    if (found.scope === "inside") return allow("workspace-raw-copy");
    return confirm("raw-copy", `dd 会整块覆盖 ${found.path ?? target}，原内容不留备份。`);
  }
  if (executable === "diskutil") {
    const verb = (args.find((value) => !value.startsWith("-")) ?? "").toLowerCase();
    if (["list", "info", "activity"].includes(verb) || verb === "") {
      return allow("read-only-diskutil");
    }
    if (DISK_ERASE_VERBS.has(verb) || (verb === "apfs" && /delete/iu.test(args.join(" ")))) {
      return deny(
        "disk-destruction",
        `diskutil ${verb} 会抹除存储或重新分区。`,
        "绝不抹除或重新分区磁盘；说明需求后停下。",
      );
    }
    return confirm(
      "disk-state-change",
      `diskutil ${verb} 会改变磁盘或卷的状态。`,
      "确认设备和操作。",
    );
  }
  if (FOREIGN_INSTALLERS.some((entry) => entry.match(executable, args))) {
    const named = args.filter(
      (value) => !value.startsWith("-") && !INSTALLER_VERBS.has(value.toLowerCase()),
    );
    const naming = named.slice(0, 3).join("、") || "第三方";
    // pip has the same lever npm has. A wheel is data that gets unpacked; only a
    // source distribution runs its setup.py while installing, which is the
    // moment the package gets to look around the machine. Name the spelling
    // that closes it instead of asking for a judgement a package name cannot
    // support. cargo, gem, and brew have no equivalent, so they keep the ask.
    const isPip =
      ["pip", "pip3"].includes(executable) ||
      (["python", "python3", "uv"].includes(executable) && args.includes("pip"));
    if (isPip && !args.some((value) => /^--only-binary(?:=|$)/u.test(value))) {
      return deny(
        "install-runs-package-code",
        `安装 ${naming} 时会执行它自带的 setup.py，那段代码能读到这台机器上的东西。`,
        "加 --only-binary=:all: 重发；只装 wheel 就不会执行安装脚本。",
      );
    }
    return confirm(
      "foreign-package-install",
      `${executable} 会下载 ${naming}，这里没有 npm 那套审查流程。`,
    );
  }
  if (DELETERS.has(executable)) return evaluateDeletion(executable, args, context);
  if (OWNERSHIP_COMMANDS.has(executable)) return evaluateOwnership(executable, args, context);
  // find walks a tree and can delete every match, which is a deletion whose
  // scope is the roots it was pointed at.
  if (executable === "find") {
    const deletes =
      args.includes("-delete") ||
      args.some(
        (value, index) =>
          ["-exec", "-execdir", "-ok", "-okdir"].includes(value) &&
          DELETERS.has((args[index + 1] ?? "").split("/").at(-1)),
      );
    if (!deletes) return allow();
    const firstPredicate = args.findIndex((value) => value.startsWith("-"));
    const roots = firstPredicate === -1 ? args : args.slice(0, firstPredicate);
    return evaluateDeletion("find", roots.length > 0 ? roots : ["."], context);
  }
  if (PROCESS_SWEEPERS.has(executable)) {
    const patterns = args.filter(
      (value) => !value.startsWith("-") && !/[<>]/u.test(value),
    );
    // Killing a process the agent started costs a restart, not work — the gate
    // is for the patterns that reach something whose death loses what is not
    // on disk yet. A path-shaped pattern is judged by where it points, since
    // /usr/bin/node is every process using the system interpreter. Everything
    // else is judged by whether it names a runtime, editor, browser, or
    // database rather than an application the agent launched.
    const risky = patterns.find((value) => {
      const lowered = value.toLowerCase();
      if (AUTOMATION_MARKERS.some((marker) => lowered.includes(marker))) return false;
      // A pattern carrying a path is judged by where that path points, before
      // any name in it is weighed: `user-data-dir=/var/folders/…` names one
      // profile, while a bare `user-data-dir` names every browser on the box.
      if (value.includes("/")) {
        // In `user-data-dir=/var/folders/…` the path is the value, not the
        // whole token; resolving the token as one relative path put it wherever
        // a preceding `cd` happened to leave the shell.
        const written = value.includes("=") ? value.slice(value.indexOf("=") + 1) : value;
        const expanded = expandHome(expandVariables(written, context.vars));
        if (/\$|`/u.test(expanded)) return true;
        const resolved = path.resolve(context.cwd ?? process.cwd(), expanded);
        return !isWithin(resolved, context.workspace) && !isTempPath(resolved);
      }
      // Naming a runtime, editor, browser, or database reaches the user's own
      // work however specific the rest of the pattern looks.
      if (
        value
          .split(/[^A-Za-z0-9_.+-]+/u)
          .some((word) => COSTLY_TO_KILL.has(word.toLowerCase()))
      ) {
        return true;
      }
      // A bare word is a substring match against every command line on the
      // machine; a script name, port, or flag fragment names one process.
      return !/[._=-]/u.test(value) && !/\d{3}/u.test(value);
    });
    if (patterns.length > 0 && risky === undefined) return allow("specific-process-match");
    return confirm(
      "process-sweep",
      risky
        ? `会杀掉机器上每一个匹配 ${risky} 的进程，包括你自己在跑的。`
        : `${executable} 没写匹配模式，会扫到什么不确定。`,
    );
  }
  if (executable === "docker" || executable === "podman") {
    const verbs = args.filter((value) => !value.startsWith("-")).map((value) => value.toLowerCase());
    const wipesVolumes = args.some((value) => value === "-v" || value === "--volumes");
    // A volume is the only one of the three that holds data nothing else has a
    // copy of. `docker rm` drops a writable layer that a rerun recreates, and an
    // image rebuilds from its Dockerfile — gating those turned every smoke-test
    // cleanup into a prompt for something that costs a rebuild.
    if (
      (verbs[0] === "volume" && ["rm", "remove", "prune"].includes(verbs[1])) ||
      (wipesVolumes && ["rm", "remove", "prune", "system", "container"].includes(verbs[0]))
    ) {
      return confirm("volume-destruction", `${executable} 会删掉数据卷里的内容，那份数据没有别的副本。`);
    }
    // `docker rm $(docker ps -aq)` names nothing: it reaches every container on
    // the machine, including whatever the user has running. A named target is
    // the agent's own test container; a substitution is a sweep.
    if (
      ["rm", "rmi", "remove"].includes(verbs[0]) ||
      (["container", "image"].includes(verbs[0]) && ["rm", "remove"].includes(verbs[1]))
    ) {
      const targets = args.filter((value) => !value.startsWith("-"));
      if (targets.some((value) => /\$\(|`|\$\{?[A-Za-z_]/u.test(value))) {
        return confirm(
          "container-sweep",
          `${executable} ${verbs[0]} 的目标是展开出来的一串 id，会波及机器上所有匹配的容器或镜像。`,
        );
      }
    }
    if (verbs[0] === "system" && ["prune", "reset"].includes(verbs[1])) {
      return confirm(
        "container-sweep",
        `${executable} system ${verbs[1]} 会清掉机器上所有停止的容器和悬空镜像，不只是这个项目的。`,
      );
    }
    return allow();
  }
  if (executable === "twine" && (args[0] ?? "").toLowerCase() === "upload") {
    return confirm(
      "package-publish",
      "twine upload 会把包发布到外部 registry。",
      "确认包名、版本和 registry。",
    );
  }
  if (executable === "eval") {
    return deny(
      "shell-indirection",
      "eval 里的内容没法审查。",
      "直接执行内层命令。",
    );
  }
  if (SHELLS.has(executable)) {
    if (args.length === 0 || args.includes("-c") || args.includes("-i")) {
      return deny(
        "shell-indirection",
        `${executable} ${args.includes("-c") ? "-c 里的命令没法审查" : "交互式 shell 没法审查"}。`,
        "直接执行内层命令。",
      );
    }
    return allow("script-execution");
  }

  const written = evaluateWrite(
    [...redirectTargets(tokens), ...writeTargets(executable, args)],
    context,
  );
  return written ?? allow();
}

const MAX_SUBSTITUTION_DEPTH = 3;

export function evaluateCommand(command, cwd, depth = 0) {
  if (typeof command !== "string" || command.trim() === "") {
    return deny(
      "invalid-command-input",
      "Shell 命令缺失或格式错误。",
      "提供规范化的命令。",
    );
  }

  const workspace = workspaceRootFor(cwd);
  const vars = new Map();
  const stripped = stripHeredocBodies(command);
  let current = cwd || process.cwd();
  let strongest = allow();
  for (const segment of commandSegments(stripped)) {
    const value = evaluateSegment(segment, { cwd: current, workspace, vars });
    if (value.decision === "deny") return value;
    if (value.decision === "confirm") strongest = value;
    else if (strongest.decision === "allow") strongest = value;
    current = nextCwd(segment, current, vars);
  }
  if (depth < MAX_SUBSTITUTION_DEPTH) {
    for (const body of substitutionBodies(stripped)) {
      const value = evaluateCommand(body, cwd, depth + 1);
      if (value.decision === "deny") return value;
      if (value.decision === "confirm" && strongest.decision === "allow") strongest = value;
    }
  }
  return strongest;
}

function normalizeInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  if (input.kind === "command") {
    return { command: input.target ?? input.command ?? null, cwd: input.cwd };
  }

  const toolName = String(input.tool_name ?? input.tool ?? "").toLowerCase();
  const toolInput = input.tool_input ?? input.input ?? input.args ?? {};
  const cwd = input.cwd ?? toolInput.cwd ?? toolInput.workdir;
  if (toolName === "bash" || toolName === "exec_command") {
    return { command: toolInput.command ?? toolInput.cmd ?? null, cwd };
  }
  return undefined;
}

export function evaluatePolicy(input) {
  try {
    const normalized = normalizeInput(input);
    if (normalized === undefined) return allow("tool-not-covered");
    if (normalized === null || normalized.command === null) {
      return deny(
        "invalid-policy-input",
        "策略输入必须包含规范化的 shell 命令。",
        "提供工具名和命令。",
      );
    }
    return evaluateCommand(normalized.command, normalized.cwd);
  } catch {
    return deny(
      "policy-evaluation-error",
      "Shell 策略无法安全地判定该操作。",
      "在执行破坏性操作前停下，手动检查规范化后的命令。",
    );
  }
}

async function main() {
  if (process.argv.includes("--help")) {
    process.stdout.write(
      "Read one normalized tool-call JSON object from stdin and emit allow/confirm/deny JSON. Deny exits 2; confirm exits 1.\n",
    );
    return;
  }

  let raw = "";
  for await (const chunk of process.stdin) {
    raw += chunk;
    if (Buffer.byteLength(raw) > MAX_INPUT_BYTES) {
      const value = deny(
        "policy-input-too-large",
        "Shell 策略的输入超过大小限制。",
        "只传入规范化的工具调用。",
      );
      process.stdout.write(`${JSON.stringify(value)}\n`);
      process.exitCode = 2;
      return;
    }
  }

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    const value = deny(
      "invalid-policy-json",
      "Shell 策略的输入不是合法 JSON。",
      "传入一个规范化的工具调用 JSON 对象。",
    );
    process.stdout.write(`${JSON.stringify(value)}\n`);
    process.exitCode = 2;
    return;
  }

  const value = evaluatePolicy(input);
  process.stdout.write(`${JSON.stringify(value)}\n`);
  process.exitCode = value.decision === "allow" ? 0 : value.decision === "confirm" ? 1 : 2;
}

// Node resolves symlinks when loading a module, so import.meta.url is the real
// path while argv[1] is whatever the caller typed. Comparing them directly makes
// the gate silently do nothing when invoked through a symlinked skill directory —
// exit 0, no verdict, which reads as "allowed". Compare resolved paths instead.
function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(import.meta.url);
  if (entry === self) return true;
  try {
    return realpathSync(entry) === realpathSync(self);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main();
}
