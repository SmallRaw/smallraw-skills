# Verification

Match verification to the artifact. A local style edit needs a focused visual check; a new interactive or timed artifact needs a full primary-path pass.

Run `node scripts/validate_starters.mjs` after changing bundled assets. It checks structural interaction invariants but does not replace browser observation.

## Every artifact

- Open the actual entry HTML in a real browser.
- Confirm the console has no red errors, missing local assets, font failures, or blocked requests.
- Check the intended desktop viewport and one narrow viewport.
- Confirm headings, captions, annotations, and source markers are readable.
- Confirm every information-bearing pixel font size is at least 13px. Captions and secondary explanations should normally be 14px or larger.
- Confirm repeated card edges, baselines, control labels, and icon centers align at the intended viewport.
- Confirm icons use a consistent SVG viewBox, size, stroke width, and optical direction; do not mix emoji or text arrows with interface icons.
- Search for unreplaced sample text, TODO markers, fake metrics, and placeholder URLs.
- Check keyboard focus for interactive controls.
- Keep touch targets at least 44px high and verify every control remains inside the narrow viewport.
- Give intentional horizontal scroll regions `data-horizontal-scroll`, `tabindex="0"`, and a useful accessible label.
- Reject `href="#"`, inert controls styled as active, and persistence claims that are not backed by storage.
- Inventory every hover, press, focus, selected, disabled, loading, and changed state that exists in the artifact.
- Confirm static cards, figures, table rows, evidence, and process steps do not react like controls.
- Confirm the Markdown-like reading baseline remains visible if the optional shared runtime fails. Deck, prototype, and motion starters must expose a useful no-script state and hide controls that would otherwise be inert.

## Comparison and research boards

- Compared media uses compatible framing and labels.
- Every highlighted difference has an explanation.
- Findings point to a nearby source marker.
- Tables fit without silently clipping columns.

## Technical document

- The reading column stays comfortable and the table of contents reaches the correct sections.
- Inline code, code blocks, status bars, comparisons, and screenshot strips remain visually distinct without excessive color.
- Long code and screenshot sequences scroll rather than forcing the page wider.

## Timeline and flow

- Order is unambiguous.
- Branch labels explain the decision outcome.
- Actors or states are shown where they matter.
- Connectors do not cross labels or imply unsupported causality.

## Deck

- Prev/next controls, arrow keys, Home, and End work.
- Counter and active slide stay synchronized.
- The 1920×1080 canvas centers and scales on a narrow viewport.
- The complete control bar remains visible and tappable at 390px wide.
- Print preview places one slide on each page when export is required.

## Prototype

- Complete the primary flow end to end.
- Inputs, toggles, navigation, and state changes are visible.
- Focus, empty, error, and disabled states required by the brief are reachable.
- Form submission works from both the visible button and Enter, and state messages describe the actual persistence scope.

## Motion

- Play, pause, scrub, replay, and final state work.
- Controls remain reachable on narrow screens.
- Narrow screens use a readable responsive composition rather than shrinking information-bearing text with the desktop canvas.
- Text has sufficient reading time.
- Every animation has a named purpose appropriate to the action frequency.
- Timing uses the shared semantic tokens; no `transition: all`, `scale(0)`, ease-in, or unexplained bounce remains.
- Hover-only feedback is gated to fine pointers, and reversible controls can be interrupted without jumping.
- Scene crossfades have no blank frame; backgrounding the page pauses playback without a time jump.
- Reduced-motion mode preserves useful opacity and color feedback while removing spatial movement and decorative loops.
- Timed playback does not write storage, force layout, or allocate avoidable objects on every frame.

Fix root causes. Do not hide a broken component, swallow an error, or remove evidence simply to make the check pass.
