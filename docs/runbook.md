# Runbook

Incident playbooks. One per failure mode.

Owner: Connor Blades. On-call: same person. Escalation: none external.

## Playbook: Anthropic API down or rate-limited (429 / 529)

**Symptom:** Report generation fails or hangs at the "Drafting narrative sections..." stage. Sentry errors mention `anthropic` or `529`.

**Expected automatic behaviour:** the retry middleware backs off and switches Sonnet to Haiku on the second retry. The UI shows a banner: "AI service degraded - drafts may need extra review."

**If retries exhaust:** the UI activates the manual-draft fallback. The partner can draft the five narrative sections by hand and continue to PDF compile.

**Manual diagnostic:**
1. Check [Anthropic status page](https://status.anthropic.com/).
2. If incident confirmed, communicate to any in-flight partner: "AI drafting paused; please use the manual fallback."
3. Wait for upstream resolution; no action on our side.

**If Anthropic is up but we are still 429ing:**
- Check `ai_cost_ledger` table for spike usage.
- Check `CLAUDE_DISABLE` env var; if accidentally `true`, set to `false` in Vercel and redeploy.
- Check Anthropic console for rate-limit tier; request Tier 3 if persistent.

---

## Playbook: Supabase down

**Symptom:** App returns 500 errors on every authenticated route. Sentry mentions `supabase` or `PostgrestError`.

**Expected automatic behaviour:** none. Supabase is the single backend; if it is down, the app is down.

**Manual diagnostic:**
1. Check [Supabase status page](https://status.supabase.com/).
2. If incident, comms to partners: "Platform temporarily unavailable. ETA via status page."
3. Verify backups are running (Settings > Database > Backups).

**Recovery:** wait for upstream resolution. After recovery, run pgTAP suite to confirm no schema drift.

---

## Playbook: Report fails to generate

**Symptom:** Stage 14 Generate Report hangs or errors after the Trigger.dev task starts.

**Diagnostic order:**
1. Check Trigger.dev dashboard for the run: was it queued, started, errored, or timed out?
2. If timed out: check the orchestrator log; look for stuck Claude call.
3. If errored: read the error; common ones are listed below.

**Common errors:**
- **Out of budget:** `ai_cost_ledger` shows tenant has hit per-day ceiling. Increase ceiling in Supabase or wait until midnight.
- **Token ceiling exceeded for one section:** inputs are unusually large. Trim and regenerate.
- **PDF render fails:** check for missing brand assets (`badge-accredited.svg`, `logo.png`); check Source Serif Pro is bundled.
- **Storage upload fails:** check Supabase Storage quota.

---

## Playbook: Magic-link emails not arriving

**Symptom:** Partner enters email at `/login`, never receives the link.

**Diagnostic:**
1. Check Resend dashboard for the message. Status?
2. Check Supabase Auth logs (Authentication > Logs > Email).
3. Common: rate-limited (5 sign-in requests per hour per IP); wait and retry.
4. Check spam folder.
5. Check SMTP config in Supabase Studio (Authentication > Providers > Email > SMTP).

**If Resend is down:** Supabase falls back to its built-in SMTP, which has lower deliverability. Note this in STATUS; switch back to Resend on recovery.

---

## Playbook: Preview sign-in returns to an unreachable domain

**Symptom:** Google or an email sign-in link finishes at `/auth/callback` on a
different host, with `ERR_NAME_NOT_RESOLVED` instead of the dashboard.

The sign-in actions construct their callback from `NEXT_PUBLIC_SITE_URL`.
Check both the deployment setting and Supabase's allowed Redirect URLs; changing
only one can still send the user to the default Site URL.

1. Use one stable branch-preview hostname for sign-in and subsequent testing.
2. In Vercel, override `NEXT_PUBLIC_SITE_URL` for that preview branch only. Use
   the full HTTPS origin with no trailing slash. Keep production's value intact.
3. In Supabase Authentication > URL Configuration, add that exact origin plus
   `/auth/callback` to Redirect URLs. Avoid a project-wide wildcard.
4. Deploy that branch again: saved environment changes do not update an existing
   deployment. Check the selected source branch and Preview environment.
5. Start a fresh sign-in from the stable hostname in the same browser. Verify
   that it returns there and opens the authenticated dashboard. Old callback
   links may have expired and do not establish that the new setting failed.
6. Then test save, failed-save retry and reload on a labelled synthetic deal.

The recovery branch uses
`https://bullseye-properties-git-fix-bpos-r-2c09ac-connorblades-projects.vercel.app`.
The exact callback and branch-specific Config override were saved on 10 November
2026. This configuration record is not a claim of completed live sign-in testing.

Reference: [Supabase redirect URL configuration](https://supabase.com/docs/guides/auth/redirect-urls).

---

## Playbook: Mapbox rate limit hit

**Symptom:** PDF generation succeeds but maps render as broken images, or 429 errors in Sentry.

**Expected automatic behaviour:** the 30-day cache layer should keep us well under 50,000 requests / month at single-partner scale.

**Diagnostic:**
1. Check Mapbox console for usage. If approaching 50k, upgrade tier or extend cache TTL.
2. Inspect `partner-assets` bucket; confirm cached map URLs are being served, not re-fetched.

---

## Playbook: Investor disputes report content

**Symptom:** Investor claims a report misled them; partner asks what to provide.

**Steps:**
1. Pull the relevant `deal_reports` row and every `deal_report_versions` row.
2. Pull every `claude_generations` row for the deal: every model invocation, every prompt hash, every Claude response, every partner edit diff.
3. Pull the `share_link_events` rows: every open, time on page, download.
4. Pull the `audit_log` rows for the deal.
5. The disclosure footer on every PDF page is the documented chain showing AI involvement; the partner-led call is the documented review step.

This evidence base supports the partner-as-decision-maker defence per PLAN AC-07 and the ethics-check guardrails.

---

*Bullseye Properties Ltd · Confidential*
