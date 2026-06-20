# Cloudflare DNS migration walkthrough

**Why we're doing this:** Wix DNS (Squarespace's backend) doesn't reliably publish subdomain records. Both the Resend MX records (for `send.os.bullseyeproperties.co.uk`) and the Vercel CNAME (for `os.bullseyeproperties.co.uk`) save in the Wix UI but never resolve at the authoritative nameservers.

Cloudflare:
- Free for unlimited domains, unlimited subdomains, unlimited records
- Publishes records to authoritative DNS in under a minute
- Supports every record type Wix doesn't (subdomain MX, ALIAS, edge IPs)
- 24h to migrate fully (one-time wait while nameservers propagate)
- DNS-only mode (the "grey cloud") keeps Cloudflare out of the request path so it's purely a DNS host

**Time: 10 minutes setup + 24-48h wait for nameservers to propagate. Your existing Squarespace website keeps working during the wait.**

---

## Step 1: Sign up for Cloudflare

1. Go to **https://dash.cloudflare.com/sign-up**
2. Sign up with `connor@bullseyeproperties.co.uk`
3. Verify the email
4. **Skip** the "Get started" tour and any plan upgrades — Free plan is what we want

## Step 2: Add your domain

1. From the Cloudflare dashboard, click **Add a site**
2. Enter `bullseyeproperties.co.uk`
3. Click **Continue**
4. Pick **Free** plan → **Continue**

Cloudflare will scan your existing DNS at Wix and import everything. Wait for the scan (10-30 seconds).

## Step 3: Verify imported records

After the scan, Cloudflare shows you a table of all the records they found. **Critical check:**

- [ ] Your apex A/CNAME record (pointing your main website to Squarespace) is there
- [ ] Your existing `www` record is there
- [ ] `freeguide`, `blueprint` and any other working subdomains are listed
- [ ] If you had any MX records for `@` (apex email), they're listed

If anything's missing, click **Add record** and add it manually. Use the values from your current Wix DNS panel as the source of truth.

**Important — for each row, set the "Proxy status" column:**
- For records pointing to **your existing Squarespace website**: leave as the orange cloud (Cloudflare proxy) if Squarespace recommends, otherwise switch to **DNS only** (grey cloud)
- For records that need to resolve to specific IPs (Vercel CNAME, MX, TXT verifications): **DNS only** (grey cloud)

The orange cloud routes traffic through Cloudflare. The grey cloud just answers DNS queries and lets traffic flow direct.

For SAFE migration, set **everything to grey cloud (DNS only)** initially. You can flip individual records to orange cloud later if you want CDN/cache benefits.

Click **Continue** when the records look complete.

## Step 4: Change nameservers at Squarespace

This is the migration moment. Cloudflare will show you two nameservers like:

```
ada.ns.cloudflare.com
bart.ns.cloudflare.com
```

Each Cloudflare account gets a unique pair. Copy yours.

Then in Squarespace:

1. Squarespace dashboard → **Settings** → **Domains**
2. Click `bullseyeproperties.co.uk`
3. Find the **Nameservers** section. It currently says it's using Squarespace's defaults (Wix-backed).
4. Click **Edit** / **Use Custom Nameservers** / similar wording
5. **Remove the existing Wix nameservers** (`ns0.wixdns.net`, `ns1.wixdns.net`)
6. **Add Cloudflare's two nameservers**
7. Save

**Important:** Squarespace might warn you about "this will disconnect your domain". That's normal and exactly what we want — DNS authority is moving from Wix to Cloudflare. Your website at Squarespace still works because the DNS records you imported into Cloudflare still point to Squarespace.

## Step 5: Wait

Back on Cloudflare, click **Continue** / **Done, check nameservers**. Cloudflare will start polling.

- First confirmation: **5-60 minutes**
- Full global propagation: **24-48 hours**

During this window:
- Some users (those whose ISP DNS cache hasn't refreshed) still resolve through Wix
- Others (those whose cache picked up the new nameservers) resolve through Cloudflare
- Your website works for everyone because both DNS providers point to the same Squarespace IPs

Cloudflare emails you when migration is complete. **Until that email, don't add new records** — they'll only be visible via Cloudflare's nameservers, and some users still hit Wix.

## Step 6 (after migration email): Add the Vercel CNAME

Once Cloudflare emails "Your site is now active on Cloudflare":

1. Cloudflare dashboard → your domain → **DNS** → **Records**
2. Click **Add record**
3. Fill:
   - **Type**: `CNAME`
   - **Name**: `os`
   - **Target**: `15c9c138161c48d1.vercel-dns-017.com`
   - **Proxy status**: **DNS only** (grey cloud) — Vercel needs to see the unproxied request
   - **TTL**: Auto
4. Save

Within 1-2 minutes Vercel will detect the CNAME and switch `os.bullseyeproperties.co.uk` to **Valid Configuration**, issue an SSL cert, and the custom domain is live.

## Step 7: Flip the env vars

Once the custom domain is live:

1. **Vercel** → Project → Settings → Environment Variables → edit `NEXT_PUBLIC_SITE_URL`
   - Change from `https://bullseye-properties.vercel.app` to `https://os.bullseyeproperties.co.uk`
   - Save → Redeploy

2. **Supabase** → Authentication → URL Configuration
   - Site URL: change to `https://os.bullseyeproperties.co.uk`
   - Redirect URLs: confirm `https://os.bullseyeproperties.co.uk/auth/callback` is in the allow-list (we already added it earlier; nothing to do)

3. **Test sign-in via the custom domain** — visit `https://os.bullseyeproperties.co.uk` and try magic-link or password sign-in

## Step 8 (later): Resend domain verification

Once Cloudflare is the DNS authority, the Resend domain we set up earlier (`os.bullseyeproperties.co.uk`) can be re-verified. Resend's records (DKIM TXT, MX, SPF TXT) will publish correctly now.

1. Resend → Domains → `os.bullseyeproperties.co.uk`
2. If shown as "Failed" — click **Verify DNS Records**. Cloudflare will already be serving the records (you imported them in Step 3, or you can re-add them now)
3. Wait 1-2 minutes for verification

Then update Supabase Auth SMTP to use Resend (Authentication → URL Configuration scroll down to SMTP Settings → enable custom SMTP → enter Resend's SMTP host, port, username, API key as password). After that, sign-in emails come from `noreply@os.bullseyeproperties.co.uk` instead of `noreply@mail.app.supabase.io`.

---

## Risks and rollback

- **If Cloudflare migration breaks something** (website goes down because a DNS record was missed): change the nameservers at Squarespace back to `ns0.wixdns.net` and `ns1.wixdns.net`. DNS reverts within an hour.
- **If you want to keep Wix for some legacy reason**: don't migrate. Stay on vercel.app URL forever, accept that Resend won't work.
- **No data loss is possible from this migration**: DNS is just pointers. Nothing in your website, Vercel deploy, Supabase database, or any other system is touched.

---

*Bullseye Properties Ltd · Confidential*
