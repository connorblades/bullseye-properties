# Handover

Operating manual for the Bullseye Platform. Owned by Connor Blades.

## What this system is

A Next.js 14 application on Vercel, backed by Supabase, that produces Bullseye-branded Standard Deal Reports. First deployment: `BSE-RPT-P01`.

Reference documents:
- `BSE-RPT-P01-PLAN-V1` - what we are building and why
- `BSE-RPT-P01-DESIGN-V1` - what it looks like
- `BSE-RPT-P01-BUILD-V1` - how it gets built (operating manual for the code)
- `BSE-RPT-P01-STATUS-{date}` - living progress

## Running it locally

```bash
cd apps/web
pnpm install
cp .env.example .env.local
# fill in env vars
pnpm dev
```

Open `http://localhost:3000`.

## Deploying

Vercel does this automatically on push to `main`. Preview deploys land on every PR.

Manual deploy: `vercel --prod` from the project root (requires `vercel login`).

## Cloud services

- **Vercel**: app hosting. Custom domain `app.bullseyeproperties.co.uk`.
- **Supabase**: Postgres, Auth, Storage. London region. Project `bullseye-platform-{env}`.
- **Anthropic**: Claude API. Monthly spend cap £300.
- **Resend**: transactional email. Sender `noreply@app.bullseyeproperties.co.uk`.
- **Trigger.dev**: background jobs.
- **Mapbox**: static map images.
- **Sentry**: error monitoring.

## Routine maintenance

See `maintenance.md` for the monthly checklist.

## Incident response

See `runbook.md` for the playbooks per failure mode.

## Architecture

See `architecture.md` for the system diagram and data flow.

---

*Bullseye Properties Ltd · Confidential*
