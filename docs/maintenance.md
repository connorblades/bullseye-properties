# Maintenance

Routine tasks and cadence. Owner: Connor Blades.

## Monthly

- [ ] Review `ai_cost_ledger` for the previous month. Compare against the £300 Anthropic ceiling.
- [ ] Review Mapbox usage. If above 50% of the 50,000 free-tier monthly cap, plan tier upgrade.
- [ ] Review Sentry error volume. Triage any new error fingerprints.
- [ ] Review Supabase Storage usage. If above 70% of plan limit, plan upgrade or archive.
- [ ] Check Vercel deploy logs for any builds that failed silently.
- [ ] Review `share_link_events` retention (24 months); archive older.

## Quarterly

- [ ] Run a restore drill: restore yesterday's Supabase backup into a sandbox project. Confirm under 60 minutes.
- [ ] Review `claude_generations` table size. If above 1GB, archive responses older than 12 months (retain edit diffs).
- [ ] Refresh `prompt_version_hash` if any prompt has been updated. Re-run pressure tests on 3 representative deals.
- [ ] Review dependency updates. Apply security patches. Test on a preview deploy before merging.

## Annual

- [ ] Rotate secrets: Anthropic key, Supabase service role key, Resend API key, Trigger.dev API key, Mapbox token, Sentry token.
- [ ] Audit log review: confirm `claude_generations` and `audit_log` INSERT-only grants are still in place. Run pgTAP.
- [ ] PI insurance review: confirm policy in force; review whether AI-content endorsement is now available.
- [ ] Compliance review: AML registration renewal, ICO renewal, PI policy renewal.
- [ ] Sub-processor register review: confirm all named third-parties still in use; remove any that have been replaced.

## On any release with prompt changes

- [ ] Increment `prompt_version_hash` for the affected section(s).
- [ ] Generate a sample report on the Browning Street demo deal.
- [ ] Compare each Claude-drafted section against the previous version for material drift.
- [ ] Note the change in STATUS with the new hash and the date.
- [ ] Consider whether to re-render past reports with the new prompt (default: no, keep history).

## On any pricing change

- [ ] Update the £3,000 sourcing fee, instruction split (10/40/50), or VAT treatment only via a documented decision recorded in STATUS plus the relevant code change.

## On any partner onboarding (M2+)

- [ ] Issue partner identity (initials + member number).
- [ ] Provision tenant in Supabase.
- [ ] Issue brand kit and Accreditation badge.
- [ ] Add to public directory if M3 is live.

---

*Bullseye Properties Ltd · Confidential*
