---
name: ui-quality
description: Visual quality rules for LunarSprints screens and pages. Use before writing or reviewing any .tsx, .css or CSS module change that affects what a user sees.
---

# UI quality (Moonlit)

Adapted from the "Floor" rules of Hallmark v2.0.0 (MIT, https://github.com/nutlope/hallmark). Reworded for this repo; see `docs/THIRD_PARTY_NOTICES.md`. Hallmark's themes, page builder, photo library and hooks are deliberately not used: LunarSprints already has its own visual direction.

## The direction

Moonlit: a dark night ground, moonlight text, one soft gold accent, thin serif headlines, minimal. Calm and quiet, never decorative. Reality first: the lunar layer is secondary and must never look like live data unless it is.

## Hard rules (never ship)

1. **Tokens only.** Every colour and font comes from the custom properties in `src/app/globals.css` `:root` (`--bg`, `--surface*`, `--ink*`, `--muted`, `--line*`, `--accent*`, `--good*`, `--warn*`, `--danger*`, `--serif`, `--sans`). No new hex, `rgb()` or `font-family` values outside that block. Need a new value? Add a token first.
2. **One accent.** Gold (`--accent`) marks the single most important action or state on a screen. Never two gold buttons side by side. No gradients, glows, glass or blobs.
3. **Motion.** Never `transition: all`. Animate only `transform` and `opacity`. Every animation has a `prefers-reduced-motion: reduce` fallback, and content is visible without JavaScript.
4. **Focus.** Every interactive element has a visible `:focus-visible` style that appears instantly.
5. **Honest content.** Never an invented metric, testimonial, user count, logo wall or case study. Illustrations that look like data (moon phases, day counters) say visibly that they are examples.
6. **No template tells:**
   * no eyebrow line above a heading
   * no labels in tracked capitals or small caps (labels, captions, table heads and tags use the body face, a step smaller, sentence case)
   * no single italic or coloured word inside a heading
   * no strings of meta joined by middle dots ("Voice or text · editable")
   * no arrows glued to link text
   * no emoji used as icons
   * no card inside a card
   * no numbered "01 02 03" step rows by default
7. **Layout.**
   * `overflow-x: clip` (not `hidden`, never `100vw`) on the page.
   * Grid tracks that hold media use `minmax(0, 1fr)`.
   * Long headings wrap (`overflow-wrap: break-word; min-width: 0`).
   * Content width is capped and centred; on wide screens the gutters grow, the text measure does not.
8. **Above the fold.** On the landing page, the headline, one sentence and the primary action are visible at 1280 x 800 without scrolling.
9. **Words per screen.** About 80 words on any one screen of the marketing site. Say less, set it larger.

## Consistency rules (fix when touched)

* Use one spacing scale and one type scale. Today `globals.css` has 15 radii, 26 font sizes and about 70 padding values; new code must reuse existing values, and cleanup batches should collapse them into tokens.
* Body text is 16px in both the app and the marketing site.
* One primary button style, one container width, one radius per nesting level.

## Before handing back UI work

1. Check each hard rule above against the diff.
2. Run `npm test` (the copy guard catches em-dashes and on-screen jargon).
3. Look at the change at 375px and 1280px wide.
4. Read `.claude/skills/copy-quality/SKILL.md` for every visible string you added.
