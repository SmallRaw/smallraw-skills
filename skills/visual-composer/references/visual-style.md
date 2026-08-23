# Default visual style

The default language is **quiet technical clarity**: a pale neutral canvas, dark sans-serif type, comfortable reading widths, thin rules, precise alignment, and small amounts of semantic color. It should feel like a carefully edited technical document rather than a themed dashboard or a decorative marketing template.

## Tokens

Use the values in `assets/theme.css`; do not scatter replacement colors, spacing, or shadows through the document.

- Canvas: cool pale gray
- Surface: white
- Ink: soft near-black
- Primary: restrained green for verified, active, or successful states
- Secondary: muted red for defects, exceptions, or turning points
- Amber: local use for unresolved states
- Borders: thin cool-gray rules
- Shadows: normally none; reserve the shared shadow for a floating device or stage
- Radius: 8–14px for surfaces; pills only for compact status
- Spacing: follow the supplied 4/8-based scale

## Typography

- Use the shared system sans stack for titles, body, controls, tables, and captions. It includes Chinese fallbacks.
- Use mono only for code, dates, identifiers, source markers, and compact metadata.
- Use the shared `--vc-font-micro`, `--vc-font-caption`, `--vc-font-control`, and `--vc-font-body` tokens. Information-bearing text never goes below 13px; captions normally start at 14px and prose at 17px.
- Lower emphasis with color, weight, spacing, or placement. Do not make auxiliary information difficult to read.
- Keep long-form body text around 16–18px with generous line height and a readable column.
- Use bold weight and spacing before increasing title size.
- Avoid ultra-tight line-height, decorative serif switching, and a unique size for every block.

## Composition

- Align repeated edges and baselines before adding decoration.
- Keep long-form documents narrow; allow boards, comparison media, and canvases to use the wider shell.
- Let whitespace, thin rules, and section rhythm create hierarchy.
- Use panels only when a boundary carries meaning.
- Keep comparable cards equal in size and internal padding.
- Use one semantic accent per state. Do not wash a whole page in accent color.

## Visual revision gate

Use this gate when the user calls an existing result ugly, generic, dashboard-like, or asks for a fresh version.

1. Capture the current first viewport and name its dominant grammar: card grid, editorial split, rail-and-article, full-bleed stage, or another clear structure.
2. Keep the content and interaction contract, then change at least two visible dimensions: composition, type hierarchy, surface/border grammar, density, or media treatment.
3. Prefer a structural alternative over more decoration. A card grid can become ruled rows; a centered hero can become an editorial split; a collection of floating panels can become one continuous document field.
4. Compare the first viewport before detail polish. If the two versions differ only in color, radius, shadow, or timing, the redesign has not happened.
5. Re-run alignment and affordance checks after the structural change. Static areas remain static even when their appearance changes substantially.

## Family consistency

Across a multi-artifact set, repeat the canvas color, ink, type scale, thin rules, metadata treatment, semantic colors, icon geometry, and motion tokens. Let the dominant information relationship choose each page's composition: comparisons stay paired, documents stay narrow, timelines expose sequence, and stages preserve a fixed frame. Family resemblance must not collapse every artifact into the same card grid or hero layout.

## Icons

- Use inline SVG with a `0 0 24 24` viewBox and the shared `.vc-icon` class.
- Keep stroke width, cap, join, and optical direction consistent.
- Place icon and label inside one flex container with a 6–8px gap.
- Use an icon only when it clarifies an action or state. Do not decorate headings with arbitrary symbols.
- Do not mix emoji, Unicode arrows, and SVG icons in one interface.

## Figures and charts

- Preserve the figure's aspect ratio and provide a caption.
- Label screenshots by product state, version, date, or comparison role.
- Use primary green for the main or verified series, ink neutrals for context, and muted red for exceptions.
- Start quantitative axes at a meaningful baseline and show units.
- Do not add decorative numbers, charts, or map pins without underlying data.

## Adaptation

When the user supplies a brand or design system, replace the default tokens with exact provided values while preserving reading width, alignment, evidence placement, semantic color, consistent icon geometry, and restrained motion.
