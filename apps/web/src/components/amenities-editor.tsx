'use client';

import { useState } from 'react';
import {
  Plus, Footprints, Car, Train,
  ShoppingBag, Stethoscope, GraduationCap,
  TreePine, Camera, UtensilsCrossed, Factory,
  type LucideIcon,
} from 'lucide-react';
import type { Amenity, AmenityCategory, TravelMode } from '@/lib/deal-store';

export const CATEGORY_META: Record<AmenityCategory, { label: string; icon: LucideIcon; tone: string }> = {
  groceries:   { label: 'Groceries',   icon: ShoppingBag,      tone: 'bg-amber/15 text-amber border-amber/30' },
  transport:   { label: 'Transport',   icon: Train,            tone: 'bg-navy/[0.08] text-navy border-navy/20' },
  healthcare:  { label: 'Healthcare',  icon: Stethoscope,      tone: 'bg-red-100 text-red-700 border-red-200' },
  education:   { label: 'Education',   icon: GraduationCap,    tone: 'bg-purple-100 text-purple-700 border-purple-200' },
  recreation:  { label: 'Recreation',  icon: TreePine,         tone: 'bg-success-light text-success-dark border-success/30' },
  tourism:     { label: 'Tourism',     icon: Camera,           tone: 'bg-pink-100 text-pink-700 border-pink-200' },
  dining:      { label: 'Dining',      icon: UtensilsCrossed,  tone: 'bg-orange-100 text-orange-700 border-orange-200' },
  employment:  { label: 'Employment',  icon: Factory,          tone: 'bg-slate-100 text-slate-700 border-slate-200' },
};

const MODE_ICON: Record<TravelMode, LucideIcon> = {
  walk: Footprints,
  drive: Car,
  transit: Train,
};

export function AmenitiesEditor({
  amenities,
  onChange,
}: {
  amenities: Amenity[];
  onChange: (next: Amenity[]) => void;
}) {
  const [activeMode, setActiveMode] = useState<TravelMode>('walk');

  const walk = amenities.filter((a) => a.mode === 'walk').sort((a, b) => a.travelMinutes - b.travelMinutes);
  const drive = amenities.filter((a) => a.mode === 'drive').sort((a, b) => a.travelMinutes - b.travelMinutes);
  const transit = amenities.filter((a) => a.mode === 'transit').sort((a, b) => a.travelMinutes - b.travelMinutes);
  const showing = activeMode === 'walk' ? walk : activeMode === 'drive' ? drive : transit;

  const add = () => {
    const a: Amenity = {
      id: 'a-' + Math.random().toString(36).slice(2, 8),
      category: 'groceries',
      name: '',
      distanceText: '',
      travelMinutes: 0,
      mode: activeMode,
    };
    onChange([...amenities, a]);
  };
  const set = (id: string, patch: Partial<Amenity>) =>
    onChange(amenities.map((a) => (a.id === id ? { ...a, ...patch } : a)));

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="text-xs text-ink-muted">
          Radius pull from public sources. Production source: OpenStreetMap Overpass API + OSRM routing for travel times.
        </div>
        <div className="flex gap-1 bg-bg rounded-lg p-1">
          {(['walk', 'drive', 'transit'] as const).map((m) => {
            const Icon = MODE_ICON[m];
            const count = m === 'walk' ? walk.length : m === 'drive' ? drive.length : transit.length;
            return (
              <button
                key={m}
                onClick={() => setActiveMode(m)}
                className={`flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded transition ${
                  activeMode === m ? 'bg-white text-navy shadow-sm' : 'text-ink-mid hover:text-navy'
                }`}
              >
                <Icon size={12} />
                {m === 'walk' ? '5-min walk' : m === 'drive' ? '5-min drive' : 'Transit'}
                <span className="text-ink-muted font-bold">({count})</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        {showing.length === 0 && (
          <div className="text-center text-ink-muted text-sm py-6 bg-bg rounded-lg">
            No amenities in this radius yet. Add the first one below.
          </div>
        )}
        {showing.map((a) => {
          const meta = CATEGORY_META[a.category];
          const Icon = meta.icon;
          return (
            <div key={a.id} className="grid grid-cols-12 gap-2 items-center bg-bg rounded-lg p-2.5">
              <select
                value={a.category}
                onChange={(e) => set(a.id, { category: e.target.value as AmenityCategory })}
                className="col-span-3 border border-black/[0.08] bg-white rounded-md px-2 py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-navy/30"
              >
                {(Object.keys(CATEGORY_META) as AmenityCategory[]).map((c) => (
                  <option key={c} value={c}>{CATEGORY_META[c].label}</option>
                ))}
              </select>
              <input
                value={a.name}
                onChange={(e) => set(a.id, { name: e.target.value })}
                placeholder="e.g. Tesco Express"
                className="col-span-5 border border-black/[0.08] bg-white rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-navy/30"
              />
              <input
                value={a.distanceText}
                onChange={(e) => set(a.id, { distanceText: e.target.value })}
                placeholder="0.3 mi"
                className="col-span-1 border border-black/[0.08] bg-white rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-navy/30"
              />
              <input
                value={String(a.travelMinutes || '')}
                onChange={(e) => set(a.id, { travelMinutes: parseInt(e.target.value, 10) || 0 })}
                placeholder="5"
                className="col-span-2 border border-black/[0.08] bg-white rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-navy/30"
              />
              <div className="col-span-1 flex items-center justify-end">
                <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border ${meta.tone}`}>
                  <Icon size={10} />
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <button
        onClick={add}
        className="w-full mt-3 border-2 border-dashed border-black/[0.08] rounded-lg py-2.5 text-xs font-bold text-ink-muted hover:border-navy/30 hover:text-navy transition flex items-center justify-center gap-2"
      >
        <Plus size={14} /> Add amenity within {activeMode === 'walk' ? '5-min walk' : activeMode === 'drive' ? '5-min drive' : 'transit'}
      </button>
    </div>
  );
}

export function AmenitiesDisplay({ amenities }: { amenities: Amenity[] }) {
  if (amenities.length === 0) return <div className="text-sm text-ink-muted">No amenities recorded.</div>;

  const grouped = (Object.keys(CATEGORY_META) as AmenityCategory[]).map((cat) => ({
    cat,
    items: amenities.filter((a) => a.category === cat).sort((a, b) => a.travelMinutes - b.travelMinutes),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="grid grid-cols-2 gap-3">
      {grouped.map((g) => {
        const meta = CATEGORY_META[g.cat];
        const Icon = meta.icon;
        return (
          <div key={g.cat} className="bg-bg rounded-lg p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Icon size={14} className="text-navy" />
              <div className="text-xs font-bold text-ink uppercase tracking-wider">{meta.label}</div>
              <div className="text-[10px] text-ink-muted">({g.items.length})</div>
            </div>
            <ul className="space-y-1">
              {g.items.map((a) => (
                <li key={a.id} className="text-xs text-ink flex items-baseline justify-between gap-2">
                  <span className="truncate">{a.name}</span>
                  <span className="text-ink-muted whitespace-nowrap">
                    {a.distanceText} · {a.travelMinutes} min {a.mode === 'walk' ? 'walk' : a.mode === 'drive' ? 'drive' : 'transit'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
