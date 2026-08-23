#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetDir = path.join(skillDir, 'assets');
const htmlFiles = fs.readdirSync(assetDir).filter((name) => name.endsWith('.html')).sort();
const failures = [];
const themeVersions = new Set();
const runtimeVersions = new Set();
let scriptCount = 0;
let horizontalScrollCount = 0;

const findClosingBrace = (source, openingIndex) => {
  let depth = 0;
  let quote = null;
  let comment = false;
  for (let i = openingIndex; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];
    if (comment) {
      if (char === '*' && next === '/') {
        comment = false;
        i += 1;
      }
      continue;
    }
    if (!quote && char === '/' && next === '*') {
      comment = true;
      i += 1;
      continue;
    }
    if (quote) {
      if (char === '\\') i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return i;
      if (depth < 0) return -1;
    }
  }
  return -1;
};

const assertBalancedCss = (source, label) => {
  const wrapped = `{${source}}`;
  if (findClosingBrace(wrapped, 0) !== wrapped.length - 1) failures.push(`${label}: unbalanced CSS braces`);
};

const removeFinePointerBlocks = (source, label) => {
  const marker = '@media (hover: hover) and (pointer: fine)';
  const masked = [...source];
  let cursor = 0;
  while (true) {
    const start = source.indexOf(marker, cursor);
    if (start < 0) break;
    const opening = source.indexOf('{', start + marker.length);
    const closing = opening < 0 ? -1 : findClosingBrace(source, opening);
    if (closing < 0) {
      failures.push(`${label}: malformed fine-pointer media query`);
      break;
    }
    masked.fill(' ', start, closing + 1);
    cursor = closing + 1;
  }
  return masked.join('');
};

const validateCss = (source, label) => {
  assertBalancedCss(source, label);
  if (/transition\s*:\s*all\b/i.test(source)) failures.push(`${label}: transition: all is forbidden`);
  if (/\bscale\(\s*0(?:\.0+)?\s*\)/i.test(source)) failures.push(`${label}: scale(0) entrances are forbidden`);
  if (/\bease-in(?!-out)\b/i.test(source)) failures.push(`${label}: ease-in is forbidden for interface motion`);
  if (/transition(?:-property)?\s*:[^;}]*\b(?:width|height|margin|padding|top|right|bottom|left)\b/i.test(source)) {
    failures.push(`${label}: transition animates a layout property`);
  }
  for (const match of source.matchAll(/font-size\s*:\s*([\d.]+)px/gi)) {
    if (Number(match[1]) < 13) failures.push(`${label}: information text uses ${match[1]}px; minimum is 13px`);
  }
  if (/--vc-(?:fast|normal|slow|ease)\s*:/.test(source)) failures.push(`${label}: generic legacy motion token found`);
  if (/:hover\b/.test(removeFinePointerBlocks(source, label))) failures.push(`${label}: hover rule exists outside the fine-pointer media query`);
};

