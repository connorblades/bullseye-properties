'use client';

import { useMemo } from 'react';
import { CalendarDays, Download, CheckCircle2, MapPin } from 'lucide-react';
import { ImageUpload } from '@/components/image-upload';
import {
  buildIcs,
  bookingStatus,
  propertyBrief,
  DEFAULT_DURATION_MINS,
  type ViewingBooking,
} from '@/lib/booking';
import type { Deal } from '@/lib/deal-store';

/** ISO -> the value a <input type="datetime-local"> expects (local time). */
function isoToLocalInput(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** datetime-local value (local time) -> an ISO string. */
function localInputToIso(local: string): string | undefined {
  if (!local) return undefined;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

const DURATIONS = [15, 30, 45, 60, 90];

export function ViewingBookingCard({
  deal,
  booking,
  onChange,
}: {
  deal: Deal;
  booking?: ViewingBooking;
  onChange: (next: ViewingBooking) => void;
}) {
  const b = booking ?? {};
  const status = useMemo(() => bookingStatus(b), [b]);
  const brief = useMemo(() => propertyBrief(deal), [deal]);

  const set = (patch: Partial<ViewingBooking>) => onChange({ ...b, ...patch });
  const setConfirmation = (patch: Partial<NonNullable<ViewingBooking['confirmation']>>) =>
    onChange({ ...b, confirmation: { ...b.confirmation, ...patch, attachedAt: new Date().toISOString() } });

  const downloadIcs = () => {
    const ics = buildIcs(deal, b, new Date());
    if (!ics) return;
    const blob = new Blob([ics.content], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = ics.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const field = 'w-full border border-black/[0.08] rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-navy/30';

  return (
    <div className="space-y-4">
      {/* Booking slot */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-black text-ink flex items-center gap-1.5">
            <CalendarDays size={15} /> Book the viewing
          </div>
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${status.hasSlot ? 'bg-navy/10 text-navy' : 'bg-black/[0.05] text-ink-muted'}`}>
            {status.label}
          </span>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-[11px] text-ink-muted">
            Date &amp; time
            <input
              type="datetime-local"
              value={isoToLocalInput(b.scheduledAt)}
              onChange={(e) => set({ scheduledAt: localInputToIso(e.target.value) })}
              className={field}
            />
          </label>
          <label className="text-[11px] text-ink-muted">
            Duration
            <select
              value={b.durationMins ?? DEFAULT_DURATION_MINS}
              onChange={(e) => set({ durationMins: Number(e.target.value) })}
              className={`${field} bg-white`}
            >
              {DURATIONS.map((m) => (
                <option key={m} value={m}>{m} minutes</option>
              ))}
            </select>
          </label>
          <label className="text-[11px] text-ink-muted">
            Our attendee
            <input value={b.attendee ?? ''} onChange={(e) => set({ attendee: e.target.value })} placeholder="Who is viewing" className={field} />
          </label>
          <label className="text-[11px] text-ink-muted">
            Meeting point / access
            <input value={b.location ?? ''} onChange={(e) => set({ location: e.target.value })} placeholder={deal.address || 'Property address'} className={field} />
          </label>
          <label className="text-[11px] text-ink-muted">
            Agent / vendor contact
            <input value={b.agentName ?? ''} onChange={(e) => set({ agentName: e.target.value })} placeholder="Agent name" className={field} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-ink-muted">
              Agent phone
              <input value={b.agentPhone ?? ''} onChange={(e) => set({ agentPhone: e.target.value })} placeholder="Phone" className={field} />
            </label>
            <label className="text-[11px] text-ink-muted">
              Agent email
              <input value={b.agentEmail ?? ''} onChange={(e) => set({ agentEmail: e.target.value })} placeholder="Email" className={field} />
            </label>
          </div>
        </div>

        <button
          onClick={downloadIcs}
          disabled={!status.hasSlot}
          className="btn-secondary text-xs mt-3 disabled:opacity-40 disabled:cursor-not-allowed"
          title={status.hasSlot ? 'Download a calendar invite for this slot' : 'Set a date and time first'}
        >
          <Download size={13} /> Add to calendar (.ics)
        </button>
      </div>

      {/* Confirmation email */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-black text-ink">Viewing confirmation</div>
          {status.hasConfirmation && (
            <span className="text-[11px] font-bold text-success-dark flex items-center gap-1"><CheckCircle2 size={13} /> Attached</span>
          )}
        </div>
        <p className="text-xs text-ink-muted mb-3">Paste the confirmation email from the agent, or attach a screenshot, so the booking is evidenced.</p>
        <textarea
          value={b.confirmation?.text ?? ''}
          onChange={(e) => setConfirmation({ text: e.target.value })}
          rows={4}
          placeholder="Paste the viewing confirmation email here..."
          className="w-full border border-black/[0.08] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-navy/30 resize-none mb-3"
        />
        <ImageUpload
          value={b.confirmation?.imageData}
          onChange={(d) => setConfirmation({ imageData: d || undefined })}
          label="Confirmation screenshot"
        />
      </div>

      {/* Pulled property brief */}
      <div className="card p-5">
        <div className="text-sm font-black text-ink flex items-center gap-1.5 mb-1">
          <MapPin size={15} /> Property brief
        </div>
        <p className="text-xs text-ink-muted mb-3">The booked property&rsquo;s details, pulled from the deal so you arrive informed. Run Auto-Pull for EPC, tenure and council tax if any are missing.</p>
        {brief.length === 0 ? (
          <div className="text-xs text-ink-muted py-2">No property details captured yet.</div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
            {brief.map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-3 border-b border-black/[0.05] py-1">
                <span className="text-[11px] text-ink-muted uppercase tracking-wide">{row.label}</span>
                <span className="text-sm text-ink font-semibold text-right">{row.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
