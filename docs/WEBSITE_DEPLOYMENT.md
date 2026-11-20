# Website deployment

## Hosting target

Use a new Vercel project named `lunar-sprints` connected to `NeoRishi/lunar-sprints`. Framework: Next.js; root: repository root; Node: 22 or 24; install: `npm ci`; build: `npm run build`; default output. `vercel.json` selects Tokyo (`hnd1`) near the approved Supabase region. Do not reuse or overwrite older LunarSprints hosting projects implicitly.

GitHub Pages is a static host and cannot run this application's server APIs. The local `npm start` command binds to loopback deliberately; a generic Node/container host must configure its externally reachable listener separately. Vercel uses its Next.js adapter instead of that local start command.

## Environment configuration

`.env.example` contains names only. Configure real values privately in the hosting environment. Do not upload environment files to GitHub or paste credentials into chat.

| Variable | Purpose |
| --- | --- |
| NEXT_PUBLIC_SUPABASE_URL | Approved LifeOS project URL; verify project ref jhkoxgyxrihsuhpjqkxc |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | Existing public Supabase client key |
| SUPABASE_SECRET_KEY | Server-only Supabase secret; never expose to the browser |
| OPENAI_API_KEY | Server-only credential authorized for the existing OpenAI project |
| OPENAI_PROJECT_ID | proj_vI5AtNhbZISblXntDQZHNhZ1 |
| OPENAI_SMART_MODEL | Keep the verified configured override, gpt-6-sol |
| OPENAI_STORY_MODEL | Optional; default gpt-6.1-sol |
| APP_ORIGIN | Exact HTTPS website origin; avoid localhost values on a website |
| DEPLOYMENT_VERSION | Optional; the config falls back to Vercel's commit SHA |
| LUNARSPRINTS_DIAGNOSTICS | Optional; keep disabled unless scoped diagnostics are needed |

If APP_ORIGIN is set, it must match the origin actually used by the browser. A fixed origin on an arbitrary preview URL will correctly reject writes. Use a stable protected preview alias or a correctly scoped environment override for preview testing. New NEXT_PUBLIC values require a fresh build.

## Authentication and shared backend

After choosing the exact website hostname, inspect LifeOS's redirect allowlist. If absent, append only `https://<chosen-host>/auth/callback` through an approved scoped Auth setting change. Preserve every existing redirect, the existing Site URL, Google OAuth credentials, Auth triggers and Resend SMTP configuration. Recovery is routed by the existing callback implementation. Do not replace the shared Site URL with a test host.

No database migration is needed merely to host the current verified P2 code. Do not run `supabase db push` or `supabase db reset`. Reuse existing `ls_*` schema and ten saved OpenAI resources unchanged.

## Release acceptance

1. Run lint, typecheck, all offline tests and production build on the exact candidate commit.
2. Deploy a protected preview. Check the homepage, static assets and security headers; confirm `/health` returns `{"ok": true}`. It only checks that database and AI credentials are configured, not full readiness, and deliberately reveals no project identifiers. Set `APP_ORIGIN` to the public HTTPS address; production refuses to build sign-in links from the Host header.
3. Confirm unauthenticated sprint reads/writes are rejected and a forged Origin gets HTTP 403.
4. Test Google sign-in and email/recovery using an authorized account and the exact host. Check mobile and microphone consent; text remains available.
5. Run a scoped synthetic real planning journey, reload/persistence, task updates, approval hashes and replan against the candidate. Test provider timeout/recovery and inspect redacted logs. Do not run old acceptance scripts unchanged against an arbitrary public URL.
6. Public production promotion requires explicit owner approval and the remaining operational/privacy/cost gates in PUBLIC_RELEASE_HARDENING.md. Configure spending limits and monitoring before broad traffic. Billing and VedicAstroAPI remain future integrations.

## Rollback

Preserve the prior hosting deployment and source commit. Roll back the application deployment if acceptance fails; do not reset the shared database. Keep the Desktop P2 copy and original development archive as the local reference.