for (const file of htmlFiles) {
  const html = fs.readFileSync(path.join(assetDir, file), 'utf8');
  if (/\bhref\s*=\s*["']#["']/i.test(html)) failures.push(`${file}: inert href="#" placeholder found`);
  for (const match of html.matchAll(/<([a-z][\w-]*)\b([^>]*\bdata-horizontal-scroll\b[^>]*)>/gi)) {
    horizontalScrollCount += 1;
    const attributes = match[2];
    if (!/\btabindex\s*=\s*["']0["']/i.test(attributes)) failures.push(`${file}: data-horizontal-scroll must be keyboard focusable`);
    if (!/\baria-label\s*=\s*["'][^"']+["']/i.test(attributes)) failures.push(`${file}: data-horizontal-scroll needs an accessible label`);
  }
  const version = html.match(/theme\.css\?v=(\d+)/)?.[1];
  if (!version) failures.push(`${file}: missing versioned theme.css reference`);
  else themeVersions.add(version);
  const runtimeVersion = html.match(/theme\.js\?v=(\d+)/)?.[1];
  if (!runtimeVersion) failures.push(`${file}: missing versioned theme.js reference`);
  else runtimeVersions.add(runtimeVersion);

  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/gi)];
  styles.forEach((match, index) => validateCss(match[1], `${file}: style ${index + 1}`));

  const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((match) => !/\bsrc\s*=/.test(match[1]));
  scriptCount += scripts.length;
  scripts.forEach((match, index) => {
    try {
      new Function(match[2]);
    } catch (error) {
      failures.push(`${file}: script ${index + 1}: ${error.message}`);
    }
  });
}

if (themeVersions.size !== 1) failures.push(`HTML starters use inconsistent theme versions: ${[...themeVersions].join(', ')}`);
if (runtimeVersions.size !== 1) failures.push(`HTML starters use inconsistent runtime versions: ${[...runtimeVersions].join(', ')}`);
if (horizontalScrollCount < 3) failures.push(`bundled starters must retain three labeled keyboard-focusable horizontal scroll regions; found ${horizontalScrollCount}`);

const redesignedStarters = {
  'compare-board.html': ['compare-masthead', 'notes-head'],
  'timeline-flow.html': ['record-masthead', 'flow-head'],
  'landing-page.html': ['demo-constraint'],
  'deck-stage.html': ['slide-meta', 'deck-label'],
  'prototype-shell.html': ['prototype-note-head', 'prototype-path'],
  'motion-stage.html': ['scene-rail', 'motion-label'],
};
for (const [file, markers] of Object.entries(redesignedStarters)) {
  const html = fs.readFileSync(path.join(assetDir, file), 'utf8');
  markers.forEach((marker) => {
    if (!html.includes(marker)) failures.push(`${file}: missing redesigned structure marker ${marker}`);
  });
}

const staticPanelPatterns = {
  'compare-board.html': /compare-card[^"\n]*vc-panel/,
  'timeline-flow.html': /step[^"\n]*vc-panel/,
  'landing-page.html': /hero-number[^"\n]*vc-panel/,
  'prototype-shell.html': /prototype-card[^"\n]*vc-panel/,
};
for (const [file, pattern] of Object.entries(staticPanelPatterns)) {
  const html = fs.readFileSync(path.join(assetDir, file), 'utf8');
  if (pattern.test(html)) failures.push(`${file}: static content regressed to a floating panel`);
}

const theme = fs.readFileSync(path.join(assetDir, 'theme.css'), 'utf8');
validateCss(theme, 'theme.css');
for (const token of ['press', 'micro', 'exit', 'state', 'enter', 'scene']) {
  if (!theme.includes(`--vc-duration-${token}:`)) failures.push(`theme.css: missing --vc-duration-${token}`);
}
for (const [token, value] of Object.entries({ micro: '13px', caption: '14px', control: '15px', body: '17px' })) {
  if (!theme.includes(`--vc-font-${token}: ${value};`)) failures.push(`theme.css: --vc-font-${token} must remain ${value}`);
}
if (!theme.includes('--vc-control-min-height: 44px;')) failures.push('theme.css: shared control minimum must remain 44px');
if (!theme.includes('[data-horizontal-scroll]:focus-visible')) failures.push('theme.css: horizontal scroll regions need a visible focus style');
if (theme.includes('.vc-table tbody tr:hover')) failures.push('theme.css: static table rows must not have hover feedback');
if (!theme.includes('.vc-motion-ready [data-reveal]')) failures.push('theme.css: reveals must remain visible without the runtime readiness class');

const runtime = fs.readFileSync(path.join(assetDir, 'theme.js'), 'utf8');
try {
  new Function(runtime);
} catch (error) {
  failures.push(`theme.js: ${error.message}`);
}
for (const requirement of ['IntersectionObserver', 'requestAnimationFrame', 'data-scroll-progress', 'data-scrollspy', 'data-horizontal-scroll', 'region.scrollLeft', "setAttribute('aria-current', 'location')", "classList.remove('vc-motion-ready')"]) {
  if (!runtime.includes(requirement)) failures.push(`theme.js: missing ${requirement}`);
}
if (/setTimeout|setInterval|localStorage/.test(runtime)) failures.push('theme.js: shared visual runtime must not use timers or storage');

const rootClasses = new Set();
const revealClasses = new Set();
let observerCallback = null;
let observerTarget = null;
const sandbox = {
  document: {
    readyState: 'complete',
    documentElement: {
      classList: {
        add: (name) => rootClasses.add(name),
        remove: (name) => rootClasses.delete(name),
      },
      scrollHeight: 1200,
    },
    querySelectorAll: (selector) => selector === '[data-reveal]' ? [{ classList: { add: (name) => revealClasses.add(name) } }] : [],
    querySelector: () => null,
    getElementById: () => null,
  },
  IntersectionObserver: class {
    constructor(callback) { observerCallback = callback; }
    observe(target) { observerTarget = target; }
    unobserve() {}
  },
  addEventListener: () => {},
  requestAnimationFrame: (callback) => { callback(); return 1; },
  innerHeight: 800,
  scrollY: 0,
};
sandbox.window = sandbox;
try {
  vm.runInNewContext(runtime, sandbox);
  observerCallback?.([{ isIntersecting: true, target: observerTarget }]);
  if (!rootClasses.has('vc-motion-ready') || !revealClasses.has('is-visible')) failures.push('theme.js: reveal smoke test did not reach its visible state');
} catch (error) {
  failures.push(`theme.js: runtime smoke test: ${error.message}`);
}

const motion = fs.readFileSync(path.join(assetDir, 'motion-stage.html'), 'utf8');
const duration = Number(motion.match(/data-duration="([\d.]+)"/)?.[1]);
const scenes = [...motion.matchAll(/<section class="[^"]*scene[^"]*" data-start="([\d.]+)" data-end="([\d.]+)"/g)]
  .map((match) => ({ start: Number(match[1]), end: Number(match[2]) }));
if (!scenes.length || scenes[0].start !== 0 || scenes.at(-1).end !== duration) {
  failures.push('motion-stage.html: scenes must cover the full duration');
}
for (let index = 1; index < scenes.length; index += 1) {
  if (scenes[index - 1].end !== scenes[index].start) failures.push(`motion-stage.html: gap or overlap before scene ${index + 1}`);
}
for (const requirement of ['visibilitychange', 'prefers-reduced-motion', 'aria-valuetext', 'narrowLayout', 'canvas.style.width', 'canvas.style.height']) {
  if (!motion.includes(requirement)) failures.push(`motion-stage.html: missing ${requirement}`);
}
if (/localStorage|sessionStorage/.test(motion)) failures.push('motion-stage.html: timed playback must not write browser storage');
if (motion.includes("style.setProperty('--line-progress'")) failures.push('motion-stage.html: set transform on the animated line, not an inherited parent variable');

const deck = fs.readFileSync(path.join(assetDir, 'deck-stage.html'), 'utf8');
for (const requirement of ['prevButton.disabled', 'nextButton.disabled', "setAttribute('aria-hidden'", 'event.target instanceof HTMLButtonElement', '@media (max-width: 620px)', '.deck-label, .deck-hint { display: none; }']) {
  if (!deck.includes(requirement)) failures.push(`deck-stage.html: missing ${requirement}`);
}
if (/\.slide\.active\s*\{[^}]*transition\s*:/s.test(deck)) failures.push('deck-stage.html: keyboard slide navigation must remain instant');

const documentStarter = fs.readFileSync(path.join(assetDir, 'document-page.html'), 'utf8');
const documentReveals = [...documentStarter.matchAll(/\bdata-reveal(?:=|\b)/g)].length;
if (documentReveals > 1) failures.push('document-page.html: long-form reading allows only the header entrance');
for (const requirement of ['class="code-block" data-horizontal-scroll tabindex="0"', 'class="screenshot-strip" data-horizontal-scroll tabindex="0"']) {
  if (!documentStarter.includes(requirement)) failures.push(`document-page.html: missing reachable horizontal region ${requirement}`);
}

const research = fs.readFileSync(path.join(assetDir, 'research-board.html'), 'utf8');
if (!research.includes('class="vc-table-wrap" data-horizontal-scroll tabindex="0"')) failures.push('research-board.html: evidence matrix must remain keyboard scrollable');
if (!research.includes('Add source URL') || !research.includes('aria-disabled="true"')) failures.push('research-board.html: missing truthful disabled source placeholder');

const prototype = fs.readFileSync(path.join(assetDir, 'prototype-shell.html'), 'utf8');
for (const requirement of ['@starting-style', "setAttribute('aria-current'", 'completeButton.disabled = true', "classList.add('is-visible'", 'id="item-form"', 'type="submit"', "addEventListener('submit'", 'event.preventDefault()', 'itemForm.requestSubmit()', 'in this prototype']) {
  if (!prototype.includes(requirement)) failures.push(`prototype-shell.html: missing ${requirement}`);
}
if (/saved[^\n]{0,80}locally/i.test(prototype) && !/localStorage/.test(prototype)) failures.push('prototype-shell.html: persistence message is not backed by storage');

for (const file of ['deck-stage.html', 'prototype-shell.html', 'motion-stage.html']) {
  const html = fs.readFileSync(path.join(assetDir, file), 'utf8');
  if (!html.includes('<noscript><style>')) failures.push(`${file}: missing readable no-script fallback`);
}

const evals = JSON.parse(fs.readFileSync(path.join(skillDir, 'evals', 'evals.json'), 'utf8'));
const evalIds = evals.evals.map(({ id }) => id);
if (new Set(evalIds).size !== evalIds.length) failures.push('evals/evals.json: duplicate eval id');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Validated ${htmlFiles.length} starters, shared runtime, ${scriptCount} inline scripts, ${scenes.length} motion scenes, and ${evalIds.length} evals.`);
