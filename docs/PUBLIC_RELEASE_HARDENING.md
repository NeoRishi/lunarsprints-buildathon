# LunarSprints Public-Release Hardening & Pre-Deployment Plan

Status: **Outdated. Do not follow.** Written for the previous hosted database and sign-in provider, which Step 2A replaced with Firebase Authentication and PostgreSQL. It will be rewritten for Cloud Run and Cloud SQL in Step 2B. Kept as a record.

This document defines the operational, privacy, security, and shared-project configuration requirements before exposing LunarSprints on a public domain alongside the existing `NeoRishi-LifeOS-Final` (`jhkoxgyxrihsuhpjqkxc`) Supabase project.

---

## 1. Shared Supabase Project Boundaries (`NeoRishi-LifeOS-Final`)

LunarSprints shares `NeoRishi-LifeOS-Final` (`jhkoxgyxrihsuhpjqkxc`) with existing LifeOS tables and authentication providers.

- **Table Isolation**: All LunarSprints tables and RPCs are prefixed with `ls_` (`ls_sprints`, `ls_revisions`, `ls_commands`, `ls_events`, `ls_agent_runs`, `ls_rate_limits`, `ls_commit`, `ls_claim_rate`, `ls_append_only_guard`).
- **Migration Safety**:
  - Never run a whole-project `supabase db push`, `supabase db reset`, or destructive DDL against non-`ls_*` tables.
  - Keep `20261027192301_lunarsprints_planning.sql` and `20261028042653_lunarsprints_audit_immutability.sql` immutable. Any future schema change must be an additive timestamped migration targeting only `ls_*` objects.
- **Auth & Trigger Compatibility**:
  - Existing `auth.users` triggers (such as `handle_new_user`), Google OAuth credentials, Resend SMTP settings, `site_url` (`https://www.neorishi.io`), and the 17 existing `uri_allow_list` entries must remain untouched.

---

## 2. Public-Domain OAuth, Email & HTTPS Cutover Plan

When deploying LunarSprints to a public HTTPS origin (for example `https://sprints.neorishi.io` or `https://www.neorishi.io`):

1. **Environment Variables (Production Server)**:
   - `APP_ORIGIN=https://<production-host>` (pins `requestOrigin()` and `sameOrigin()` CSRF validation behind reverse proxies/CDNs).
   - `NEXT_PUBLIC_SUPABASE_URL=https://jhkoxgyxrihsuhpjqkxc.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-key>`
   - `SUPABASE_SECRET_KEY=<service-role-secret-key>` (server-only; never exposed to `NEXT_PUBLIC_*` or client bundles).
   - AI service variables: none while no AI engine is connected (buildathon Step 1). The agent service settings arrive in Step 3; see `GEMINI.md`.
2. **Supabase Auth Allowlist Update (Additive Only)**:
   - Append the exact production callback URLs to `uri_allow_list` without removing any existing entries:
     - `https://<production-host>/auth/callback`
     - `https://<production-host>/account/reset-password`
   - Preserve all existing redirect URLs. Any future removal requires separate explicit approval from the shared project owner.
3. **Resend SMTP & Email Verification**:
   - Verify SPF, DKIM, and DMARC records on the sending domain configured in Resend before public traffic.
   - Run a single synthetic password-reset and signup-confirmation delivery check on the production origin to confirm PKCE code exchange on `https://<production-host>/auth/callback`.

---

## 3. Data Retention, Portability & Deletion Operations

1. **User-Initiated Data Portability (`GET /api/sprints?id=<uuid>&export=1`)**:
   - Authenticated users can download a complete JSON archive (`schemaVersion: "1.0"`, `exportedAt`, `sprint`, `hashes`, `capacity`) of any owned sprint directly from the workspace header or API.
2. **User-Initiated Sprint Archiving & Redaction (`DELETE /api/sprints?id=<uuid>`)**:
   - Because `ls_revisions` and `ls_events` enforce append-only audit immutability via the `ls_append_only_guard()` trigger (`20261028042653_lunarsprints_audit_immutability.sql`), runtime user deletion archives the sprint via `ls_commit` (`archivedAt` timestamp set, active `intention`, `originalIntention`, `intentionHistory`, and `notes` scrubbed to `"[Archived]"`, and hidden from `GET /api/sprints` and `GET /api/sprints?id=...`) while preserving cryptographic revision integrity.
3. **Full erasure is not implemented or verified**:
   - Archiving hides a sprint through the application API and clears selected intention fields only. Goals, stories, answers, task notes, agent sessions, command results and immutable revisions can still retain personal content. Do not describe this as complete redaction or erasure.
   - A future erasure procedure needs explicit owner approval, a complete inventory of retained copies, scoped authorization, backup/retention policy and verification. Do not disable audit triggers or execute destructive SQL from this document.
   - Audio processing uses memory in the application; this does not make a claim about provider-side retention. Verify provider data controls before public release.

---

## 4. Spend Controls, Rate Limiting & Observability

1. **Database-Backed Rate Limits (`public.ls_claim_rate`)**:
   - `commands` bucket: max `90` mutating commands per `300` seconds per user.
   - `ai` bucket: max `30` AI commands (some commands invoke multiple specialists) (`assess`, `select_intents`, `synthesize`, `regenerate_goals`, `generate_stories`, `schedule`, `request_replan`, `next_action`, `reflect`) per `3600` seconds per user.
   - `voice` bucket: unused while voice input is off (buildathon Step 1).
2. **Bounded Timeouts & Cancellation**:
   - `story_decomposer`, `adaptive_backlog`, and multi-intent `smart_goal` sessions enforce a `180,000 ms` timeout; ordinary calls enforce a `90,000 ms` timeout. Complex clarification fixtures hit the shorter deadline during verification; the same model/resource is retained with a longer bounded wait.
   - Unfinished remote turns trigger best-effort `agent.session.input.cancel` events, and the UI can stop waiting, but disconnecting the observer does not guarantee remote cancellation or prevent a server commit. Refresh/retry with the original idempotency key to reconcile the outcome.
3. **Provider Spend Cap**:
   - No dollar cap was configured or proven by this release. When the new agent service is connected, set budget alerts and quota limits on its cloud project and verify whether each control is enforced or advisory.
4. **Error & Log Redaction (`redactSensitive`)**:
   - `src/lib/http.ts` scrubs `Bearer` tokens, `sk-*` / `sb_*` / `re_*` API keys, JWTs, and `Cookie` / `Authorization` headers before returning HTTP error payloads or writing diagnostic logs.
