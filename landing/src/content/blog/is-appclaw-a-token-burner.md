---
title: 'Is AppClaw a token burner? A straight answer on cost'
description: "The honest worry: if an LLM drives every step, every run costs money. It doesn't have to. Here's what actually happens behind each step, why the model in DOM mode only parses language and never sees the screen, and how AppClaw caches and heals locators so repeat runs skip it entirely."
date: 2026-07-11
author: 'AppClaw'
category: 'engineering'
tags: ['cost', 'context-engineering', 'locators', 'caching']
---

A fair question keeps coming up, and it deserves a direct answer rather than a
defensive one: _if AppClaw sends the screen to an LLM on every step, isn't it the
most expensive way to test? Aren't you just building a token burner?_

If AppClaw worked the way that worry assumes, the worry would be right. Sending
the whole screen to a frontier model on every tap of every run would be slow and
costly. So that isn't what happens. It's worth walking through what an
`app.run()` step actually does under the hood, because the cost answer lives in
the details.

## What actually happens on a step

The SDK is the first-class way to use AppClaw. You write plain steps in your
normal test file:

```ts
import { AppClaw } from '@appclaw/core';

const app = new AppClaw({ provider: 'anthropic', apiKey: process.env.KEY, locatorCache: true });

await app.run('open YouTube');
await app.run('tap Search');
await app.run('type "Appium"');
await app.verify('results are visible');

await app.teardown();
```

Each `app.run()` runs in two phases: first understand the phrase into a typed
step (`tap Search button` becomes `{ kind: "tap", label: "Search button" }`), then
locate that element on the device. The model can only ever appear in the first
phase, and only when the regex can't parse the phrase. Locating the element is
always deterministic.

<figure class="pipeline">
  <span class="pl-end"><span class="pp">$</span> app.run("tap Search button")</span>
  <div class="conn"></div>
  <div class="stages">
    <div class="pl-phase">Understand · phrase → typed step</div>
    <div class="pl-stage">
      <span class="pl-n">1</span>
      <div class="pl-b"><b>Regex fast-path</b><span>Parses common phrasings (tap, type, swipe, wait) into a step.</span></div>
      <span class="pl-exit free">match · no LLM</span>
    </div>
    <div class="pl-stage">
      <span class="pl-n">2</span>
      <div class="pl-b"><b>LLM intent parse</b><span>Only when regex can't. Sees your sentence and a fixed rulebook. No page source, no screenshot.</span></div>
      <span class="pl-exit model">model · no screen</span>
    </div>
    <div class="pl-phase">Locate · typed step → element (deterministic)</div>
    <div class="pl-stage">
      <span class="pl-n">3</span>
      <div class="pl-b"><b>Locator cache</b><span>Reuses a known (strategy, selector) via one findElement lookup.</span></div>
      <span class="pl-exit free">hit · no LLM</span>
    </div>
    <div class="pl-stage">
      <span class="pl-n">4</span>
      <div class="pl-b"><b>DOM scoring</b><span>Text match + clickable preference + proximity picks the node, then caches the winner.</span></div>
      <span class="pl-exit free">score · no LLM</span>
    </div>
  </div>
  <div class="conn"></div>
  <span class="pl-end out">execute on device</span>
  <figcaption>The model appears only at step 2, only when regex can't parse the phrase, and never sees the screen.</figcaption>
</figure>

In DOM mode `app.verify()` is a device-state check, not a model call: it reads the
page source for your text, and spatial claims like "X is below Y" are decided
geometrically. Waiting for an element to appear is a plain poll. Neither spends
tokens. The one honest caveat: if you've also configured a vision provider and the
text isn't in the page source, verify escalates to a single screenshot-based visual
confirmation before failing — and in vision mode that visual check is the default.
That's a deliberate accuracy fallback, not a per-tap tax.

## Context engineering: in DOM mode, the model never sees the screen

