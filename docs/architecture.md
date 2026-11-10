# Architecture

Source review: 10 November 2026. This describes the current implementation, not a production-readiness certification. The versioned PLAN, DESIGN and BUILD documents describe requirements; historical milestone labels do not replace current end-to-end evidence.

## Stack and current boundaries

- Next.js 15.5 App Router, React 18, Node 24, deployed through Vercel Git integration.
- Supabase Auth, Postgres and Storage. The recovered preview uses the existing project; preview does not imply an isolated database. Use labelled synthetic records for testing.
- Server-side Anthropic generation, React-PDF rendering and Resend delivery.
- Trigger.dev task code exists separately. The interactive report flow below does not use Trigger or Supabase Realtime to stream drafts.
- MapLibre interactive maps with the authenticated OS raster proxy; user-selected OpenStreetMap base-map fallback. Static report maps remain a separate Mapbox integration.
- Sentry appears in the original build design but is not an installed dependency in this source snapshot. Runtime observability configuration needs verification.

## Deal persistence

The wizard loads a tenant-scoped deal. Edits update the local view and enter a serial, debounced save queue. Failed patches remain pending with an explicit retry. Navigation, sign-out, outline preview, generation and publishing wait for successful saves.

Database writes merge independent top-level JSON sections and require a matching non-deleted tenant record. Concurrent edits inside the same section can still overwrite each other. Pending edits are held in memory: closing/reloading a page while offline is not a durable offline draft workflow.

## Report flow

1. The wizard flushes pending deal edits.
2. `POST /api/deal/[id]/report-stream` authorizes the tenant and loads the deal. Five server-side narrative calls stream newline-delimited draft updates to the browser. The guarded client handles retry, fallback, budget and kill-switch checks.
3. The partner edits drafts in the wizard.
4. `publishReport` creates a version, records section audit entries, saves narratives and calls `generateAndStoreReport` inline.
5. React-PDF renders the report and stores it in Supabase Storage; the version becomes rendered or failed. A short-lived signed download URL is available to the partner.

The UI post-viewing gate is not sufficient server-side enforcement: the current generation/publish/share entry points still need the complete planned business prerequisites. The financial helpers and PDF also calculate some acquisition costs separately. Guided-inspection estimates are not yet the shared financial/report input. These are outstanding build items, not completed safeguards.

## Investor links

Share actions authorize the tenant and load its deal. Tokens are revocable and expiring, with hashed secrets persisted; default expiry is 90 days and the current actions also permit no expiry. Report links reference a rendered version. Public viewers use `/r/[token]` (report) and `/o/[id]` (outline, with the token in the path); opens/downloads are recorded. The current model should not be described as the original `/r/[id]/[token]` architecture or as verified section-level engagement analytics.

No client messages or report publishing are part of map verification.

## Interactive local due diligence

`DueDiligenceMap` is shared by Auto-Pull and Due Diligence. It uses the matching saved postcode coordinates or an authorized, read-only postcode lookup. The origin is explicitly approximate; a postcode point does not identify a building or legal title boundary.

- The same geodesic 1/3/5 km ring is drawn and submitted to the Police street-level source. Only the selected external layer is requested. Incidents retain their data month and retrieval timestamp and use anonymised locations.
- Saved amenity pins are filtered by actual straight-line distance; changing the map radius does not refresh the underlying amenity pull.
- The existing English IMD 2019 layer is labelled historical. Whole statistical areas intersecting the bounding box are displayed, which may extend beyond the ring. Transfer-limit responses are unavailable rather than complete coverage.
- Old results are discarded on location/radius/layer changes. Empty, loading and unavailable results are distinct; a retry is explicit. Readable evidence lists remain available if the map fails.
- Flood, planning, EPC and title-source statuses are shown separately. They are not fabricated overlays, completed reviews or property risk verdicts. Static report maps and saved public-data results are separate from on-demand map queries.
- No map clicks change assessment/sign-off status or persist a property finding. Capturing a reviewed evidence snapshot for reports remains future work.

Sources: [MapLibre](https://maplibre.org/maplibre-gl-js/docs/examples/display-a-popup-on-click/), [Police API coverage](https://data.police.uk/docs/method/crime-street/), [Postcodes.io](https://postcodes.io/docs/overview/), [OpenStreetMap tile policy](https://operations.osmfoundation.org/policies/tiles/).

## Access and release limitations

Server actions use active tenant membership and tenant-filtered queries. A membership-policy repair has been prepared and tested in disposable Postgres, but has not been applied to the hosted database. Full live RLS/role isolation and remaining security advisories require verification. Do not infer those from a successful sign-in or a passing unit suite.

Production domain availability, live report performance, five real-property pressure tests, investor qualification, current dataset activation and end-to-end delivery remain separate release checks. The draft recovery branch is a protected preview; production promotion and milestone closure remain human decisions.
