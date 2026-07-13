---
title: 'Say what you mean: why plain English beats brittle selectors'
description: 'Selectors describe how an app is built. Instructions describe what you want. AppClaw closes the gap by resolving intent on the live screen instead of matching a fixed path.'
date: 2026-06-18
author: 'AppClaw'
category: 'product'
tags: ['locators', 'intent', 'authoring']
---

Every flaky mobile test has the same root cause. Somewhere, a script names an
element by how the app was built (a resource id, an XPath, an
accessibility label three layers deep) and one day the app is built a little
differently. The element is still right there on the screen. The test can't find
it.

AppClaw takes the opposite starting point. You describe the element the way a
person would point at it, and the agent resolves that intent against whatever is
actually on the screen right now.

## The problem with a path

A selector like `//android.widget.Button[@resource-id="com.app:id/btn_primary"]`
is a path through a tree that only exists because someone wired it that way. It
carries no meaning about what the button _does_. Rename the id, wrap it in one
more container, ship an A/B variant, and the path breaks, even though nothing a
user would notice has changed.

Worse, paths are ambiguous in the ways that matter and precise in the ways that
don't. A screen with a "Login" button and a "Log in" text link has two perfectly
valid matches for the word _login_, and the selector that disambiguates them is
exactly the one most likely to break.

## Describe it the way you'd point at it

AppClaw lets you name the target by its relationship to something stable:

```
tap login button below the password field
```

There's no id in that sentence, and there doesn't need to be. The agent reads
the screen, finds the password field as an anchor, and resolves the button
_geometrically_, the one below it, the same way you would if you were looking
over someone's shoulder. `below`, `above`, `left of`, `right of`, `near`, and
`within` all work as spatial anchors.

When the accessibility tree is missing entirely (Canvas, Flutter, games,
custom-rendered UI) the same instruction falls through to AI vision on the raw
screenshot. The instruction doesn't change. Only how the agent sees does.

## Intent survives redesigns

The quiet payoff is durability. A plain-English step encodes the _goal_, and
goals change far less often than layouts. "Turn on Wi-Fi" is true across every
Android skin and iOS version; the selector that accomplishes it is different on
each. When you author against intent, a redesign that keeps the feature keeps
your test.

This is the whole thesis behind AppClaw: automation is shifting from brittle
scripts to agents that understand. You bring the intent. The agent handles the
path.
