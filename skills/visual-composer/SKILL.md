---
name: visual-composer
description: "Use whenever the user wants material, findings, events, processes, images, or screenshots turned into a visual artifact: technical documents, research reports, postmortems, image or screenshot comparisons, evidence boards, timelines, process maps, landing pages, slide decks, interactive prototypes, motion pieces, posters, wireframes, or visual exploration canvases. Trigger even when the user says only ‘梳理一下事件/流程’ if a visual result would clarify it. Do not use for plain text-only writing or routine UI bug fixes."
user-invocable: false
disable-model-invocation: false
---

# Visual Composer

Turn content into a clear visual artifact by copying the nearest starter, keeping the shared visual language, and spending model attention on the user's material rather than rebuilding scaffolding.

## Core rules

1. **Choose by information relationship, not by requested buzzword.** Comparison, chronology, flow, evidence, narrative, interaction, motion, and open exploration each have a starter below.
2. **Copy before editing.** Copy the selected starter, `assets/theme.css`, and `assets/theme.js` into the deliverable directory. Never edit the Skill's bundled assets in place.
3. **Keep content truthful.** Use real screenshots, images, figures, data, and sources when provided. Label missing media explicitly; never invent research findings, citations, metrics, or testimonials.
4. **Use one visual system.** Keep the starter's tokens, typography scale, rules, captions, and motion language unless the user supplies a brand or design system.
5. **Add only useful visuals.** A visual must reveal comparison, sequence, structure, magnitude, or evidence. Leave ordinary prose as prose.
6. **Preserve an escape hatch.** If no starter fits, begin with `assets/visual-canvas.html` and compose freely with HTML/CSS/SVG/Canvas while retaining the shared theme assets, labels, sources, and verification.
7. **Load selectively.** Read only the reference files needed for the current artifact. Do not load the whole Skill folder.
8. **Observe before declaring done.** Open the result in a real browser, check the console and primary interaction, and verify the relevant format-specific behaviors.
9. **Interaction review is mandatory; motion is opt-in.** For every artifact, inspect links, buttons, inputs, navigation, state changes, hover effects, scroll behavior, and timed scenes. Read `references/motion.md` whenever any are present. Remove feedback from static surfaces, name the purpose of retained motion, and use the shared recipes instead of inventing timing.
10. **A redesign must change the composition.** When the user says the result is ugly, generic, or asks for a new version, do not stop at colors or timing. Change at least two of: page composition, typographic hierarchy, surface/border grammar, information density, or media treatment. Preserve the content contract and interaction truthfulness.
11. **Keep a Markdown mental model.** Start with a linear hierarchy of headings, prose, lists, code, tables, figures, captions, and citations. Upgrade only the relationships that Markdown cannot express well: aligned comparison, chronology, branching, synchronized state, or timed explanation. The readable baseline must survive without optional JavaScript or motion.
12. **Keep information readable.** Hierarchy comes from spacing, weight, alignment, and color—not microscopic text. Information-bearing text must use the shared typography tokens; do not set text below 13px. Prefer sans for Chinese prose and labels, reserving mono for identifiers, code, dates, and compact source markers.

## Pick the starter

| Dominant need | Copy | Then read |
|---|---|---|
| Long-form technical article, report, postmortem, or evidence-rich document | `assets/document-page.html` | `references/output-formats.md` |
| Two or more images/screenshots/versions | `assets/compare-board.html` | `references/content-patterns.md` |
| Findings, sources, evidence, research synthesis | `assets/research-board.html` | `references/content-patterns.md` |
| Events, chronology, process, decisions, handoffs | `assets/timeline-flow.html` | `references/content-patterns.md` |
| Marketing or explanatory page | `assets/landing-page.html` | `references/output-formats.md` |
| Sequential presentation | `assets/deck-stage.html` | `references/output-formats.md` |
| Clickable screens or stateful flow | `assets/prototype-shell.html` | `references/output-formats.md` |
| Timed explanation, motion comparison, video-like piece | `assets/motion-stage.html` | `references/motion.md` |
| Poster, wireframe grid, style exploration, unusual canvas | `assets/visual-canvas.html` | `references/output-formats.md` |

## Workflow

