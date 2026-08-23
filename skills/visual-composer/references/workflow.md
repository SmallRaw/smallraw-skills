# Workflow

## Ask less, inspect first

Read attachments, source documents, screenshots, and linked project files before asking questions. Continue without a question when the material already fixes the content, audience, medium, or style. Put a short assumptions note in the artifact when a reversible choice was inferred.

Ask one focused round only when an answer would materially change the artifact:

- intended audience or use changes the narrative;
- the requested output medium is ambiguous and not safely inferable;
- a comparison axis is unknown;
- required facts, screenshots, or brand assets are missing;
- fidelity changes the required amount of work.

Do not ask about preferences already answered by the source material. Do not ask the user to choose a template name.

## Route by the dominant relationship

1. **Compare:** two or more alternatives need aligned inspection.
2. **Evidence:** findings must remain traceable to sources.
3. **Time:** the order and turning points matter.
4. **Flow:** actions, decisions, actors, or state transitions matter.
5. **Narrative:** the user will advance through a sequence.
6. **Interaction:** the user must click, type, toggle, or experience state.
7. **Motion:** timing itself carries meaning.
8. **Exploration:** several visual directions or a nonstandard composition must coexist.

Choose one primary relationship. Add a supporting pattern only where prose would make the relationship harder to understand.

## Assemble the page with a low-attention block map

The Agent does not invent a page one CSS selector at a time. It performs this deterministic transformation:

1. Write the material as a Markdown-like reading order.
2. Tag each block by relationship, using the table below.
3. Keep ordinary blocks in document flow.
4. Replace only tagged relationship blocks with the matching Starter pattern.
5. Fill the copied pattern with real content and sources; keep the shared tokens and runtime.

| Material block | Default rendering | Upgrade only when |
|---|---|---|
| Heading, prose, quotation, list | Semantic document flow | Another relationship dominates the section |
| Code or log | Scrollable `pre` / `code` | A consequential diff needs aligned before/after inspection |
| Image or screenshot | Figure + caption | Equivalent states need normalized comparison |
| Exact field/value differences | Table | Several dimensions must be scanned across alternatives |
| Claims and sources | Claim + local source marker | Several claims need an evidence matrix |
| Ordered events | Dated sequence | Turning points or causality need a timeline |
| Actions | Numbered steps | Decisions, owners, branches, or state changes need a flow |
| Product states | Static screens | The reader must operate and verify a primary path |
| Explanation over time | Stable figure | Timing itself explains order, causality, pacing, or feedback |

This is the full assembly mind: **outline → tag relationships → copy one Starter → replace marked regions → review motion → verify**. Layout invention is the escape hatch, not the default.

## Work in one useful pass

1. Copy the starter, `theme.css`, and `theme.js`.
2. Replace sample headings and content with the real material.
3. Place figures, claims, and sources together.
4. Make the primary path complete before polishing secondary states.
5. Open the artifact in a browser and fix observed problems.

Show an early draft only when the remaining direction is genuinely uncertain. Otherwise finish the coherent first version and deliver it.

## Revisions

For a localized request, edit the existing artifact rather than restarting from a starter. Preserve user-approved structure and styling. For a materially different direction, duplicate the artifact with a descriptive suffix so the previous version remains available.
