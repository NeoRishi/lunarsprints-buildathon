---
name: copy-quality
description: Plain-language and honesty rules for every word a LunarSprints user, reviewer or owner reads. Use when writing or reviewing UI text, error messages, emails, docs, commit messages or PR descriptions.
---

# Copy quality

LunarSprints answers one question: "Given my goals, deadlines, capacity and commitments, what deserves my attention today?" Every sentence should help with that, in words a busy founder understands on first read.

## Hard rules

1. **No em-dashes**, anywhere: UI, code comments, docs, commits and PR text. Use a colon, comma, full stop or parentheses. `npm test` enforces this (`tests/copy-guard.test.ts`).
2. **No internal words on screen.** Use the plain word instead:

   | Do not show | Say instead |
   |---|---|
   | SMART, SMART goal | goal, clear goal |
   | Definition of Done | Done means |
   | story, stories | milestone, milestones |
   | task, subtask | step, steps |
   | semantic replan, replan | Adjust the plan |
   | diff | what changes, before and after |
   | agent, orchestrator, specialist, any agent name | (nothing: the user talks to LunarSprints) |
   | validated, invariant, payload | checked, (leave out) |

   The copy guard checks visible `.tsx` text for SMART, Definition of Done, semantic replan, agent names, diff and story. "Task" is not checked automatically yet; catch it in review.
3. **No hype or filler.** Not: seamless, effortless, unlock, supercharge, empower, revolutionary, game-changing, cutting-edge, AI-powered, elevate, delve, leverage, next-level, world-class, magic. Also avoid "journey", "deserve", "meaningful", and two-fragment slogans ("Small steps. Real progress.").
4. **Honest claims only.**
   * No invented testimonials, ratings, user counts or logos.
   * No promise the product does not keep today.
   * Pricing and limits come from `config/plans.json`, never hard-coded.
   * "Coming soon" features are labelled as such.
   * If you find a claim you cannot verify, flag it by name and propose an honest replacement.
5. **Reality before lunar context.** Lunar words (paksha, Pratipada, Purnima, Amavasya) are supporting context, never the main promise, and never fake data.
6. **Plain English for an Indian-first, worldwide audience.**
   * Short sentences, active voice, no idioms that do not translate.
   * Use ₹ for prices.
   * Write dates as "5 November 2026".

## Tone

Calm, direct and kind. Never shame missed work. Errors say what happened, what is safe, and what to do next, for example: "That did not save. Your last plan is unchanged. Try again."

## Review checklist

* Would a first-time user understand every word without help?
* Is every claim true today, and checkable?
* Could any sentence be cut without losing meaning? Cut it.
* No em-dashes? Run `npm test`.