1. Inspect the supplied material before asking questions. If audience, medium, or required facts can be safely inferred, state the assumption inside the draft and continue.
2. Identify the dominant relationship: compare, evidence, time, flow, narrative, interaction, motion, or exploration. Read `references/workflow.md` only when routing or scope is unclear.
3. Draft the reading order as a Markdown-like outline, mentally or in the working draft. Mark only the sections that require comparison, time, flow, state, or motion; do not create an intermediate file unless it helps the actual task.
4. Convert only those marked relationships using the block map in `references/workflow.md`; this is the assembly step that turns the outline into a webpage without redesigning every block.
5. Copy one primary starter plus `theme.css` and `theme.js`. Add a second pattern only when the content genuinely needs it; do not combine every available component.
6. Replace the clearly marked sample regions with the user's content. Keep source links near the claims, figures, and screenshots they support.
7. Apply the shared style rules from `references/visual-style.md`. For branded work, prefer the user's exact tokens and assets over the default theme.
8. For a redesign request, run the visual revision gate in `references/visual-style.md` and confirm the first viewport is materially different before polishing details.
9. Run the page-level interaction review in `references/motion.md`. A static page must be intentionally static; do not skip the pass because it contains no animation.
10. Verify using `references/verification.md`. Fix observed failures rather than hiding broken elements.
11. Deliver the artifact with a brief note covering only the output path, material assumptions, and unresolved source or media gaps.

## Creative freedom

The starters are reliable beginnings, not mandatory genres. Preserve their stage, type scale, captions, source treatment, responsive behavior, and controls; freely change composition, imagery, illustration, SVG, Canvas, and motion when the brief benefits. Do not force an experimental request back into a generic grid.

## Gotchas

1. **Starting from empty HTML wastes attention** — if a starter covers most of the need, copy it and replace marked regions.
2. **A screenshot gallery is not a comparison** — align viewports, label versions, and explain the meaningful differences.
3. **A list with arrows is not a process model** — show order, decisions, actors, or state changes explicitly.
4. **Decorative charts create false authority** — every mark must map to supplied or sourced data; otherwise use a qualitative diagram.
5. **Source lists detached from claims are hard to audit** — keep a local citation or source marker next to the supported content, then add the full source list.
6. **Mixing every component destroys hierarchy** — choose one dominant visual grammar and at most two supporting patterns per section.
7. **Motion without controls is difficult to review** — timed artifacts need play/pause, a scrubber or clear replay, and reduced-motion behavior.
8. **Broken media silently ruins the artifact** — check every local path and network request; keep an honest labeled placeholder if an asset is missing.
9. **Decoration is not hierarchy** — prefer a narrow reading column, consistent alignment, thin rules, and semantic color before adding gradients, shadows, oversized type, or ornamental icons.
10. **Icons drift when improvised as text** — use same-size inline SVGs with the shared `.vc-icon` class; align icon and label inside one flex container.
11. **Generic fast/normal/slow tokens invite arbitrary motion** — choose the action's intent (`press`, `state`, `enter`, `exit`, or `scene`) and reuse the matching shared token.
12. **Hover on static material lies about affordance** — cards, evidence rows, screenshots, and process steps remain still unless clicking, dragging, or focusing them performs an action.
13. **A token pass is not a redesign** — when the complaint is visual sameness, moving gray values or easing curves leaves the same weak composition intact.
14. **HTML is an extension, not the subject** — do not turn a document into a mini application merely because the output is a webpage.
15. **Low priority is not low legibility** — muted color, lighter weight, and placement may lower emphasis; 9–12px text may not.

## Reference index

| Reference | Read when |
|---|---|
| `references/workflow.md` | Routing the material and mapping Markdown blocks to webpage components |
| `references/visual-style.md` | Applying or adapting the default visual language |
| `references/content-patterns.md` | Building comparisons, research boards, timelines, processes, tables, charts, or citations |
| `references/output-formats.md` | Building landing pages, decks, prototypes, posters, wireframes, or exploration canvases |
| `references/motion.md` | Reviewing any interactive surface, hover, state change, scroll effect, or motion |
| `references/verification.md` | Before delivery, and whenever a visual or interaction is changed materially |
