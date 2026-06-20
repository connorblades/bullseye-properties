# Architecture

System overview, client-readable. For deep technical detail see BUILD V1.

## Stack

- **Frontend + API**: Next.js 14 App Router on Vercel
- **Database, Auth, Storage**: Supabase (single project per environment)
- **Background jobs**: Trigger.dev
- **AI**: Anthropic Claude API (Sonnet primary, Haiku fallback)
- **PDF**: React-PDF
- **Maps**: Mapbox Static Images API
- **Email**: Resend
- **Errors**: Sentry

## Data flow: report generation

```
Partner clicks Generate (Stage 14)
        ↓
Server Action validates + enqueues Trigger.dev task
        ↓
Trigger.dev task:
  - Fetches deal record from Supabase
  - Computes financials (mortgage scenarios, BRR, stress tests)
  - Fetches public data (HPI, crime, flood, amenities) - cached
  - Renders maps via Mapbox - cached
  - Fires 5 parallel Claude calls (Why-fits, Location, Condition, Offer, Next steps)
  - Streams tokens back via Supabase realtime channel
        ↓
Client subscribes to the channel; renders streaming sections in the wizard
        ↓
Partner edits sections in place; edits write back to deal record
        ↓
Partner clicks Publish:
  - Trigger.dev task renders React-PDF document
  - Uploads PDF to Supabase Storage (deal-packs bucket)
  - Writes deal_report_versions row
  - Writes claude_generations audit rows (one per section)
  - Marks task complete
        ↓
Client navigates to Stage 15 Deliver
```

## Data flow: investor share link

```
Partner sends share link (Stage 15)
        ↓
System generates signed URL with 90-day expiry, persists token
        ↓
Investor clicks link → /r/[id]/[token]
        ↓
Token middleware validates; renders read-only viewer
        ↓
Investor scrolls / downloads:
  - Page open event → share_link_events
  - Section-viewed event (50% intersection threshold) → share_link_events
  - PDF download event → share_link_events
        ↓
Partner dashboard subscribes to events via Supabase realtime; updates in real time
```

## Tenancy and access

- Every tenant-scoped table has a `tenant_id` column and RLS policies.
- M1 policies are permissive (any member of a tenant can read/write within it).
- M2 onwards: per-role policies (sourcer cannot delete; admin cannot read other tenants; etc.).
- The `auth_user_tenants()` Postgres helper returns the current user's accessible tenant IDs.

## External services - data residency and sub-processors

| Service | Region | Data sent | DPA |
| :---- | :---- | :---- | :---- |
| Vercel | UK / EU edge | App requests | Standard DPA |
| Supabase | London | All persistent data | Standard DPA |
| Anthropic | US infrastructure | Property details, comp inputs, criteria text (no email/phone/AML/financial-history per data-minimisation rule) | SCC + DPA |
| Resend | US | Email recipient address, magic link | Standard DPA |
| Trigger.dev | EU | Task payloads (same data as Supabase) | Standard DPA |
| Mapbox | US/EU | Coordinates only | Standard DPA |
| Sentry | EU | Error stack traces (PII scrubbed) | Standard DPA |

## Versioning

- PLAN, DESIGN, BUILD: new file per signed version (V1, V2, ...).
- STATUS: single file per project at any time; filename's date is the most recent update.
- Postgres migrations: forward-only, never edit a shipped migration.

---

*Bullseye Properties Ltd · Confidential*
