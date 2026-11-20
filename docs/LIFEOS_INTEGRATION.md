# NeoRishi LifeOS integration

> **Not part of the buildathon build.** LifeOS shared login is not used in this repository. Since Step 2A, sign-in is Firebase Authentication and the data lives in PostgreSQL (see [`GEMINI.md`](../GEMINI.md)). This file is kept only as a record of the earlier integration on the original product.

The current local LunarSprints application uses **NeoRishi-LifeOS-Final**, project `jhkoxgyxrihsuhpjqkxc`, in the existing Pro organization. The integration was authorized by the user on October 28, 2026. No application was published or promoted to production.

## Existing platform reused

- Existing Supabase Auth users and their Google/email identities. The reported account already exists and is confirmed in LifeOS.
- Existing Google OAuth configuration, with no new Google client or additional Google data scopes.
- Existing enabled Resend SMTP configuration (`smtp.resend.com`, port 465), sender and encrypted credentials. The confirmation template uses `{{ .ConfirmationURL }}` and was left unchanged.
- Existing profile-creation trigger. The new application does not create a second profile system or import profile/health/birth data into agent context.
- The AI setup of that time was left unchanged. The Supabase switch did not create or replace any AI agents. (That AI setup was later removed in Step 1 of the buildathon migration; see `GEMINI.md`.)

## Changes made

The two previously tested additive migrations create six isolated `ls_*` tables plus `ls_commit` and `ls_claim_rate`. Both source versions are registered in LifeOS migration history. New tables have RLS; authenticated clients cannot directly insert/update aggregates or call the commit function. The service role appends audit/idempotency history but cannot update/delete/truncate that history.

The app's approved local environment files now hold the existing LifeOS connection values. No keys were printed, created or rotated. A private rollback record contains only the previous Supabase connection; AI credentials were left in their approved files.

Only `http://127.0.0.1:3000/auth/callback` was added to the authentication redirect allowlist. The existing 17 entries and `https://www.neorishi.io` site URL remain. Google selection uses PKCE/S256 with an HttpOnly SameSite cookie, validates the returned provider URL, and uses the existing Supabase Google callback. Recovery links continue to use the exact local callback. LifeOS's stronger password rules and 72-byte maximum were retained; test credentials and password guidance were adjusted to comply.

## Existing data preserved

Preflight inspected 102 public tables, including 18 legacy `lunar_sprints` rows and 60 legacy `tasks` rows. No existing table, policy, trigger or business row was changed by the schema migration. Live acceptance tests add explicitly marked synthetic auth users and the normal platform-managed registration records. Synthetic sprint data is stored in `ls_*` tables. Existing real user records are preserved.

Dev-V1 contained five synthetic QA sprints and **zero real user sprint drafts**. No user-data transfer or password migration was needed. That project was not deleted, paused or modified as a cleanup step. A Dev-V1 password-reset email changes only a Dev-V1 account; use the existing LifeOS login here.

## Verification and boundaries

The LifeOS evidence files record the actual running project ref, existing Google authorization gateway, exact callback, protected PKCE cookies, real-agent planning through board activation, owner isolation, and final test/build checks. Google account selection and any credential entry belong to the user; a successful authorization-gateway check does not claim to complete personal Google consent.

The existing advisor baseline includes unrelated function-execution warnings and RLS-without-policy information. These shared application permissions were preserved. Compare `lifeos-security-baseline.json` and `lifeos-security-final.json`; remediation references are included in those files. No new security-definer function was added. Two new informational RLS-without-policy entries identify `ls_commands` and `ls_rate_limits`; these are intentionally server-only, with all client table privileges revoked and RLS denying direct client access. No new WARN or ERROR advisory was introduced.

Do not run whole-project `supabase db push` from this feature-only migration directory. LifeOS has an existing migration history managed by other applications; coordinate future shared-schema changes with that owning repository. Current evidence and historical Dev-V1 evidence are kept separately.

Public-domain release verification, retention/deletion operations, load/abuse testing and the already documented later agent phases remain release work. Production deployment still requires separate user approval.
