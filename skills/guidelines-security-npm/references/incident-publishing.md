# NPM Publishing and Incident Response

Read only when publishing a package or when an unreviewed package may already have executed.

## Publishing

This security review does not authorize `npm publish`. Publishing still requires the user's explicit approval for the exact package, version, registry, and current request.

- Prefer trusted publishing and short-lived identity credentials over long-lived npm tokens.
- Restrict package, scope, workflow, and CI permissions.
- Do not expose publishing identity to pull-request or untrusted fork code.
- Isolate caches across trust boundaries and do not restore untrusted caches into privileged jobs.
- Pin third-party CI actions to immutable revisions.
- Separate build, test, signing, and publishing jobs.
- Generate and verify provenance.
- Inspect the final tarball and publish from a clean environment.
- Do not publish from a developer workstation containing unrelated credentials.

Repository ownership and a trusted CI identity do not prove that the final artifact is benign.

## Suspected Compromise

If an unreviewed package may have executed:

1. Stop further package commands and isolate the affected environment.
2. Record the package, exact version, execution path, and time window without displaying protected values.
3. Identify which credential categories or trusted systems may have been exposed.
4. Ask the user to revoke and rotate affected credentials through their normal secure interfaces.
5. Rebuild from a known-clean lockfile and environment.
6. Do not reuse the affected `node_modules`, caches, tokens, containers, or CI runners.

Do not try to prove that credentials were safe by reading or displaying them.
