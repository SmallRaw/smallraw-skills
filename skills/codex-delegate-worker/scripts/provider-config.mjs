import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SERVICE = "smallraw.codex-delegate-worker";

export function configPaths({ cwd = process.cwd(), env = process.env } = {}) {
  return {
    global: path.join(env.CODEX_HOME || path.join(os.homedir(), ".codex"), "codex-delegate-worker.json"),
    local: path.join(cwd, ".codex-delegate-worker.json"),
    explicit: env.CODEX_DELEGATE_WORKER_CONFIG_FILE || "",
  };
}

export function readConfig(file) {
  if (!file || !fs.existsSync(file)) return {};
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new Error("Worker configuration could not be read. Open init to repair it.");
  }
}

export function asProfiles(document) {
  if (Array.isArray(document.providers)) return document;
  if (!Object.keys(document).length) return { version: 1, providers: [], defaultProvider: null };
  return { version: 1, providers: [{ name: "default", config: document }], defaultProvider: "default" };
}

export function saveProfiles(file, document) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

export function createVault({ directory = path.join(path.dirname(configPaths().global), "codex-delegate-worker-providers"), platform = process.platform, run = spawnSync } = {}) {
  const filePath = (credential) => path.join(directory, `${encodeURIComponent(String(credential.id))}.json`);
  function execute(command, args, input) {
    const result = run(command, args, { input, encoding: "utf8", windowsHide: true });
    if (result.error || result.status !== 0) {
      throw new Error("System credential storage is unavailable or locked. Unlock it and use init again.");
    }
    return result.stdout.trim();
  }
  function powershell(script, input) {
    return execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], input);
  }
  return {
    write(config) {
      const payload = JSON.stringify(config);
      const id = randomUUID();
      const credential = { type: "file", id };
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      fs.writeFileSync(filePath(credential), payload, { mode: 0o600, flag: "wx" });
      return credential;
    },
    read(credential) {
      let payload;
      if (credential.type === "file") {
        try { payload = fs.readFileSync(filePath(credential), "utf8"); }
        catch { throw new Error("Saved provider details are unavailable. Open init to replace the node."); }
      } else if (credential.type === "keychain" && platform === "darwin") {
        payload = execute("security", ["find-generic-password", "-a", credential.id, "-s", SERVICE, "-w"]);
      } else if (credential.type === "dpapi" && platform === "win32") {
        payload = powershell("$ErrorActionPreference='Stop'; [Console]::InputEncoding=[Text.Encoding]::UTF8; [Console]::OutputEncoding=[Text.Encoding]::UTF8; Add-Type -AssemblyName System.Security; $v=[Convert]::FromBase64String([Console]::In.ReadToEnd()); [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($v,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))", credential.data);
      } else if (credential.type === "secret-service" && platform === "linux") {
        payload = execute("secret-tool", ["lookup", "application", SERVICE, "id", credential.id]);
      } else {
        throw new Error("This worker credential belongs to another operating system. Configure it with init on this computer.");
      }
      try {
        const config = JSON.parse(payload);
        if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error();
        return config;
      } catch {
        throw new Error("Stored worker configuration is invalid. Replace it with init.");
      }
    },
    remove(credential) {
      if (credential.type === "file") {
        fs.rmSync(filePath(credential), { force: true });
      } else if (credential.type === "keychain" && platform === "darwin") {
        execute("security", ["delete-generic-password", "-a", credential.id, "-s", SERVICE]);
      } else if (credential.type === "secret-service" && platform === "linux") {
        execute("secret-tool", ["clear", "application", SERVICE, "id", credential.id]);
      } else if (credential.type !== "dpapi" || platform !== "win32") {
        throw new Error("This worker credential belongs to another operating system.");
      }
    },
  };
}

export function selectProvider(documents) {
  const registry = new Map();
  let selected = null;
  for (const document of documents) {
    const normalized = asProfiles(document);
    for (const provider of normalized.providers) registry.set(provider.name, provider);
    if (normalized.defaultProvider) selected = normalized.defaultProvider;
  }
  return selected ? registry.get(selected) : undefined;
}

