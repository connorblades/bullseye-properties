'use client';

import { useMemo, useState } from 'react';
import { Plus, Trash2, Ruler, AlertTriangle } from 'lucide-react';
import { ImageUpload, ImageGallery } from '@/components/image-upload';
import {
  ZONE_ORDER,
  PRICE_BOOK,
  INSPECTION_KIT,
  stepsForProperty,
  kitForSteps,
  roomGeometry,
  itemCost,
  inspectionRefurb,
  inspectionReviewProgress,
  activeInspectionIndex,
  stepReviewed,
  INSPECTION_RESULTS,
  emptyInspection,
  type InspectionState,
  type RoomEntry,
  type StepCapture,
  type RoomWork,
  type InspectionStep,
  type InspectionResult,
} from '@/lib/inspection';

const gbp = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;
const ROOM_WORKS: { key: RoomWork; label: string }[] = [
  { key: 'plaster', label: 'Plaster' },
  { key: 'paint', label: 'Paint' },
  { key: 'skirting', label: 'Skirting' },
  { key: 'architrave', label: 'Architrave' },
];

export function InspectionWalkthrough({
  state,
  onChange,
  endOrSemi,
}: {
  state?: InspectionState;
  onChange: (next: InspectionState) => void;
  endOrSemi?: boolean;
}) {
  const s = state ?? emptyInspection();
  const [section, setSection] = useState<'checks' | 'rooms' | 'review'>('checks');
  const [roomTemplate, setRoomTemplate] = useState('Living room');
  const steps = useMemo(() => stepsForProperty({ endOrSemi }), [endOrSemi]);
  const kit = useMemo(() => kitForSteps(steps), [steps]);
  const est = useMemo(() => inspectionRefurb(s, steps), [s, steps]);
  const progress = inspectionReviewProgress(s, steps);
  const activeIndex = activeInspectionIndex(s, steps);
  const activeStep = steps[activeIndex];
  const goToCheck = (index: number) => {
    const step = steps[index];
    if (step) onChange({ ...s, activeStepKey: step.key });
    setSection('checks');
  };

  const setStep = (key: string, patch: Partial<StepCapture>) =>
    onChange({ ...s, activeStepKey: key, steps: { ...s.steps, [key]: { ...s.steps[key], ...patch } } });
  const setRooms = (rooms: RoomEntry[]) => onChange({ ...s, rooms });

  const addRoom = () =>
    setRooms([
      ...s.rooms,
      { id: `room-${crypto.randomUUID()}`, name: roomTemplate === 'Custom room' ? `Room ${s.rooms.length + 1}` : roomTemplate, lengthM: 0, widthM: 0, heightM: 2.4, doors: 1, works: [] },
    ]);
  const setRoom = (id: string, patch: Partial<RoomEntry>) =>
    setRooms(s.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRoom = (id: string) => setRooms(s.rooms.filter((r) => r.id !== id));

  return (
    <div className="space-y-4">
      {/* Kit list */}
      <details className="card p-4 bg-navy/[0.03] border-navy/20">
        <summary className="text-xs font-bold text-navy uppercase tracking-wider cursor-pointer">Kit to take</summary>
        <div className="grid sm:grid-cols-3 gap-2">
          {(kit.length ? kit : INSPECTION_KIT).map((k) => (
            <div key={k.key} className="text-xs">
              <div className="font-bold text-ink">{k.label}</div>
              <div className="text-ink-muted">{k.why}</div>
            </div>
          ))}
        </div>
      </details>

      {/* Progress + running total */}
      <div className="card p-4 flex items-center justify-between gap-4 flex-wrap" aria-live="polite">
        <div>
          <div className="text-xs font-bold text-ink-mid uppercase tracking-wider">Walkthrough</div>
          <div className="text-sm text-ink-mid">{progress.reviewed} / {progress.total} checks reviewed</div>
          <div className="text-xs text-ink-muted">{progress.concerns} concerns · {progress.notInspected} unable to inspect</div>
        </div>
        <div className="text-right">
          <div className="text-xs font-bold text-ink-muted uppercase tracking-wide">Refurb estimate</div>
          <div className="text-2xl font-black text-ink">{gbp(est.total)}</div>
          <div className="text-[11px] text-ink-muted">
            {gbp(est.subtotal)} works + {gbp(est.contingency)} contingency
          </div>
          <div className="text-[11px] text-ink-muted">Estimate from entered works and default rates</div>
        </div>
      </div>

      <nav className="flex gap-2 flex-wrap" aria-label="Inspection sections">
        {([['checks', 'Property checks'], ['rooms', 'Rooms & measurements'], ['review', 'Review findings']] as const).map(([key, label]) => (
          <button type="button" key={key} aria-pressed={section === key} onClick={() => setSection(key)} className={section === key ? 'btn-primary' : 'btn-secondary'}>{label}</button>
        ))}
      </nav>

      {/* Rooms (laser measure -> measured take-offs) */}
      {section === 'rooms' && (
      <div className="card p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div className="text-sm font-black text-ink flex items-center gap-1.5"><Ruler size={15} /> Rooms &amp; measurements</div>
          <div className="flex gap-2 flex-wrap">
            <select aria-label="Room type" value={roomTemplate} onChange={(e) => setRoomTemplate(e.target.value)} className="border rounded-lg px-3 py-2">
              {['Living room', 'Dining room', 'Kitchen', 'Bedroom', 'Bathroom', 'Hallway', 'Landing', 'Loft', 'Garage', 'Custom room'].map((name) => <option key={name}>{name}</option>)}
            </select>
            <button type="button" onClick={addRoom} className="btn-secondary text-xs"><Plus size={13} /> Add room</button>
          </div>
        </div>
        <p className="text-xs text-ink-muted mb-3">Laser-measure length, width, height and door count. Tick the works and the cost is taken off from the measurements (plaster in bags, paint in litres, skirting/architrave in metres, +10% waste).</p>
        {s.rooms.length === 0 && <div className="text-xs text-ink-muted py-3">No rooms measured yet.</div>}
        <div className="space-y-3">
          {s.rooms.map((r) => {
            const g = roomGeometry(r);
            return (
              <div key={r.id} className="border border-black/[0.08] rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <input aria-label="Room name" value={r.name} onChange={(e) => setRoom(r.id, { name: e.target.value })} className="min-w-0 flex-1 border border-black/[0.08] rounded-md px-3 py-3 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-navy/30" />
                  <button type="button" aria-label={`Remove ${r.name}`} onClick={() => removeRoom(r.id)} className="text-ink-muted hover:text-red-600 p-3"><Trash2 size={15} /></button>
                </div>
                <div className="grid grid-cols-4 gap-2 mb-2">
                  {([['lengthM', 'Length m'], ['widthM', 'Width m'], ['heightM', 'Height m'], ['doors', 'Doors']] as const).map(([k, label]) => (
                    <label key={k} className="text-[11px] text-ink-muted">
                      {label}
                      <input
                        type="number" inputMode="decimal" step={k === 'doors' ? '1' : '0.1'} min="0"
                        value={(r[k] as number) || ''}
                        onChange={(e) => setRoom(r.id, { [k]: Number(e.target.value) } as Partial<RoomEntry>)}
                        className="w-full border border-black/[0.08] rounded-md px-2 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-navy/30"
                      />
                    </label>
                  ))}
                </div>
                <div className="text-[11px] text-ink-muted mb-2">
                  Floor {g.floorArea} m² · Walls {g.wallArea} m² · Perimeter {g.perimeter} m
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  {ROOM_WORKS.map((w) => {
                    const on = r.works?.includes(w.key);
                    return (
                      <button
                        type="button"
                        aria-pressed={!!on}
                        key={w.key}
                        onClick={() => setRoom(r.id, { works: on ? (r.works ?? []).filter((x) => x !== w.key) : [...(r.works ?? []), w.key] })}
                        className={`text-xs font-semibold px-3 py-3 rounded-lg border ${on ? 'bg-navy text-white border-navy' : 'border-black/[0.12] text-ink-mid'}`}
                      >
                        {w.label}
                      </button>
                    );
                  })}
                </div>
                <div className="grid sm:grid-cols-2 gap-3 mt-4">
                  <label className="text-sm">Room condition (1 worst, 10 best)
                    <select value={r.rating ?? ''} onChange={(e) => setRoom(r.id, { rating: e.target.value ? Number(e.target.value) : undefined })} className="block w-full border rounded-lg p-3 mt-1">
                      <option value="">Not rated</option>
                      {Array.from({ length: 10 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
                    </select>
                  </label>
                  <label className="text-sm">Room notes
                    <textarea value={r.notes ?? ''} onChange={(e) => setRoom(r.id, { notes: e.target.value })} className="block w-full border rounded-lg p-3 mt-1" rows={2} />
                  </label>
                </div>
                <div className="mt-3"><ImageGallery images={r.photos ?? []} onChange={(photos) => setRoom(r.id, { photos })} max={6} label={`Add ${r.name} photo`} /></div>
              </div>
            );
          })}
        </div>
      </div>
      )}

      {section === 'checks' && activeStep && (
        <section className="card p-5" aria-label="Current property check">
          <label className="block text-xs font-bold text-navy mb-4">Check {activeIndex + 1} of {steps.length}
            <select aria-label="Jump to check" value={activeStep.key} onChange={(e) => goToCheck(steps.findIndex((step) => step.key === e.target.value))} className="block w-full rounded-lg border p-3 mt-2 text-sm font-normal">
              {ZONE_ORDER.map((zone) => <optgroup key={zone.zone} label={zone.title}>
                {steps.filter((step) => step.zone === zone.zone).map((step) => <option key={step.key} value={step.key}>{step.label}{stepReviewed(s.steps[step.key]) ? ' · reviewed' : ''}</option>)}
              </optgroup>)}
            </select>
          </label>
          <StepRow key={activeStep.key} step={activeStep} capture={s.steps[activeStep.key] ?? {}} rooms={s.rooms} onChange={(patch) => setStep(activeStep.key, patch)} />
          <div className="flex justify-between gap-3 mt-5">
            <button type="button" disabled={activeIndex === 0} onClick={() => goToCheck(activeIndex - 1)} className="btn-secondary disabled:opacity-40">Previous</button>
            <button type="button" onClick={() => activeIndex < steps.length - 1 ? goToCheck(activeIndex + 1) : setSection('review')} className="btn-primary">{activeIndex < steps.length - 1 ? 'Next check' : 'Review findings'}</button>
          </div>
          <p className="text-xs text-ink-muted mt-3">Moving to the next check does not mark this one as reviewed.</p>
        </section>
      )}

      {section === 'review' && (
        <section className="card p-5" aria-label="Inspection findings">
          <h2 className="font-bold text-lg mb-2">Review findings</h2>
          <p className="text-sm text-ink-mid mb-4">{progress.total - progress.reviewed} checks still need an observation or a reason for skipping. These are viewing observations; the final assessment and sign-off remain in After.</p>
          <div className="space-y-2">
            {steps.map((step, index) => {
              const capture = s.steps[step.key];
              return <button type="button" key={step.key} onClick={() => goToCheck(index)} className="w-full rounded-lg border p-3 text-left flex justify-between gap-3 items-center">
                <span className="text-sm font-semibold">{step.label}</span>
                <span className="text-xs text-ink-mid">{stepReviewed(capture) && capture?.result ? INSPECTION_RESULTS[capture.result] : 'Needs review'}</span>
              </button>;
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function StepRow({
  step,
  capture,
  rooms,
  onChange,
}: {
  step: InspectionStep;
  capture: StepCapture;
  rooms: RoomEntry[];
  onChange: (patch: Partial<StepCapture>) => void;
}) {
  const priced = step.costMode && step.priceKey ? PRICE_BOOK[step.priceKey] : undefined;
  const line = step.costMode && step.priceKey && capture.cost
    ? itemCost({
        label: step.label,
        priceKey: step.priceKey,
        quantity: capture.cost.quantity,
        areaSqm: step.costMode === 'area'
          ? (capture.cost.areaSqm ?? (rooms.find((r) => r.id === capture.cost?.roomId) ? roomGeometry(rooms.find((r) => r.id === capture.cost!.roomId)!)[capture.cost.areaBasis === 'wall' ? 'wallArea' : 'floorArea'] : 0))
          : undefined,
        overrideMaterial: capture.cost.overrideMaterial,
        overrideLabour: capture.cost.overrideLabour,
      })
    : null;

  const setCost = (patch: Partial<NonNullable<StepCapture['cost']>>) => onChange({ cost: { ...capture.cost, ...patch } });
  const needsReason = capture.result === 'not-inspected' || capture.result === 'not-applicable';

  return (
    <div className="border-b border-black/[0.05] pb-4 last:border-b-0 last:pb-0">
      <div className="flex items-start justify-between gap-3 mb-1.5">
        <div>
          <div className="text-sm font-bold text-ink">{step.label}</div>
          <div className="text-xs text-ink-muted">{step.guidance}</div>
          <div className="text-[11px] text-success-dark mt-0.5">Good: {step.pass}</div>
        </div>
        {step.walkAwaySignal && <AlertTriangle size={16} className="text-amber-500 flex-shrink-0" />}
      </div>

      <fieldset className="my-4">
        <legend className="text-sm font-semibold mb-2">Your observation</legend>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(INSPECTION_RESULTS).map(([key, label]) => (
            <button type="button" key={key} aria-pressed={capture.result === key} onClick={() => onChange({ result: key as InspectionResult, ...(step.capture.includes('flag') ? { flagged: key === 'concern' ? true : key === 'no-concern' ? false : undefined } : {}) })} className={`min-h-12 rounded-lg border p-3 text-sm font-semibold ${capture.result === key ? 'bg-navy text-white border-navy' : 'border-black/15 text-ink'}`}>{label}</button>
          ))}
        </div>
      </fieldset>

      <div className="grid sm:grid-cols-2 gap-3 mt-2">
        {/* Rating 1-10 */}
        {step.capture.includes('rating') && (
          <label className="text-[11px] text-ink-muted">
            Condition (1 worst, 10 best)
            <select value={capture.rating ?? ''} onChange={(e) => onChange({ rating: e.target.value ? Number(e.target.value) : undefined })} className="block w-full border rounded-lg p-3 mt-1 text-sm">
              <option value="">Not rated</option>
              {Array.from({ length: 10 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
            </select>
          </label>
        )}
        {/* Flag */}
        {step.capture.includes('flag') && (
          <label className="flex items-center gap-2 text-xs text-ink-mid">
            <input type="checkbox" checked={!!capture.flagged} onChange={(e) => onChange({ flagged: e.target.checked, result: e.target.checked ? 'concern' : 'no-concern' })} />
            {step.walkAwaySignal ? 'Present (concern)' : 'Flag an issue here'}
          </label>
        )}
        {/* Reading */}
        {step.capture.includes('reading') && (
          <input aria-label="Reading or value" value={capture.reading ?? ''} onChange={(e) => onChange({ reading: e.target.value })} placeholder="Reading / value" className="border border-black/[0.08] rounded-md px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-navy/30" />
        )}
      </div>

      {/* Cost capture */}
      {priced && (
        <div className="mt-2 bg-bg rounded-lg p-2.5 flex items-center gap-2 flex-wrap">
          {priced.kind === 'unit' ? (
            <label className="text-[11px] text-ink-muted">
              Qty ({priced.unitLabel})
              <input type="number" min="0" value={capture.cost?.quantity ?? ''} onChange={(e) => setCost({ quantity: e.target.value === '' ? undefined : Number(e.target.value) })} className="ml-1 w-20 border border-black/[0.08] rounded-md px-2 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-navy/30" />
            </label>
          ) : (
            <>
              <select aria-label="Room for cost area" value={capture.cost?.roomId ?? ''} onChange={(e) => setCost({ roomId: e.target.value || undefined, areaSqm: undefined })} className="border border-black/[0.08] rounded-md px-2 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-navy/30">
                <option value="">Area from room...</option>
                {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <select aria-label="Surface for cost area" value={capture.cost?.areaBasis ?? 'floor'} onChange={(e) => setCost({ areaBasis: e.target.value as 'floor' | 'wall' | 'ceiling' })} className="border border-black/[0.08] rounded-md px-2 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-navy/30">
                <option value="floor">floor area</option>
                <option value="wall">wall area</option>
                <option value="ceiling">ceiling area</option>
              </select>
              <label className="text-xs">Or measured area (m²)
                <input type="number" min="0" step="0.1" value={capture.cost?.areaSqm ?? ''} onChange={(e) => setCost({ areaSqm: e.target.value === '' ? undefined : Number(e.target.value) })} className="ml-2 w-24 border rounded-md p-3" />
              </label>
            </>
          )}
          {line && line.total > 0 && (
            <span className="text-xs font-bold text-ink ml-auto">{gbp(line.total)} <span className="font-normal text-ink-muted">({gbp(line.material)} mat + {gbp(line.labour)} lab)</span></span>
          )}
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-3 mt-2 items-start">
        {step.capture.includes('photo') && (
          <ImageUpload value={capture.photos?.[0]} onChange={(d) => onChange({ photos: d ? [d] : [] })} label="Photo" />
        )}
        <label className="text-sm">{needsReason ? 'Reason this check was skipped' : 'Notes'}
          <textarea value={capture.notes ?? ''} onChange={(e) => onChange({ notes: e.target.value })} required={needsReason} aria-invalid={needsReason && !capture.notes?.trim()} rows={3} className="mt-1 border border-black/[0.08] rounded-md p-3 text-sm focus:outline-none focus:ring-2 focus:ring-navy/30 w-full" />
          {needsReason && !capture.notes?.trim() && <span className="block text-xs text-amber-700 mt-1">Add a reason before this check counts as reviewed.</span>}
        </label>
      </div>
    </div>
  );
}
