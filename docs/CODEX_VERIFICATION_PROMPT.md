# LunarSprints: Codex Verification & Live Acceptance Prompt

Copy and paste the prompt below into Codex on your local machine after downloading `LunarSprints_Argon_Release.zip` to `~/Downloads/LunarSprints_Argon_Release.zip`:

---

## Prompt for Codex

```markdown
You are completing local verification, live acceptance testing, and workspace synchronization for the Gemini Argon continuation of LunarSprints (`~/Downloads/LunarSprints_Argon_Release.zip`).

### 1. Non-Negotiable Guardrails
- **Active Supabase backend**: Keep `NeoRishi-LifeOS-Final` (`jhkoxgyxrihsuhpjqkxc`). Never switch back to `gtlalozqlszaopajpfoz`, never run a whole-project `supabase db push` or `supabase db reset`, and never modify or drop non-`ls_*` tables, existing auth triggers, Google OAuth credentials, Resend SMTP settings, or existing redirect URLs.
- **Saved OpenAI Agents**: Reuse the exact 10 saved resource IDs in `config/agent-registry.json` inside OpenAI project `lunarsprints` (`proj_vI5AtNhbZISblXntDQZHNhZ1`). Never create duplicate agents or mutate remote saved-agent definitions.
- **Secret Hygiene**: Never print, log, or commit `.env.local`, `.env.test.local`, `SUPABASE_SECRET_KEY`, `OPENAI_API_KEY`, cookies, or bearer tokens.

### 2. Unpack & Inspect the Argon Release
1. Unpack `~/Downloads/LunarSprints_Argon_Release.zip` into `/Users/neorishi/Desktop/LunarSprints` without deleting `.env.local`, `.env.test.local`, or `node_modules`:
   ```bash
   unzip -o ~/Downloads/LunarSprints_Argon_Release.zip -d /Users/neorishi/Desktop/LunarSprints
   ```
2. Review the updated files:
   - `IMPLEMENTATION_STATUS.md` (reconciled Agent 10 live verification status + Agent 09 and Phase 4 status)
   - `src/features/lunarsprints/contracts.ts`, `agents/policies.ts`, `agents/managed.ts`, `domain.ts`, `coordinator.ts` (Agent 09 `adaptive_backlog` semantic replanning: `request_replan`, `edit_replan`, `reject_replan`, `approve_replan`, deterministic before/after diff across scope, dates, dependencies, and capacity, and completed-task preservation)
   - `src/features/lunarsprints/ui/board.tsx`, `ui/workspace.tsx`, `src/app/globals.css` (Adaptive replan composer, before/after diff viewer, inline proposal editor, request cancellation via `AbortController`, overloaded-day styling, portable JSON export, and sprint archive control)
   - `src/app/api/sprints/route.ts`, `src/lib/http.ts` (`request_replan` AI rate limit, `?export=1` JSON download, `DELETE /api/sprints?id=...` audit-safe sprint archiving/redaction, and `redactSensitive` error scrubbing)
   - `tests/domain.test.ts`, `tests/http.test.ts`, `scripts/evaluate-clarification.ts`, `scripts/replan-check.ts`, `docs/PUBLIC_RELEASE_HARDENING.md`

### 3. Run Offline Quality & Build Checks
In `/Users/neorishi/Desktop/LunarSprints` (using Node 22–24):
1. Run `npm run format` (if needed) and `npm run lint`: fix any ESLint/Prettier formatting issue if reported.
2. Run `npm run typecheck` (`next typegen && tsc --noEmit`): verify zero TypeScript errors.
3. Run `npm test` (`vitest run`): verify all 53 offline tests pass across `tests/domain.test.ts`, `tests/database.test.ts` (PGlite), `tests/http.test.ts`, and `tests/auth.test.ts`.
4. Run `npm run build` (`next build`): verify the production build succeeds cleanly.

### 4. Run Live Agent 09 (`adaptive_backlog`) & Clarification Acceptance Checks
With the local server running on `http://127.0.0.1:3000` against `.env.local`:
1. Ensure `.env.test.local` and `docs/evidence/end-to-end.json` have an active QA sprint on `NeoRishi-LifeOS-Final` (if needed, run `LUNARSPRINTS_E2E_RESUME=1 npm run test:e2e` or `npm run test:e2e` first).
2. Run `npm run test:replan` (`tsx --env-file=.env.local scripts/replan-check.ts`) to verify:
   - Live invocation of saved Agent 09 (`agent_3019f5aff3784a4bb0eb2d8eaf1a9811a540bb67f94e4a07a0`) via `request_replan`
   - Active stories and schedule remain unmutated while `pendingReplan` is pending
   - Already-completed (`done`) tasks are preserved
   - Browser renders the before/after diff panel with zero console/page errors (`docs/evidence/replan-diff-desktop.png`)
   - Forged approval hash is rejected with HTTP 409
   - Exact-hash `approve_replan` atomically updates the active sprint and records the `adaptive_backlog` run in `ls_agent_runs` (`docs/evidence/replan-acceptance.json`)
   - Portable JSON export (`GET /api/sprints?id=...&export=1`) succeeds
3. Run `npm run test:eval` (`tsx --env-file=.env.local scripts/evaluate-clarification.ts`) to verify all 8 clarification scenarios and update `docs/evidence/clarification-eval.json`.

### 5. Update Final Validation Receipt & Synchronize Delivery Locations
1. Update `docs/evidence/final-validation.json` with the new timestamp, offline test count (`53`), source SHA-256 fingerprint, and `"replan-acceptance.json"` in `liveEvidence`.
2. Synchronize the verified source tree and `docs/evidence/*` from `/Users/neorishi/Desktop/LunarSprints` to `/Users/neorishi/Documents/Codex/2026-10-28/you-are-responsible-for-transforming-my/outputs/lunarsprints` (excluding `.env*`, `node_modules`, `.next`).
3. Refresh `/Users/neorishi/Documents/Codex/2026-10-28/you-are-responsible-for-transforming-my/outputs/LunarSprints_Development_Release.zip` (excluding `.env*`, `node_modules`, `.next`) and verify `desktopDifferences` is empty.
4. Report the exact command outputs, test counts, and Agent 09 session/turn IDs from `docs/evidence/replan-acceptance.json`.
```