export function loadWorkerConfig({ paths = configPaths(), vault = createVault({ directory: path.join(path.dirname(paths.global), "codex-delegate-worker-providers") }) } = {}) {
  const documents = [paths.global, paths.local, paths.explicit].map(readConfig);
  // Retain the existing flat-config precedence for earlier installations.
  if (!documents.some((document) => Array.isArray(document.providers))) {
    return Object.assign({}, ...documents);
  }
  const namedDocuments = documents.map((document) => Array.isArray(document.providers) ? document : {});
  const provider = selectProvider(namedDocuments);
  let config = provider ? (provider.credential ? vault.read(provider.credential) : provider.config) : {};
  const selectedLayer = namedDocuments.reduce((selected, document, index) => document.defaultProvider ? index : selected, -1);
  // Legacy partial local/explicit overrides keep their previous precedence.
  for (let index = Math.max(0, selectedLayer); index < documents.length; index += 1) {
    if (!Array.isArray(documents[index].providers)) config = { ...config, ...documents[index] };
  }
  return config;
}

export function configurationStatus(paths = configPaths()) {
  const documents = [paths.global, paths.local, paths.explicit].map(readConfig);
  const provider = selectProvider(documents);
  return { configured: Boolean(provider), local: asProfiles(documents[1]).providers.length > 0, global: asProfiles(documents[0]).providers.length > 0 };
}

export function makeProfileStore({ paths = configPaths(), vault = createVault({ directory: path.join(path.dirname(paths.global), "codex-delegate-worker-providers") }) } = {}) {
  function read(scope) {
    return asProfiles(readConfig(paths[scope]));
  }
  return {
    read,
    migrate(scope) {
      const document = read(scope);
      if (scope === "local" && !Array.isArray(readConfig(paths.local).providers) && document.providers.length) {
        document.providers[0].config = loadWorkerConfig({ paths: { ...paths, explicit: "" }, vault });
      }
      const created = [];
      try {
        const providers = document.providers.map((provider) => {
          if (provider.credential) return provider;
          const credential = vault.write(provider.config);
          created.push(credential);
          return { name: provider.name, credential };
        });
        if (created.length) saveProfiles(paths[scope], { ...document, providers });
      } catch {
        for (const credential of created) vault.remove(credential);
        throw new Error("Existing configuration could not be saved to private provider files.");
      }
    },
    get(scope, name) {
      const provider = read(scope).providers.find((item) => item.name === name);
      if (!provider) throw new Error("Provider was not found.");
      return provider.credential ? vault.read(provider.credential) : provider.config;
    },
    put(scope, name, config) {
      const document = read(scope);
      const previous = document.providers.find((item) => item.name === name);
      const credential = vault.write(config);
      const provider = { name, credential };
      const next = { version: 1, defaultProvider: document.defaultProvider || name, providers: [...document.providers.filter((item) => item.name !== name), provider] };
      try {
        saveProfiles(paths[scope], next);
      } catch {
        vault.remove(credential);
        throw new Error("Worker configuration could not be saved.");
      }
      if (previous?.credential) {
        try { vault.remove(previous.credential); }
        catch (error) {
          saveProfiles(paths[scope], document);
          vault.remove(credential);
          throw error;
        }
      }
    },
    remove(scope, name) {
      const document = read(scope);
      const provider = document.providers.find((item) => item.name === name);
      if (!provider) throw new Error("Provider was not found.");
      saveProfiles(paths[scope], { version: 1, providers: document.providers.filter((item) => item.name !== name), defaultProvider: document.defaultProvider === name ? null : document.defaultProvider });
      if (provider.credential) {
        try { vault.remove(provider.credential); }
        catch (error) { saveProfiles(paths[scope], document); throw error; }
      }
    },
    use(scope, name) {
      const document = read(scope);
      if (!document.providers.some((item) => item.name === name)) throw new Error("Provider was not found.");
      saveProfiles(paths[scope], { ...document, defaultProvider: name });
    },
  };
}
