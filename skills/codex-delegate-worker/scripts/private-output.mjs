import { Transform } from "node:stream";
import { StringDecoder } from "node:string_decoder";

export function redactOutput(config) {
  const values = [config.apiKey, config.baseUrl, config.model, config.providerName, config.providerId];
  try {
    const url = new URL(config.baseUrl);
    values.push(url.host, url.hostname, url.username, url.password);
  } catch { /* Missing or invalid configuration is reported by the launcher. */ }
  const secrets = new Set();
  for (const value of values) {
    if (typeof value !== "string" || !value) continue;
    secrets.add(value);
    secrets.add(JSON.stringify(value).slice(1, -1));
    secrets.add(encodeURIComponent(value));
  }
  const escaped = [...secrets].sort((a, b) => b.length - a.length).map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = escaped.length ? new RegExp(escaped.join("|"), "g") : null;
  return (text) => pattern ? text.replace(pattern, "[private]") : text;
}

// Buffer complete lines so values split across child-process chunks stay private.
export function privateOutputStream(config) {
  const redact = redactOutput(config);
  const decoder = new StringDecoder("utf8");
  let pending = "";
  const protocolFields = new Set(["type", "id", "thread_id", "session_id", "turn_id", "call_id", "status"]);
  function sanitize(value, key) {
    if (typeof value === "string") return protocolFields.has(key) ? value : redact(value);
    if (Array.isArray(value)) return value.map((item) => sanitize(item));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, sanitize(item, name)]));
    return value;
  }
  function line(text) {
    try { return JSON.stringify(sanitize(JSON.parse(text))); }
    catch { return redact(text); }
  }
  return new Transform({
    transform(chunk, _encoding, callback) {
      pending += decoder.write(chunk);
      const end = pending.lastIndexOf("\n");
      if (end !== -1) {
        this.push(pending.slice(0, end).split("\n").map(line).join("\n") + "\n");
        pending = pending.slice(end + 1);
      }
      callback();
    },
    flush(callback) {
      const tail = pending + decoder.end();
      if (tail) this.push(line(tail));
      callback();
    },
  });
}
