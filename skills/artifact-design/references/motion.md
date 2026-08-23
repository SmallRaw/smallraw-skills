# Motion

Motion must explain order, causality, state, or emphasis. If removing it changes nothing about comprehension or feedback, keep the artifact static.

## Review every page

Before delivery, inventory every link, button, input, navigation item, hover rule, focus rule, state change, scroll behavior, and timed effect. For each one, record or decide:

1. Is the surface actually interactive? Static evidence, cards, table rows, screenshots, and process steps must not react to hover.
2. What event triggers the change: hover, press, focus, selection, data update, navigation, entry, or time?
3. How often will it happen? Keyboard-driven and high-frequency transitions stay instant or nearly imperceptible.
4. What purpose does it serve? Keep only feedback, state, continuity, causality, or explanation.
5. Which shared token and reduced-motion behavior apply?

An acceptable review can conclude that an entire page stays static. It cannot omit the page from review.

## Decide before animating

1. **Frequency:** actions used constantly or from the keyboard should be instant. Frequent actions get only near-imperceptible feedback. Reserve visible motion for occasional transitions and explanations.
2. **Purpose:** name one job: feedback, spatial continuity, state change, preventing a jarring cut, explanation, or rare delight. No named job means no motion.
3. **Cheapest tool:** use CSS transitions for hover, press, and reversible state; CSS animation for predetermined loops; Web Animations API for programmatic control; a timeline runtime only for scrubbing, sequencing, gestures, or coordinated scenes.
4. **Properties:** prefer `transform` and `opacity`. Animate layout only when the relationship cannot be explained with transforms. Never use `transition: all`.

## Token contract

Use the semantic tokens in `assets/theme.css`; do not invent per-component timing.

| Intent | Token | Value | Use |
|---|---|---:|---|
| Direct press | `--vc-duration-press` | 140ms | Button or control feedback |
| Micro state | `--vc-duration-micro` | 160ms | Hover color, tooltip, tiny toggle |
| Exit | `--vc-duration-exit` | 180ms | Reversible close or dismiss |
| State change | `--vc-duration-state` | 200ms | Tabs, selection, compact crossfade |
| Entry | `--vc-duration-enter` | 240ms | Optional section or popover entry |
| Scene | `--vc-duration-scene` | 420ms | Explanatory scene transition only |
| Stagger step | `--vc-delay-stagger` | 48ms | Ordered items; keep total delay short |

Use `--vc-ease-out` for entry, exit, press, and direct feedback; `--vc-ease-in-out` only for an element already on screen moving between two positions; `--vc-ease-drawer` for a large edge-attached panel. Do not use ease-in for interface motion. Quiet Technical motion is crisp and low-bounce.

## Default policy by Starter

These defaults let a low-attention Agent make the right first decision without inventing motion:

| Starter | Default motion | Explicitly reject |
|---|---|---|
| Document | Reading progress, scrollspy, and at most one header entrance | Per-section scroll choreography and animated evidence |
| Comparison | One entrance for the aligned pair; static inspection afterward | Hovering, lifting, or separately animating evidence cards |
| Research | One synthesis entrance; findings, tables, and sources stay stable | Animated data, confidence pills, and row hover |
| Timeline / flow | A short ordered reveal when sequence aids comprehension | Decorative connector motion and endless replay |
| Landing page | One-time narrative reveals tied to reading order | Motion behind long text, autoplay, and unrelated parallax |
| Deck | Instant slide changes, especially from the keyboard | Fade or slide transitions on arrow-key navigation |
| Prototype | Near-instant navigation; brief feedback for real state changes | Animated tab browsing, fake hover on content, and keyframed rapid state |
| Motion stage | Timed crossfades, stable final frame, play/pause/scrub/replay | Unpausable autoplay, storage writes, and per-frame layout work |
| Visual canvas | One restrained group entrance, then a static board | Ambient motion that makes comparison harder |

When the user explicitly requests a different motion treatment, re-run the frequency and purpose gates before overriding these defaults.

## Component recipes

- **Button:** color or border on fine-pointer hover; `scale(.97)` on press; no lift or bounce. Disable the transform when `aria-disabled="true"` or `disabled`.
- **Text link:** color or underline is usually enough. Move a directional icon by at most `1px` only when it clarifies destination or direction.
- **Static table/card:** no hover fill, lift, scale, glow, or cursor change. Add a reaction only after the surface gains a real action.
- **Navigation:** selected control and target content update in the same frame. Use a restrained state indicator; do not delay the content behind the control.
- **Input/state feedback:** focus may change border and focus ring. Data values update exactly; animate only the surrounding color, opacity, or container state.
- **Popover:** fade plus scale from `.97` to `1`, originating at its trigger edge. Never start at `scale(0)`.
- **Modal:** fade plus scale from `.97` to `1`, centered on the viewport.
- **Reveal:** fade plus at most `8px` translation. Add `--vc-reveal-delay` in 48ms steps for an ordered set; normally stop after five items.
- **Shared state:** crossfade when two states occupy the same place; move with `--vc-ease-in-out` only when spatial continuity matters.
- **Exit:** reverse the entry's spatial logic, but it may be slightly faster. Reversible controls must remain interruptible.

## Shared visible layer

`assets/theme.js` supplies three optional, dependency-free behaviors. Prefer them over rewriting observers in each artifact:

- Add `data-reveal` for a one-time 8px + opacity section entrance; use `data-reveal="fade"` when direction would imply unsupported meaning.
- Add `vc-delay-1` through `vc-delay-4` only to an ordered sibling group. The 48ms steps must reveal hierarchy, not decorate unrelated cards.
- Add one `.vc-scroll-progress[data-scroll-progress]` to a long reading surface when progress helps orientation.
- Add `data-scrollspy` to a local anchor navigation whose links map to section ids. The runtime updates the active link in the same frame as the reading location.

The runtime adds the hiding class before body parsing and falls back to visible content when JavaScript or `IntersectionObserver` is unavailable. Do not add a second reveal observer.

Hover-only styling belongs inside `@media (hover: hover) and (pointer: fine)`. Reduced-motion mode keeps useful opacity and color feedback while removing translation, scale, parallax, and decorative loops.

## Reliable explanatory patterns

- **Crossfade:** compare alternatives in the same position without a blank frame.
- **Stagger:** expose an ordered set with 30–80ms spacing; never block the last item behind a long sequence.
- **Chart grow / line draw:** reveal magnitude or path only when the final values are sourced.
- **Spotlight:** focus attention on one region of a screenshot or diagram.

Start timed work from `assets/motion-stage.html`. Write setup, development, turning point, and resolution before editing scenes. Keep text visible long enough to read; provide play/pause, scrub, replay, a stable final frame, background-tab pause, and reduced-motion behavior. Predetermined motion should not write storage or trigger layout on every frame.

For motion comparisons, align duration, viewport, and starting state. Use side-by-side playback or a shared scrubber and name the comparison axis: pacing, continuity, hierarchy, feedback, or perceived performance.

## Reject on review

- `transition: all`, `scale(0)` for component entry, ease-in, or playful bounce in serious material;
- hover transforms without a fine-pointer media query;
- hover or press feedback on a surface that performs no action;
- all-at-once group entrances or long blocking staggers;
- continuous motion behind long text, scroll hijacking, or autoplay without pause;
- motion that hides missing structure, fabricates magnitude, or becomes the only way to understand state;
- reduced-motion implemented as globally setting every duration to `1ms`.
