# Output formats

## Technical document

Start from `assets/document-page.html`. Use it for technical articles, incident reports, research narratives, and long-form documents with code, screenshots, or evidence.

- Keep the reading column narrow enough for prose; let code blocks and image strips scroll when necessary.
- Keep the table of contents synchronized with section ids.
- Put raw evidence before interpretation when the reader needs to audit the conclusion.
- Use inline code for identifiers and compact values, not for ordinary emphasis.
- Use semantic green, red, and amber only for confirmed, problematic, and unresolved states.
- Compare screenshots at the same scale and preserve captions.

## Landing page

Start from `assets/landing-page.html`. Preserve the editorial progression: premise, evidence, explanation, concrete comparison, next action. Do not default to hero + three feature cards + testimonials. Use real product surfaces, findings, or demonstrations when available.

## Slide deck

Start from `assets/deck-stage.html`.

- One primary point per slide.
- Body text at least 24px on the 1920×1080 canvas; major headings at least 64px.
- Alternate section, evidence, figure, and synthesis layouts deliberately.
- Keep controls outside the scaled canvas.
- Add speaker notes only when requested.
- Check print mode if PDF export matters.

## Interactive prototype

Start from `assets/prototype-shell.html`. It is intentionally vanilla HTML/CSS/JS so a simple agent can edit it without dependency setup.

- Complete the main path before secondary screens.
- Represent real state changes instead of `alert()` placeholders.
- Define hover, focus, active, disabled, empty, and error states when relevant.
- Mock external services locally; do not send user data to a real endpoint.
- Use a device frame only when the platform context improves understanding.

## Poster

Start from `assets/visual-canvas.html` and keep one frame. Use a fixed aspect ratio, a strong typographic hierarchy, and only material that earns space. Verify at intended print or screen size.

## Wireframes

Start from `assets/visual-canvas.html` and keep the grid. Use monochrome shapes, labels, arrows, and state notes. Do not spend attention on final colors, shadows, or imagery before the flow is settled.

## Visual exploration canvas

Start from `assets/visual-canvas.html`. Each cell must name the direction and what differs. Keep cell dimensions comparable. Explore genuinely distinct structures or visual metaphors, not minor color swaps.

## Custom canvas

Use the visual canvas as a frame, then freely add HTML/CSS/SVG/Canvas. Retain the shared theme tokens, artifact title, annotations, source treatment, responsive containment, and verification. If a custom runtime is introduced, keep a no-animation or static fallback.
