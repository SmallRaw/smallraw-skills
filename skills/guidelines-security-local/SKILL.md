---
name: guidelines-security-local
description: Check secret access and deceptive hosts before reading/exporting credentials, private keys, auth stores, clipboard, command history, environment or crash dumps. Skip ordinary source searches and edits.
user-invocable: false
disable-model-invocation: false
license: MIT
---

# Guidelines: Local Security

- Never read/export live `.env`, private keys, credentials, auth stores, clipboard/history, command history, environment or crash dumps. Copies, Git history, encodings and uploads remain protected; confirmation cannot override a deny.
- Static source/query text, literal file-writing bodies, public keys/certificates and secret-free templates are data. Check actual accesses, including broad searches and shell substitutions. For network requests, check the real host and reject deceptive file-like hosts.
- Do not read an ambiguous secret-like path to classify it; use sanitized input or collect one exact-path clarification at the close. User-identified conversation transcripts are context; extract only what is needed without surfacing secrets.
- After denial, use a documented safe alternative or leave that step pending. Never disguise access or switch tools to bypass it. Continue independent work; collect remaining needs once at the close. Silence is not approval.

Keep verified OS file/network controls active; this skill is not enforcement. Missing hooks do not block ordinary work; install/update hooks only when explicitly requested.