Here's the part that surprises people. When a step does reach the model in DOM
mode, the model is **screen-blind**. It does not receive the page source, and it
does not receive a screenshot. Its entire input is your sentence plus a fixed,
roughly one-kilobyte rulebook that maps phrasings to step kinds ("tap/press/select
becomes a tap," proximity rules, and so on).

Its whole job is to translate language into a typed step:

```
"tap the search button up top"  →  { kind: "tap", label: "search button" }
```

That's it. Tens to low-hundreds of tokens in, a tiny JSON object out, with model
thinking disabled for speed. The model does language understanding, not element
selection.

Selection is the deterministic phase. AppClaw reads the page source once, then
scores every element against the label: normalized text match (case and spacing
folded), a small preference for clickable elements so a button wins over a stray
text node, and, when your instruction positions the target relative to something
else, a spatial ranking against that anchor. The best-scoring node wins. No model
is consulted to make that choice.

The heavier context-engineering machinery, the DOM trimmer that compacts a 50 KB
page source down to 3 to 8 KB of only the actionable elements, exists for the
paths where a model genuinely does read the screen: the autonomous goal-solving
agent and vision mode on custom-rendered UI. A scripted `app.run()` in DOM mode
doesn't take that path, and doesn't pay for it.

## Caching locators: pay once, reuse forever

The first time a step resolves an element, AppClaw does the real work: read the
page source, parse it, score candidates, probe strategies, and find the element
you meant. That work produces a `(strategy, selector)` pair that located the
target.

With the locator cache on, that pair is saved, keyed by app, screen fingerprint,
action, and label. The next time the same step runs on the same screen, AppClaw
looks up the pair and goes straight to a single `findElement` call. No page-source
fetch, no DOM parse, no scoring, no probe, and no model. The step reports a cache
hit and moves on.

It caches the selector, never the raw element handle, because handles are
per-session and change every run, while a good selector keeps working across
sessions. The cache lives at `~/.appclaw/locator-cache.json` and is shared across
every `run()` in a suite, so a warm cache makes an entire regression pass resolve
elements without touching the model.

Here's the same `tap Search button` the second time it runs on that screen. The
phrase still parses on the free regex path, but the whole locate phase collapses
into one lookup:

<figure class="pipeline warm">
  <span class="pl-end"><span class="pp">$</span> app.run("tap Search button")<span class="pl-tag">run #2 · same screen</span></span>
  <div class="conn"></div>
  <div class="stages">
    <div class="pl-phase">Understand · phrase → typed step</div>
    <div class="pl-stage">
      <span class="pl-n">1</span>
      <div class="pl-b"><b>Regex fast-path</b><span>Same as run #1: parses the phrase into a step, no LLM.</span></div>
      <span class="pl-exit free">match · no LLM</span>
    </div>
    <div class="pl-phase">Locate · typed step → element</div>
    <div class="pl-stage">
      <span class="pl-n warm">3</span>
      <div class="pl-b"><b>Locator cache</b><span>The (strategy, selector) saved on run #1 is found for this label and screen.</span></div>
      <span class="pl-exit hit">HIT · one findElement</span>
    </div>
    <div class="pl-stage skip">
      <span class="pl-n">4</span>
      <div class="pl-b"><b>DOM scoring</b><span>Skipped entirely: no page-source fetch, no parse, no scoring.</span></div>
      <span class="pl-exit skipped">skipped</span>
    </div>
  </div>
  <div class="conn"></div>
  <span class="pl-end out">execute on device</span>
  <figcaption>Run #1 cached the winner, so run #2 is a single lookup. No scoring, no model.</figcaption>
</figure>

## Healing locators: drift costs one re-resolution, not a re-run

Apps change. A cached selector that worked last week can stop matching. The naive
outcomes are the two everyone fears: the test hard-fails, or the tool falls back
to burning tokens on every run forever. AppClaw does neither.

When a cached locator misses, the step quietly falls back to the full resolution
path (score and probe the current screen), finds the element again, and
**overwrites the stale entry in place** with the fresh winner. The next run is
back to a clean cache hit. One re-resolution, then cheap again.

Each entry also carries a confidence score that keeps the cache honest:

- It **decays with age**, halving roughly every 30 days, so nothing trusts a very
  old selector blindly.
- It **drops on failure** and tracks a hit-to-miss reliability ratio, so a flaky
  locator steadily loses trust.
- Once effective confidence falls below a floor, the entry is **evicted**, so dead
  locators stop mispredicting.

The result is a cache that heals toward whatever the app currently looks like,
instead of decaying into a source of flakiness. Layout drift is a one-step cost,
not a reason to keep the model in the loop.

## What a run actually costs

Put the three together and the cost model isn't "every run costs money." It's:

- **Unusual phrasing:** possibly one small intent-parse call to turn the sentence
  into a typed step, a short prompt with no DOM attached. Common phrasings skip
  even this via the regex fast-path.
- **Every run:** the element is located deterministically by cache or scoring, so
  a regression pass is close to, and frequently exactly, zero tokens.
- **When the app changes:** one re-resolution to heal the affected locators, then
  cheap again.

That is the opposite of a token burner. The model, when it runs at all, does a
small language task on a tiny prompt, and the element work is deterministic,
cached, and self-repairing.

## The mental model

The mistake is treating the model as a tax on every tap. It isn't. In DOM mode the
model only ever parses language, never the screen; the locator cache removes it
from the common case entirely; and healing keeps that cache pointed at the app as
it is today. You reach for intelligence when the phrasing or the screen genuinely
surprises you, and glide on cached, deterministic lookups when it doesn't.

That's the reliable version of AI mobile testing, and it's the version the AppClaw
SDK is built to give you.
