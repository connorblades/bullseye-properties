'use client';

import { useMemo } from 'react';
import { Plus, Trash2, Ruler, AlertTriangle } from 'lucide-react';
import { ImageUpload } from '@/components/image-upload';
import {
  ZONE_ORDER,
  PRICE_BOOK,
  INSPECTION_KIT,
  stepsForProperty,
  kitForSteps,
  roomGeometry,
  itemCost,
  inspectionRefurb,
  inspectionProgress,
  emptyInspection,
  type InspectionState,
  type RoomEntry,
  type StepCapture,
  type RoomWork,
  type InspectionStep,
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
  const steps = useMemo(() => stepsForProperty({ endOrSemi }), [endOrSemi]);
  const kit = useMemo(() => kitForSteps(steps), [steps]);
  const est = useMemo(() => inspectionRefurb(s, steps), [s, steps]);
  const progress = inspectionProgress(s, steps);

  const setStep = (key: string, patch: Partial<StepCapture>) =>
    onChange({ ...s, steps: { ...s.steps, [key]: { ...s.steps[key], ...patch } } });
  const setRooms = (rooms: RoomEntry[]) => onChange({ ...s, rooms });

  const addRoom = () =>
    setRooms([
      ...s.rooms,
      { id: `room-${s.rooms.length + 1}-${Date.now().toString(36)}`, name: `Room ${s.rooms.length + 1}`, lengthM: 0, widthM: 0, heightM: 2.4, doors: 1, works: [] },
    ]);
  const setRoom = (id: string, patch: Partial<RoomEntry>) =>
    setRooms(s.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRoom = (id: string) => setRooms(s.rooms.filter((r) => r.id !== id));

  return (
    <div className="space-y-4">
      {/* Kit list */}
      <div className="card p-4 bg-navy/[0.03] border-navy/20">
        <div className="text-xs font-bold text-navy uppercase tracking-wider mb-2">Kit to take</div>
        <div className="grid sm:grid-cols-3 gap-2">
          {(kit.length ? kit : INSPECTION_KIT).map((k) => (
            <div key={k.key} className="text-xs">
              <div className="font-bold text-ink">{k.label}</div>
              <div className="text-ink-muted">{k.why}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Progress + running total */}
      <div className="card p-4 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="text-xs font-bold text-ink-mid uppercase tracking-wider">Walkthrough</div>
          <div className="text-sm text-ink-mid">{progress.done} / {progress.total} steps captured</div>
        </div>
        <div className="text-right">
          <div className="text-xs font-bold text-ink-muted uppercase tracking-wide">Refurb estimate</div>
          <div className="text-2xl font-black text-ink">{gbp(est.total)}</div>
          <div className="text-[11px] text-ink-muted">
            {gbp(est.subtotal)} works + {gbp(est.contingency)} contingency
          </div>
        </div>
      </div>

      {/* Rooms (laser measure -> measured take-offs) */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-1">
          <div className="text-sm font-black text-ink flex items-center gap-1.5"><Ruler size={15} /> Rooms &amp; measurements</div>
          <button onClick={addRoom} className="btn-secondary text-xs"><Plus size={13} /> Add room</button>
        </div>
        <p className="text-xs text-ink-muted mb-3">Laser-measure length, width, height and door count. Tick the works and the cost is taken off from the measurements (plaster in bags, paint in litres, skirting/architrave in metres, +10% waste).</p>
        {s.rooms.length === 0 && <div className="text-xs text-ink-muted py-3">No rooms measured yet.</div>}
        <div className="space-y-3">
          {s.rooms.map((r) => {
            const g = roomGeometry(r);
            return (
              <div key={r.id} className="border border-black/[0.08] rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <input value={r.name} onChange={(e) => setRoom(r.id, { name: e.target.value })} className="flex-1 border border-black/[0.08] rounded-md px-2 py-1.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-navy/30" />
                  <button onClick={() => removeRoom(r.id)} className="text-ink-muted hover:text-red-600 p-1"><Trash2 size={15} /></button>
                </div>
                <div className="grid grid-cols-4 gap-2 mb-2">
                  {([['lengthM', 'Length m'], ['widthM', 'Width m'], ['heightM', 'Height m'], ['doors', 'Doors']] as const).map(([k, label]) => (
                    <label key={k} className="text-[11px] text-ink-muted">
                      {label}
                      <input
                        type="number" inputMode="decimal" step="0.1" min="0"
                        value={(r[k] as number) || ''}
                        onChange={(e) => setRoom(r.id, { [k]: Number(e.target.value) } as Partial<RoomEntry>)}
                        className="w-full border border-black/[0.08] rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-navy/30"
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
                        key={w.key}
                        onClick={() => setRoom(r.id, { works: on ? (r.works ?? []).filter((x) => x !== w.key) : [...(r.works ?? []), w.key] })}
                        className={`text-xs font-semibold px-2.5 py-1 rounded-lg border ${on ? 'bg-navy text-white border-navy' : 'border-black/[0.12] text-ink-mid'}`}
                      >
                        {w.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Zoned steps */}
      {ZONE_ORDER.map((z) => {
        const zoneSteps = steps.filter((st) => st.zone === z.zone);
        if (zoneSteps.length === 0) return null;
        return (
          <div key={z.zone} className="card p-5">
            <div className="text-xs font-bold text-navy uppercase tracking-wider mb-3">{z.title}</div>
            <div className="space-y-4">
              {zoneSteps.map((step) => (
                <StepRow key={step.key} step={step} capture={s.steps[step.key] ?? {}} rooms={s.rooms} onChange={(p) => setStep(step.key, p)} />
              ))}
            </div>
          </div>
        );
      })}
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

      <div className="grid sm:grid-cols-2 gap-3 mt-2">
        {/* Rating 1-10 */}
        {step.capture.includes('rating') && (
          <label className="text-[11px] text-ink-muted">
            Condition: <span className="font-bold text-ink">{capture.rating ?? '-'}</span> / 10
            <input type="range" min={1} max={10} value={capture.rating ?? 5} onChange={(e) => onChange({ rating: Number(e.target.value) })} className="w-full accent-navy" />
          </label>
        )}
        {/* Flag */}
        {step.capture.includes('flag') && (
          <label className="flex items-center gap-2 text-xs text-ink-mid">
            <input type="checkbox" checked={!!capture.flagged} onChange={(e) => onChange({ flagged: e.target.checked })} />
            {step.walkAwaySignal ? 'Present (concern)' : 'Flag an issue here'}
          </label>
        )}
        {/* Reading */}
        {step.capture.includes('reading') && (
          <input value={capture.reading ?? ''} onChange={(e) => onChange({ reading: e.target.value })} placeholder="Reading / value" className="border border-black/[0.08] rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-navy/30" />
        )}
      </div>

      {/* Cost capture */}
      {priced && (
        <div className="mt-2 bg-bg rounded-lg p-2.5 flex items-center gap-2 flex-wrap">
          {priced.kind === 'unit' ? (
            <label className="text-[11px] text-ink-muted">
              Qty ({priced.unitLabel})
              <input type="number" min="0" value={capture.cost?.quantity ?? ''} onChange={(e) => setCost({ quantity: Number(e.target.value) })} className="ml-1 w-20 border border-black/[0.08] rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-navy/30" />
            </label>
          ) : (
            <>
              <select value={capture.cost?.roomId ?? ''} onChange={(e) => setCost({ roomId: e.target.value || undefined })} className="border border-black/[0.08] rounded-md px-2 py-1 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-navy/30">
                <option value="">Area from room...</option>
                {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <select value={capture.cost?.areaBasis ?? 'floor'} onChange={(e) => setCost({ areaBasis: e.target.value as 'floor' | 'wall' })} className="border border-black/[0.08] rounded-md px-2 py-1 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-navy/30">
                <option value="floor">floor area</option>
                <option value="wall">wall area</option>
              </select>
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
        <input value={capture.notes ?? ''} onChange={(e) => onChange({ notes: e.target.value })} placeholder="Notes" className="border border-black/[0.08] rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-navy/30 self-start w-full" />
      </div>
    </div>
  );
}
