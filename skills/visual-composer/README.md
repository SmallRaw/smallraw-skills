# Visual Composer

`visual-composer` turns source material into browser-viewable visual artifacts without asking the model to rebuild common scaffolding. It provides a restrained shared theme and starters for technical documents, comparisons, research boards, timelines and flows, landing pages, decks, prototypes, motion pieces, and open visual canvases.

The Skill is intentionally small. It is not a renderer or component framework: the agent copies the nearest starter, replaces marked sample content, adapts the composition, and verifies the result in a browser. Every artifact receives an interaction review—even when the correct result is static. Motion uses purpose-based tokens and fixed component recipes so agents choose an intent instead of inventing timing curves.

The authoring model stays Markdown-like: linear content remains linear, while HTML is used only where aligned comparison, relationship mapping, synchronized state, or timed explanation materially improves understanding.

## Included starters

| Starter | Typical use |
|---|---|
| `document-page.html` | Technical articles, reports, postmortems, evidence-rich long-form documents |
| `compare-board.html` | Image, screenshot, and version comparison |
| `research-board.html` | Findings, evidence matrices, source summaries |
| `timeline-flow.html` | Chronology, process, decisions, handoffs |
| `landing-page.html` | Editorial landing or explanatory page |
| `deck-stage.html` | Scaled slide presentation |
| `prototype-shell.html` | Clickable multi-screen prototype |
| `motion-stage.html` | Timed explanation or motion comparison |
| `visual-canvas.html` | Poster, wireframe, style exploration, custom canvas |

Copy `assets/theme.css` and `assets/theme.js` beside the selected HTML starter. CSS owns the visual and motion tokens; the tiny shared runtime owns one-time reveals, scroll progress, and synchronized table-of-contents state. The starter files are source material: copy them into the user's deliverable directory instead of editing the installed Skill.

After changing bundled starters, run `node scripts/validate_starters.mjs`; then perform the relevant browser checks from `references/verification.md`.
