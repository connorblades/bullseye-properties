'use client';

import { useEffect, useState } from 'react';
import { Loader2, Link2, Copy, Check, Ban, Eye, Mail } from 'lucide-react';
import {
  createDealShareLink,
  createAndEmailShareLink,
  listDealShareLinks,
  revokeDealShareLink,
  type ShareLinkView,
} from '@/server/actions/share';
import type { ShareTokenKind } from '@/server/share/tokens';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const EXPIRY_OPTIONS: { label: string; days: number | null }[] = [
  { label: '90 days', days: 90 },
  { label: '30 days', days: 30 },
  { label: '7 days', days: 7 },
  { label: 'Never expires', days: null },
];

function fmtDate(iso: string | null): string {
  if (!iso) return 'n/a';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(new Date(iso));
}

function StatusBadge({ status }: { status: ShareLinkView['status'] }) {
  const map: Record<ShareLinkView['status'], string> = {
    active: 'text-success bg-success-light',
    revoked: 'text-red-700 bg-red-50',
    expired: 'text-ink-mid bg-black/[0.06]',
  };
  return (
    <span className={`text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded ${map[status]}`}>
      {status}
    </span>
  );
}

export function ShareLinkManager({
  dealId,
  kind,
  title,
  description,
  disabledReason,
}: {
  dealId: string;
  kind: ShareTokenKind;
  title: string;
  description: string;
  /** When set, link creation is blocked (e.g. no rendered report yet). */
  disabledReason?: string;
}) {
  const [links, setLinks] = useState<ShareLinkView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState('');
  const [recipient, setRecipient] = useState('');
  const [expiryDays, setExpiryDays] = useState<number | null>(90);
  const [freshUrl, setFreshUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null);

  const recipientValid = EMAIL_RE.test(recipient.trim());

  useEffect(() => {
    let cancelled = false;
    listDealShareLinks(dealId, kind)
      .then((rows) => { if (!cancelled) setLinks(rows); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load links.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dealId, kind]);

  async function refresh() {
    try {
      setLinks(await listDealShareLinks(dealId, kind));
    } catch {
      // keep the stale list on a refresh failure
    }
  }

  async function onCreate() {
    setCreating(true);
    setError(null);
    setCopied(false);
    setNotice(null);
    try {
      const res = await createDealShareLink({
        dealId,
        kind,
        label: label.trim() || null,
        recipientEmail: recipient.trim() || null,
        expiresInDays: expiryDays,
      });
      setFreshUrl(res.url);
      setLabel('');
      setRecipient('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the link.');
    } finally {
      setCreating(false);
    }
  }

  async function onCreateAndEmail() {
    const to = recipient.trim();
    setEmailing(true);
    setError(null);
    setCopied(false);
    setNotice(null);
    try {
      const res = await createAndEmailShareLink({
        dealId,
        kind,
        label: label.trim() || null,
        recipientEmail: to,
        expiresInDays: expiryDays,
      });
      setFreshUrl(res.url);
      setNotice(
        res.emailSent
          ? { kind: 'ok', text: `Link created and emailed to ${to}.` }
          : { kind: 'warn', text: `Link created, but the email did not send: ${res.emailError ?? 'unknown error'}. Copy it below.` },
      );
      setLabel('');
      setRecipient('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the link.');
    } finally {
      setEmailing(false);
    }
  }

  async function onRevoke(id: string) {
    try {
      await revokeDealShareLink(id, dealId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not revoke the link.');
    }
  }

  async function copyFresh() {
    if (!freshUrl) return;
    try {
      await navigator.clipboard?.writeText(freshUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard may be unavailable; the URL is selectable in the box
    }
  }

  return (
    <div className="card p-6">
      <div className="flex items-center gap-2 mb-1">
        <Link2 size={18} className="text-navy" />
        <h2 className="text-lg font-black text-ink">{title}</h2>
      </div>
      <p className="text-sm text-ink-mid mb-5">{description}</p>

      {error && (
        <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
      )}

      {/* Create */}
      {disabledReason ? (
        <div className="mb-5 text-sm text-ink-mid bg-bg rounded-lg px-4 py-3">{disabledReason}</div>
      ) : (
        <div className="mb-5 space-y-3 bg-bg rounded-xl p-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label (optional, e.g. 'Sarah - 23 Acacia')"
              className="border border-black/[0.08] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy/30"
            />
            <input
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="Recipient email (optional)"
              type="email"
              className="border border-black/[0.08] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy/30"
            />
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={expiryDays === null ? 'never' : String(expiryDays)}
              onChange={(e) => setExpiryDays(e.target.value === 'never' ? null : Number(e.target.value))}
              className="border border-black/[0.08] rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-navy/30"
            >
              {EXPIRY_OPTIONS.map((o) => (
                <option key={o.label} value={o.days === null ? 'never' : String(o.days)}>
                  Expires in {o.label}
                </option>
              ))}
            </select>
            <button onClick={onCreate} disabled={creating || emailing} className="btn-secondary text-sm disabled:opacity-50">
              {creating ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />}
              Create link
            </button>
            <button
              onClick={onCreateAndEmail}
              disabled={creating || emailing || !recipientValid}
              title={recipientValid ? 'Create the link and email it to the recipient' : 'Enter a recipient email to send'}
              className="btn-primary text-sm disabled:opacity-50"
            >
              {emailing ? <Loader2 size={15} className="animate-spin" /> : <Mail size={15} />}
              Create and email
            </button>
          </div>
          {notice && (
            <div
              className={`text-xs rounded-lg px-3 py-2 ${
                notice.kind === 'ok' ? 'text-success-dark bg-success-light/50' : 'text-amber-800 bg-amber-50 border border-amber-200'
              }`}
            >
              {notice.text}
            </div>
          )}
        </div>
      )}

      {/* One-time URL reveal */}
      {freshUrl && (
        <div className="mb-5 rounded-xl border border-navy/30 bg-navy/[0.04] p-4">
          <div className="text-[11px] font-bold text-navy uppercase tracking-wide mb-2">
            New link - copy it now, it is shown only once
          </div>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={freshUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 min-w-0 font-mono text-xs border border-black/[0.08] rounded-lg px-3 py-2 bg-white"
            />
            <button onClick={copyFresh} className="btn-secondary text-xs whitespace-nowrap">
              {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="py-6 text-center text-ink-muted text-sm">
          <Loader2 size={20} className="animate-spin mx-auto mb-2" /> Loading links...
        </div>
      ) : links.length === 0 ? (
        <div className="py-6 text-center text-ink-muted text-sm">No share links yet.</div>
      ) : (
        <div className="divide-y divide-black/[0.06]">
          {links.map((l) => (
            <div key={l.id} className="py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-ink truncate">{l.label || l.recipientEmail || 'Untitled link'}</span>
                  <StatusBadge status={l.status} />
                </div>
                <div className="text-xs text-ink-muted mt-0.5 flex items-center gap-3 flex-wrap">
                  <span className="inline-flex items-center gap-1"><Eye size={12} /> {l.accessCount} opens</span>
                  <span>Created {fmtDate(l.createdAt)}</span>
                  <span>{l.revokedAt ? `Revoked ${fmtDate(l.revokedAt)}` : `Expires ${fmtDate(l.expiresAt)}`}</span>
                  {l.lastAccessedAt && <span>Last opened {fmtDate(l.lastAccessedAt)}</span>}
                </div>
              </div>
              {l.status === 'active' && (
                <button
                  onClick={() => onRevoke(l.id)}
                  className="text-xs font-semibold text-red-700 hover:bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5 inline-flex items-center gap-1 whitespace-nowrap"
                >
                  <Ban size={13} /> Revoke
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
