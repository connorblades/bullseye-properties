# bullseye-platform

The production code for the Bullseye Platform. First deployment: `BSE-RPT-P01` Standard Deal Report Generator.

This repo is the canonical implementation of the BUILD V1 spec. The prototype that informed every page lives at `../bullseye-portal/` and remains as the visual reference.

## Repo layout

```
bullseye-platform/
├── apps/
│   └── web/                             # Next.js 14 App Router app
├── packages/                            # shared types / claude prompts (added when needed)
├── supabase/
│   └── migrations/                      # Postgres migrations, forward-only
├── .github/
│   └── workflows/                       # CI
└── docs/                                # Handover artefacts (handover, runbook, architecture, maintenance)
```

## Reference documents

- [PLAN V1](../standard-deal-report-generator/docs/planning/BSE-RPT-P01-PLAN-V1.md) - approved
- [DESIGN V1](../standard-deal-report-generator/docs/planning/BSE-RPT-P01-DESIGN-V1.md) - approved
- [BUILD V1](../standard-deal-report-generator/docs/planning/BSE-RPT-P01-BUILD-V1.md) - approved (this is the operating manual)
- [STATUS](../standard-deal-report-generator/docs/planning/) - active (always read the latest dated file)

## First-time setup (when you wake up)

```bash
cd apps/web
pnpm install     # or npm install if you prefer
cp .env.example .env.local
# fill in env vars per .env.example - see the "Wiring" section below
pnpm dev
```

Open `http://localhost:3000`.

## Wiring (the cloud resources you need to create)

These are listed in BUILD V1 §9 M0 tickets. Each needs your credentials.

1. **Supabase project** (M0-T2): create `bullseye-platform-dev` in the London region. Paste the project URL and anon key into `.env.local`. Apply the migration at `supabase/migrations/0001_initial_schema.sql` via the Supabase CLI or Studio.
2. **Vercel project** (M0-T3): import this repo into Vercel under the `bullseye-properties` team. Add custom domain `app.bullseyeproperties.co.uk` via DNS CNAME.
3. **Resend account** (M0-T4 dep): create an account, verify the sender domain, paste the API key.
4. **Trigger.dev account** (M0-T6): create an account, create a project, paste the API key.
5. **Mapbox account** (M2 dep): get a public token, paste it.
6. **Anthropic API key** (M3 dep): use the existing Bullseye Anthropic org, paste the key.

See `apps/web/.env.example` for the full list of variables and where each comes from.

## Conventions

- Branch per milestone: `cb/m{N}-{theme}` (e.g. `cb/m0-foundation`).
- One PR per milestone.
- Commit prefix: `feat(#n):`, `fix(#n):`, `chore(#n):`, `docs(#n):` where `#n` is the GitHub issue number.
- Three-comment ticket close: "What was done", "How to check", then move to In Review.
- Co-authored commits when AI pairs with human contributor.
- STATUS file updated at milestone close, at AC-satisfying ticket close, weekly minimum.

## Status

M0 in progress. See [STATUS](../standard-deal-report-generator/docs/planning/) for the latest file.

## Owner

Connor Blades, Director, Bullseye Properties Ltd.

---

*Bullseye Properties Ltd · Confidential*
