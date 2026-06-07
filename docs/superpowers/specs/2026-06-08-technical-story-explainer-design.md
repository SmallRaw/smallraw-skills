# Technical Story Explainer Skill Design

## Purpose

Create a `technical-story-explainer` skill that turns technical concepts, messy engineering topics, product/API ecosystems, and professional domain knowledge into clear everyday stories for a general audience.

The skill is not only a glossary explainer. It must handle both:

- Single concepts, such as KV Cache, SQL injection, Undo Log, interrupts, or HTTP status codes.
- Complex technical narratives, such as the evolution from web UI usage to APIs to agents, API compatibility layers, tool support differences, bridge/proxy adapters, and changing vendor ecosystems.

The default output is a polished Chinese story explanation. If the user asks for an outline, decomposition, video script, article draft, or course-style explanation, the skill adapts the output shape while preserving the same explanation engine.

## Core Model

The skill uses a five-step "peeling the onion" method:

1. The Hook: start with a non-technical everyday trouble.
2. The Naive Approach: let the protagonist try the obvious bad solution and show why it fails.
3. The Metaphorical System: introduce roles, rules, and workflow until a clever real-world system emerges.
4. The Aha Moment: reveal that this mechanism is the target technical concept or system.
5. The Dictionary: map story roles and props to real terms.

For complex narratives, the skill adds an internal preparation pass before the five-step story:

1. Build a fact map: timeline, actors, interfaces, compatibility claims, constraints, and known uncertainty.
2. Build a conflict map: who wants what, where the old method breaks, and why new layers appear.
3. Build a story map: choose a real-world setting that can carry the whole system without becoming confusing.
4. Write the final explanation using the five-step method.

## Research Policy

The skill must distinguish stable concepts from changing ecosystem facts.

Research is optional for stable fundamentals when the model can explain them reliably, for example HTTP status code categories, SQL injection mechanics, database rollback logs, or hardware interrupts.

Research is required when the topic involves current or changing facts, such as:

- Which API a product currently supports.
- Which model IDs, vendors, or compatibility modes a tool accepts.
- Whether Claude Code, Codex, OpenAI APIs, Anthropic APIs, or third-party gateways support a feature.
- Current interface names, deprecations, SDK behavior, pricing, product limitations, or release timelines.
- Comparisons between competing products or current agent frameworks.

When research is required, the output should include concise source links after the story. Stable concept explanations do not need sources unless the user asks.

If the available sources do not fully answer a claim, the skill must mark it as uncertain or as an inference. The story must never hide weak facts behind a confident metaphor.

## Knowledge Organization

Use `references/` as a layered knowledge base, not as one large prompt.

Recommended files:

- `references/story-formula.md`
  The core five-step method, handling rules for single concepts and complex narratives, and output modes.

- `references/research-rules.md`
  Rules for when to browse, how to build a fact map, how to cite sources, and how to separate confirmed facts from inference.

- `references/example-bank.md`
  Compressed style examples based on HTTP status codes, Undo Log, SQL injection, KV Cache, React Native bridge, and hardware interrupts.

- `references/metaphor-patterns.md`
  Reusable everyday systems: restaurants, schools, finance offices, warehouses, customs, couriers, construction teams, hospitals, theaters, libraries, and government counters.

- `references/fact-snapshots.md`
  Optional curated snapshots for facts the user has already verified. These are aids, not authorities. If the topic is current, the skill still verifies against live or primary sources before making support/version claims.

This separation keeps durable writing craft apart from facts that can expire.

## Skill Behavior

Trigger the skill when the user asks to:

- Explain a technical concept to ordinary people.
- Turn a professional term into a vivid story.
- Write a metaphorical explanation of software, AI, APIs, infrastructure, security, databases, networking, hardware, or engineering systems.
- Clarify a messy technical ecosystem through a story.
- Produce a draft in the style of "图解HTTP", "码农翻身", or similar heuristic technical storytelling.

Default behavior:

- If the input is a single concept, output a complete story draft.
- If the input is a complex narrative, internally research and organize it first, then output a complete story draft.
- If the user asks for an outline, output the story map instead of a full draft.
- If the user asks for a video script or article polish, produce the closest requested format, while noting that separate downstream format-specific skills can further refine tone and structure later.

## Output Standards

The first 30% of the story should avoid the core technical term unless the user explicitly wants a direct answer first. The reader should first feel the everyday problem.

The story should include human-like roles, dialogue, movement, and friction. Data, protocols, APIs, services, processes, and tools should become people or institutions with understandable incentives.

The protagonist should try at least one naive solution that fails. Do not start with the perfect architecture.

The metaphor must preserve the real mechanism. It can simplify, but it cannot invert causality, hide limitations, or imply false support.

For complex topics, the final explanation should avoid dumping every term at once. It should introduce terms only after the reader has a place to put them.

End with a compact dictionary mapping story elements to technical concepts. For current topics, append a short "sources and boundaries" section.

## Non-Goals

This first skill does not replace specialized downstream writing skills.

It should not try to be a full video-script editor, article headline generator, SEO optimizer, course designer, or slide writer. Those can be separate skills later.

It should not store large scraped corpora by default. Curated fact snapshots are acceptable, but the skill should prefer fresh verification for volatile ecosystem claims.

## Initial Implementation Scope

Create one skill directory:

```text
skills/technical-story-explainer/
├── SKILL.md
├── agents/
│   └── openai.yaml
└── references/
    ├── story-formula.md
    ├── research-rules.md
    ├── example-bank.md
    ├── metaphor-patterns.md
    └── fact-snapshots.md
```

No scripts are needed for the first version.

## Acceptance Criteria

- The skill description clearly triggers on both single-concept explanations and complex technical storytelling requests.
- `SKILL.md` stays concise and points to references only when needed.
- The workflow explicitly requires research for changing technical ecosystem facts.
- The reference files preserve the user's preferred style: everyday hook, naive failure, personified system, reveal, and dictionary.
- The design supports default complete drafts and requested outline/story-map outputs.
- The implementation avoids treating stale fact snapshots as authoritative for current product support.
