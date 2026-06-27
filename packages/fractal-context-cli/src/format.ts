// INPUT: Structured Fractal Context command results
// OUTPUT: Compact Markdown or JSON text for agent and human consumption
// POS: Output formatter for the Fractal Context CLI

import type { HeaderInfo, ListResult, ReadResult, SearchResult, StatusResult } from "./core.js";

export type AnyResult = StatusResult | ListResult | ReadResult | SearchResult;

export function formatJson(result: AnyResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function formatMarkdown(result: AnyResult): string {
  switch (result.command) {
    case "status":
      return formatStatus(result);
    case "list":
      return formatList(result);
    case "read":
      return formatRead(result);
    case "search":
      return formatSearch(result);
  }
}

function formatStatus(result: StatusResult): string {
  const lines = [
    "# Fractal Context Status",
    "",
    `Root: ${result.root}`,
    `FRACTAL-DOCS.md: ${result.hasProtocol ? "yes" : "no"}`,
    `Root AGENTS.md: ${result.hasRootAgents ? "yes" : "no"}`,
    `AGENTS.md files: ${result.agentsCount}`,
    `Files with headers: ${result.headerCount}`,
    `Scanned files: ${result.scannedFiles}`,
    ""
  ];
  appendSignals(lines, result.staleSignals);
  appendNext(lines, result.next);
  return `${lines.join("\n")}\n`;
}

function formatList(result: ListResult): string {
  const lines = [
    `# Fractal List: ${result.path}`,
    ""
  ];
  if (result.agents?.summary) {
    lines.push("## Summary", "", result.agents.summary, "");
  }
  if (result.agents?.businessRows.length) {
    lines.push("## Business Domains");
    for (const row of result.agents.businessRows.slice(0, 12)) {
      lines.push(`- ${row.path}: ${row.domain}${row.notes ? ` - ${row.notes}` : ""}`);
    }
    lines.push("");
  }
  lines.push("## Entries");
  for (const entry of result.entries) {
    if (entry.kind === "directory") {
      lines.push(`- [dir] ${entry.path}${entry.summary ? ` - ${entry.summary}` : ""}`);
    } else {
      lines.push(`- [file] ${entry.path}${formatHeaderInline(entry.header)}`);
    }
  }
  if (result.truncated) lines.push("- [truncated] Narrow path or increase --max");
  lines.push("");
  appendSignals(lines, result.staleSignals);
  appendNext(lines, result.next);
  return `${lines.join("\n")}\n`;
}

function formatRead(result: ReadResult): string {
  const lines = [
    `# Fractal Read: ${result.path}`,
    "",
    `Kind: ${result.kind}`,
    ""
  ];
  if (result.agents) {
    if (result.agents.summary) {
      lines.push("## Summary", "", result.agents.summary, "");
    }
    if (result.agents.sections.length) {
      lines.push("## Sections");
      for (const section of result.agents.sections) {
        lines.push(`### ${section.title}`);
        if (section.body) lines.push(section.body);
        lines.push("");
      }
    }
  }
  if (result.header) {
    lines.push("## Header", "", ...result.header.lines, "");
  }
  if (result.content) {
    lines.push("## Content", "", "```text", result.content.trimEnd(), "```", "");
  }
  if (!result.agents && !result.header && !result.content) {
    lines.push("No fractal documentation found for this path.", "");
  }
  if (result.truncated) lines.push("Truncated: yes", "");
  appendSignals(lines, result.staleSignals);
  appendNext(lines, result.next);
  return `${lines.join("\n")}\n`;
}

function formatSearch(result: SearchResult): string {
  const lines = [
    `# Fractal Search: ${result.query}`,
    "",
    `Scope: ${result.scope}`,
    ""
  ];
  if (result.results.length === 0) {
    lines.push("No matches.", "");
  } else {
    lines.push("## Results");
    for (const item of result.results) {
      lines.push(`- ${item.type} ${item.path}: ${item.excerpt}`);
    }
    lines.push("");
  }
  if (result.truncated) lines.push("Truncated: yes", "");
  appendNext(lines, result.next);
  return `${lines.join("\n")}\n`;
}

function appendSignals(lines: string[], signals: Array<{ detail: string }>) {
  if (signals.length === 0) return;
  lines.push("## Stale Signals");
  for (const signal of signals.slice(0, 20)) {
    lines.push(`- ${signal.detail}`);
  }
  lines.push("");
}

function appendNext(lines: string[], next: string[]) {
  if (next.length === 0) return;
  lines.push("## Next:");
  for (const command of next) {
    lines.push(`- ${command}`);
  }
}

function formatHeaderInline(header?: HeaderInfo): string {
  if (!header) return "";
  const parts = [header.input && `INPUT: ${header.input}`, header.output && `OUTPUT: ${header.output}`, header.pos && `POS: ${header.pos}`]
    .filter(Boolean);
  return parts.length ? ` - ${parts.join("; ")}` : "";
}
