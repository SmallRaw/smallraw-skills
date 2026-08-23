# Content patterns

## Quick routing

| Signal in the material | Prefer | Avoid |
|---|---|---|
| Same subject in two states | Aligned image/screenshot comparison | Unaligned gallery |
| Several exact field mappings | Table or comparison matrix | Repeated prose cards |
| Claims supported by different sources | Evidence matrix + local citations | Detached bibliography only |
| Ordered events and turning points | Timeline | Bullets with dates |
| Actions with decisions or handoffs | Flow or swimlane | Decorative arrows |
| Hierarchy or ownership | Tree / nested map | Timeline |
| Quantitative magnitude or trend | Chart with units and source | Decorative diagram |
| Qualitative mechanism | Labeled diagram | Invented data chart |

## Markdown-first escalation

Preserve the low-attention reading model of Markdown. Ordinary headings, paragraphs, lists, quotations, code blocks, tables, figures, captions, and citations stay linear and semantic. Upgrade a block only when the relationship gains clarity from the web:

| Material | Keep simple | Upgrade only when |
|---|---|---|
| Prose, headings, lists | Document flow | A different relationship dominates the section |
| Code | Copyable `pre`/`code` block | A unified or aligned diff exposes a consequential change |
| Images and screenshots | Figure + caption | Two states need normalized, side-by-side comparison |
| Claims and references | Claim + nearby source marker | Several claims require an evidence matrix |
| Events | Dated list | Turning points or causality need a timeline |
| Logic and ownership | Numbered steps | Decisions, branches, handoffs, or state changes need a flow |
| Product states | Static screens | A primary path must be clicked and verified |
| Explanation over time | Stable final frame | Timing itself explains order, causality, or pacing |

For code changes, prefer a unified diff when patch semantics and copyability matter; use aligned before/after panes when visual scanning matters. Do not animate syntax merely to decorate it. For every upgraded block, retain a readable title, explanation, caption, and source outside the effect itself.

## Image and screenshot comparisons

- Normalize viewport, crop, scale, and framing when a pixel-level comparison matters.
- Label each side with role and date/version, not merely “A” and “B.”
- Add 1–4 annotations for consequential differences; do not annotate every pixel.
- State the comparison axis: visual hierarchy, workflow, copy, performance, accessibility, or another explicit dimension.
- Keep original media unaltered when it is evidence. Put highlights in an overlay or adjacent annotation layer.

## Research results

Lead with the conclusion, then expose the evidence trail:

1. short synthesis;
2. three to five findings;
3. evidence matrix or relevant chart;
4. limitations and unresolved questions;
5. full source list.

Place a compact source marker beside each supported finding. Record title, publisher/author, date when known, URL, and access date. Quotes must be short and exact; paraphrases must not be presented as quotations.

## Event timelines

Each consequential event should contain:

- date or relative position;
- event title;
- what changed;
- why it mattered;
- source when factual.

Visually distinguish background events, turning points, and outcomes. If causal links are uncertain, label them as interpretation rather than drawing a definitive arrow.

## Process flows

Model a process with verbs and observable states:

- start/end;
- action;
- decision with labeled branches;
- actor or lane when ownership matters;
- state before and after a consequential step;
- exception or recovery path when relevant.

If the process is linear and has fewer than five steps, a numbered sequence is clearer than a diagram.

## Tables and charts

Use tables for lookup and exact comparison. Use charts for magnitude, distribution, or change. Use a diagram for qualitative structure.

For every chart include: metric definition, unit, time range, source, and any transformation or missing-data note. If these are unavailable, keep the values in a table or label the visual as illustrative.
