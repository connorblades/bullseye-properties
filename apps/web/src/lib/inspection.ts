/**
 * Guided viewing inspection - model + cost engine (M6-T1).
 *
 * Pure, dependency-free domain logic for the on-site inspection app:
 *  - INSPECTION_STEPS: the chronological walkthrough (external roof -> loft ->
 *    heating -> electrics -> kitchen -> bathroom -> structure), captured as data.
 *  - PRICE_BOOK: seeded, editable default costs (area rates + per-unit material
 *    and labour) for the cost-bearing steps.
 *  - the cost engine: area-based items priced by captured room area, standalone
 *    items by quantity, labour added per item, then a single contingency of
 *    max(£3,000, 15%) on the subtotal.
 *
 * No React, no DB, no fetch - so it is fully unit-testable and reusable from the
 * walkthrough UI (M6-T3), the report (M6-T5), and tests. Confirmed against
 * Connor's spec, 2026-06-30 (see BSE-RPT-P01-M6-INSPECTION-SPEC.md).
 */

// ── Walkthrough model ───────────────────────────────────────────────────────

export type InspectionZone =
  | 'external-roof'
  | 'loft'
  | 'heating'
  | 'electrics'
  | 'kitchen'
  | 'bathroom'
  | 'structure';

/** Zones in their on-site (outside-in, top-to-bottom) order. */
export const ZONE_ORDER: { zone: InspectionZone; title: string }[] = [
  { zone: 'external-roof', title: 'External & roof' },
  { zone: 'loft', title: 'Loft' },
  { zone: 'heating', title: 'Heating & hot water' },
  { zone: 'electrics', title: 'Electrical & meters' },
  { zone: 'kitchen', title: 'Kitchen' },
  { zone: 'bathroom', title: 'Bathroom' },
  { zone: 'structure', title: 'Whole-property structure' },
];

/** What the viewer captures at a step. */
export type Capture = 'photo' | 'rating' | 'reading' | 'dimensions' | 'flag';

/** How a cost-bearing step is priced. */
export type CostMode = 'area' | 'unit';

/** Conditions that hide a step unless they apply to the property. */
export type StepCondition = 'end-or-semi';

/** On-site kit the viewer must take. */
export type EquipmentKey = 'laser-measure' | 'telescopic-ladder' | 'damp-meter';

export interface Equipment {
  key: EquipmentKey;
  label: string;
  why: string;
}

/** The kit to take to a viewing (Connor's spec, 2026-06-30). */
export const INSPECTION_KIT: Equipment[] = [
  { key: 'laser-measure', label: 'Laser measure', why: 'Measure rooms for the area-based costs (plastering, carpets, flooring).' },
  { key: 'telescopic-ladder', label: 'Telescopic ladder', why: 'Access the loft (spray-foam, insulation, water tanks).' },
  { key: 'damp-meter', label: 'Damp reading meter', why: 'Take damp readings, especially on the ground floor.' },
];

export interface InspectionStep {
  key: string;
  zone: InspectionZone;
  label: string;
  /** Plain instruction shown to the viewer. */
  guidance: string;
  /** The "good" criterion. */
  pass: string;
  capture: Capture[];
  /** When set, the step can carry a remediation cost priced via priceKey. */
  costMode?: CostMode;
  priceKey?: string;
  /** Only show this step when the condition holds. */
  condition?: StepCondition;
  /** A deal-killer signal (e.g. spray foam) rather than a costed item. */
  walkAwaySignal?: boolean;
  /** Kit this step needs (drives the pre-visit equipment list). */
  equipment?: EquipmentKey[];
}

export const INSPECTION_STEPS: InspectionStep[] = [
  // A. External / roof (from the ground, on arrival)
  { key: 'ridge-tiles', zone: 'external-roof', label: 'Ridge tiles', guidance: 'Check the ridge tiles are all present and seated.', pass: 'All present and in good order', capture: ['photo', 'rating'], costMode: 'unit', priceKey: 'ridge-rebed' },
  { key: 'chimney-flashing', zone: 'external-roof', label: 'Chimney lead flashing', guidance: 'Check the lead flashing around the chimney breast is intact, no slips.', pass: 'Flashing intact', capture: ['photo', 'rating'], costMode: 'unit', priceKey: 'chimney-flashing' },
  { key: 'soffits', zone: 'external-roof', label: 'Soffits', guidance: 'Check the soffits: material and condition. Plastic/uPVC, not asbestos.', pass: 'Sound, plastic not asbestos', capture: ['photo', 'rating'], costMode: 'unit', priceKey: 'soffit-fascia' },
  { key: 'fascias', zone: 'external-roof', label: 'Fascias', guidance: 'Check the fascias separately: material and condition.', pass: 'Sound', capture: ['photo', 'rating'], costMode: 'unit', priceKey: 'soffit-fascia' },
  { key: 'gable-caps', zone: 'external-roof', label: 'Gable / verge caps', guidance: 'On the exposed side, check the gable/verge caps are present.', pass: 'Caps present', capture: ['photo', 'rating'], costMode: 'unit', priceKey: 'verge-cap', condition: 'end-or-semi' },
  { key: 'asbestos', zone: 'external-roof', label: 'Asbestos check', guidance: 'Check soffits / garage roof / flue are plastic, NOT asbestos. Note the build era.', pass: 'No asbestos', capture: ['photo', 'flag'], costMode: 'unit', priceKey: 'asbestos-removal' },
  { key: 'windows', zone: 'external-roof', label: 'Windows double-glazed', guidance: 'Check all windows are double-glazed; count any single-glazed.', pass: 'All double-glazed', capture: ['photo', 'rating'], costMode: 'unit', priceKey: 'window' },
  { key: 'ext-cracks', zone: 'external-roof', label: 'External cracks / subsidence', guidance: 'Look for external cracks or signs of subsidence.', pass: 'No movement', capture: ['photo', 'flag'], costMode: 'unit', priceKey: 'structural-survey' },
  { key: 'ext-damp', zone: 'external-roof', label: 'External damp signs', guidance: 'Check render and the DPC for bridging or damp signs.', pass: 'No damp', capture: ['photo', 'rating'], costMode: 'area', priceKey: 'damp-proofing', equipment: ['damp-meter'] },

  // B. Loft
  { key: 'spray-foam', zone: 'loft', label: 'No spray-foam insulation', guidance: 'Take the telescopic ladder. Confirm the loft is NOT spray-foam insulated.', pass: 'No spray foam', capture: ['photo', 'flag'], walkAwaySignal: true, equipment: ['telescopic-ladder'] },
  { key: 'loft-insulation', zone: 'loft', label: 'Insulation present + depth', guidance: 'Confirm insulation is present to an adequate depth; measure the loft area.', pass: 'Insulated to depth', capture: ['photo', 'rating', 'dimensions'], costMode: 'area', priceKey: 'loft-insulation', equipment: ['telescopic-ladder', 'laser-measure'] },
  { key: 'no-tanks', zone: 'loft', label: 'No water tanks', guidance: 'Confirm there are no water tanks in the loft or airing cupboard (consistent with a combi).', pass: 'No tanks', capture: ['photo', 'flag'], costMode: 'unit', priceKey: 'combi-conversion', equipment: ['telescopic-ladder'] },

  // C. Heating & hot water
  { key: 'combi-boiler', zone: 'heating', label: 'Combi boiler (4 pipes)', guidance: 'Confirm a combi boiler by ~4 pipes (flow, return, hot, cold/condensate). No tanks anywhere.', pass: 'Combi, no tanks', capture: ['photo', 'rating'], costMode: 'unit', priceKey: 'combi-conversion' },
  { key: 'boiler-pressure', zone: 'heating', label: 'Boiler pressure', guidance: 'Check the boiler pressure is in range; if not, capture why.', pass: 'Pressure in range', capture: ['photo', 'reading'], costMode: 'unit', priceKey: 'boiler-repair' },
  { key: 'hot-water', zone: 'heating', label: 'Test hot water', guidance: 'Run the hot water and confirm it heats.', pass: 'Hot water runs', capture: ['rating'], costMode: 'unit', priceKey: 'boiler-repair' },
  { key: 'central-heating', zone: 'heating', label: 'Central heating / radiators', guidance: 'Confirm the radiators and central heating work.', pass: 'Working', capture: ['photo', 'rating'], costMode: 'unit', priceKey: 'radiator' },

  // D. Electrical & meters
  { key: 'consumer-unit', zone: 'electrics', label: 'Consumer unit (metal, double RCD)', guidance: 'Confirm a modern, metal-cased consumer unit with double RCD protection.', pass: 'Modern metal board, double RCD', capture: ['photo', 'rating'], costMode: 'unit', priceKey: 'consumer-unit' },
  { key: 'electric-meter', zone: 'electrics', label: 'Electric meter + isolation', guidance: 'Record the electric meter reading and the isolation point location.', pass: 'Recorded', capture: ['photo', 'reading'] },
  { key: 'gas-meter', zone: 'electrics', label: 'Gas meter + isolation', guidance: 'Record the gas meter reading and the isolation point location.', pass: 'Recorded', capture: ['photo', 'reading'] },
  { key: 'pat-testing', zone: 'electrics', label: 'PAT testing', guidance: 'Note any PAT testing on portable appliances (washing machine, microwave, etc.).', pass: 'Present where appliances supplied', capture: ['flag'] },

  // E. Kitchen
  { key: 'kitchen-cupboards', zone: 'kitchen', label: 'Cupboards open and close', guidance: 'Open and close the cupboards; confirm they operate properly.', pass: 'All operate', capture: ['photo', 'rating'], costMode: 'unit', priceKey: 'kitchen-refit' },
  { key: 'kitchen-condition', zone: 'kitchen', label: 'Units / worktops condition', guidance: 'Check the units and worktops are sound.', pass: 'Sound', capture: ['photo', 'rating'], costMode: 'unit', priceKey: 'kitchen-refit' },

  // F. Bathroom
  { key: 'bathroom-function', zone: 'bathroom', label: 'Bathroom working order', guidance: 'Test the taps and shower; confirm everything works.', pass: 'Works', capture: ['photo', 'rating'], costMode: 'unit', priceKey: 'bathroom-refit' },
  { key: 'bathroom-pressure', zone: 'bathroom', label: 'Hot water pressure', guidance: 'Check the hot water pressure at the bathroom.', pass: 'Adequate', capture: ['reading'], costMode: 'unit', priceKey: 'boiler-repair' },
  { key: 'bathroom-seal', zone: 'bathroom', label: 'Sealant / tiling / damp', guidance: 'Check sealant, tiling and any damp.', pass: 'Sound', capture: ['photo', 'rating'], costMode: 'unit', priceKey: 'bathroom-refit' },

  // G. Whole-property structure
  { key: 'internal-damp', zone: 'structure', label: 'Internal damp (ground floor)', guidance: 'Take damp-meter readings on the ground floor; check tide marks and mould. Measure affected areas.', pass: 'No damp', capture: ['photo', 'reading', 'dimensions'], costMode: 'area', priceKey: 'damp-proofing', equipment: ['damp-meter', 'laser-measure'] },
  { key: 'internal-cracks', zone: 'structure', label: 'Internal cracks / subsidence', guidance: 'Look for internal cracks or signs of subsidence.', pass: 'No movement', capture: ['photo', 'flag'], costMode: 'unit', priceKey: 'structural-survey' },
];

/** Steps for a property, dropping conditional steps that do not apply. */
export function stepsForProperty(opts: { endOrSemi?: boolean } = {}): InspectionStep[] {
  return INSPECTION_STEPS.filter((s) => {
    if (s.condition === 'end-or-semi') return Boolean(opts.endOrSemi);
    return true;
  });
}

/**
 * The kit to take for a given set of steps - the pre-visit equipment list. Kept
 * in INSPECTION_KIT order so the list reads consistently.
 */
export function kitForSteps(steps: InspectionStep[]): Equipment[] {
  const needed = new Set<EquipmentKey>();
  for (const s of steps) for (const e of s.equipment ?? []) needed.add(e);
  return INSPECTION_KIT.filter((k) => needed.has(k.key));
}

// ── Seeded price book (editable defaults, £) ────────────────────────────────

export interface AreaRate {
  kind: 'area';
  /** £ per square metre of material. */
  materialPerSqm: number;
  /** £ per square metre of labour. */
  labourPerSqm: number;
}

export interface UnitRate {
  kind: 'unit';
  /** £ material per unit (unit = each, or per metre - depends on the item). */
  materialPerUnit: number;
  /** £ labour per unit. */
  labourPerUnit: number;
  /** Human label for the unit, e.g. 'each' or 'metre'. */
  unitLabel: string;
}

export type PriceBookEntry = AreaRate | UnitRate;

/**
 * Default UK ballpark costs. These are starting points the partner edits on
 * site; a live material-price feed ("local data sources") is a future seam,
 * mirroring the rent-trend pattern (defaults now, ingest later).
 */
export const PRICE_BOOK: Record<string, PriceBookEntry> = {
  // Area-based (£/sqm)
  plastering: { kind: 'area', materialPerSqm: 6, labourPerSqm: 16 },
  carpet: { kind: 'area', materialPerSqm: 15, labourPerSqm: 5 },
  flooring: { kind: 'area', materialPerSqm: 20, labourPerSqm: 10 },
  decorating: { kind: 'area', materialPerSqm: 3, labourPerSqm: 7 },
  'loft-insulation': { kind: 'area', materialPerSqm: 8, labourPerSqm: 7 },
  'damp-proofing': { kind: 'area', materialPerSqm: 25, labourPerSqm: 45 },

  // Per-unit / standalone
  door: { kind: 'unit', materialPerUnit: 60, labourPerUnit: 60, unitLabel: 'each' },
  skirting: { kind: 'unit', materialPerUnit: 6, labourPerUnit: 8, unitLabel: 'metre' },
  architrave: { kind: 'unit', materialPerUnit: 5, labourPerUnit: 7, unitLabel: 'metre' },
  window: { kind: 'unit', materialPerUnit: 450, labourPerUnit: 150, unitLabel: 'each' },
  'ridge-rebed': { kind: 'unit', materialPerUnit: 15, labourPerUnit: 35, unitLabel: 'metre' },
  'chimney-flashing': { kind: 'unit', materialPerUnit: 80, labourPerUnit: 220, unitLabel: 'job' },
  'soffit-fascia': { kind: 'unit', materialPerUnit: 12, labourPerUnit: 18, unitLabel: 'metre' },
  'verge-cap': { kind: 'unit', materialPerUnit: 8, labourPerUnit: 12, unitLabel: 'metre' },
  'asbestos-removal': { kind: 'unit', materialPerUnit: 0, labourPerUnit: 500, unitLabel: 'job' },
  'consumer-unit': { kind: 'unit', materialPerUnit: 150, labourPerUnit: 350, unitLabel: 'each' },
  'combi-conversion': { kind: 'unit', materialPerUnit: 1200, labourPerUnit: 800, unitLabel: 'job' },
  'boiler-repair': { kind: 'unit', materialPerUnit: 100, labourPerUnit: 200, unitLabel: 'job' },
  radiator: { kind: 'unit', materialPerUnit: 90, labourPerUnit: 110, unitLabel: 'each' },
  'kitchen-refit': { kind: 'unit', materialPerUnit: 2500, labourPerUnit: 1500, unitLabel: 'job' },
  'bathroom-refit': { kind: 'unit', materialPerUnit: 1800, labourPerUnit: 1200, unitLabel: 'job' },
  'structural-survey': { kind: 'unit', materialPerUnit: 0, labourPerUnit: 600, unitLabel: 'job' },
};

// ── Cost engine ─────────────────────────────────────────────────────────────

export const MIN_CONTINGENCY_GBP = 3000;
export const CONTINGENCY_PCT = 15;

export interface CostItemInput {
  /** Free label for the report line. */
  label: string;
  priceKey: string;
  /** Units for a 'unit' price (each / metres / jobs). */
  quantity?: number;
  /** Area in square metres for an 'area' price (from captured room dimensions). */
  areaSqm?: number;
  /** Per-item overrides (editable on site); when set they replace the book rate. */
  overrideMaterial?: number;
  overrideLabour?: number;
}

export interface CostBreakdown {
  label: string;
  material: number;
  labour: number;
  total: number;
  /** Derived quantity for a measured take-off (e.g. bags / litres / metres). */
  quantity?: number;
  unit?: string;
  /** Human-readable justification of the figures (shown in the report). */
  basis?: string;
}

/** Cost one captured item. Unknown price keys and zero quantities cost nothing. */
export function itemCost(input: CostItemInput, book: Record<string, PriceBookEntry> = PRICE_BOOK): CostBreakdown {
  const entry = book[input.priceKey];
  let material = 0;
  let labour = 0;

  if (entry?.kind === 'area') {
    const area = Math.max(0, input.areaSqm ?? 0);
    material = area * entry.materialPerSqm;
    labour = area * entry.labourPerSqm;
  } else if (entry?.kind === 'unit') {
    const qty = Math.max(0, input.quantity ?? 0);
    material = qty * entry.materialPerUnit;
    labour = qty * entry.labourPerUnit;
  }

  if (input.overrideMaterial !== undefined) material = Math.max(0, input.overrideMaterial);
  if (input.overrideLabour !== undefined) labour = Math.max(0, input.overrideLabour);

  const round = (n: number) => Math.round(n);
  material = round(material);
  labour = round(labour);
  return { label: input.label, material, labour, total: material + labour };
}

/** Contingency on a subtotal: max(£3,000, 15%). Zero subtotal -> no contingency. */
export function contingencyFor(subtotal: number): number {
  if (subtotal <= 0) return 0;
  return Math.max(MIN_CONTINGENCY_GBP, Math.round((subtotal * CONTINGENCY_PCT) / 100));
}

// ── Measured take-off engine ────────────────────────────────────────────────
//
// From laser-measured room dimensions we derive quantities (wall area,
// perimeter, door count) and turn them into materials via standard coverage
// rates, with a material-usage waste allowance. Every line carries a `basis`
// string so the estimate justifies its own figures - a fair, QS-style take-off
// rather than an inflated tradesman quote.

/** A room measured on site (laser measure: length, width, height). */
export interface RoomDimensions {
  name: string;
  lengthM: number;
  widthM: number;
  heightM: number;
  /** Door openings in the room - drives the architrave take-off. */
  doors?: number;
}

export interface RoomGeometry {
  floorArea: number;
  ceilingArea: number;
  perimeter: number;
  wallArea: number; // gross, no deduction for openings
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function roomGeometry(r: RoomDimensions): RoomGeometry {
  const floorArea = round1(Math.max(0, r.lengthM) * Math.max(0, r.widthM));
  const perimeter = round1(2 * (Math.max(0, r.lengthM) + Math.max(0, r.widthM)));
  const wallArea = round1(perimeter * Math.max(0, r.heightM));
  return { floorArea, ceilingArea: floorArea, perimeter, wallArea };
}

/**
 * Take-off rates and coverages. Editable defaults; a live material-price feed is
 * a future seam. `materialWastePct` is the 10% allowance on measured material
 * usage (cuts / waste) - separate from the project contingency.
 */
export const TAKEOFF = {
  materialWastePct: 10,
  // Plaster: one bag covers ~12 sqm of wall.
  plasterCoveragePerBagSqm: 12,
  plasterBagPrice: 12,
  plasterLabourPerSqm: 16,
  // Paint: one litre covers ~12 sqm per coat.
  paintCoveragePerLitreSqm: 12,
  paintCoats: 2,
  paintLitrePrice: 5,
  paintLabourPerSqm: 7,
  // Skirting + architrave: priced per linear metre.
  skirtingMaterialPerM: 6,
  skirtingLabourPerM: 8,
  architraveMaterialPerM: 5,
  architraveLabourPerM: 7,
  /** Architrave per door: 2 legs (~2.1m) + head (~0.9m). */
  architravePerDoorM: 5.1,
};

type Takeoff = typeof TAKEOFF;
const withWaste = (qty: number, t: Takeoff) => qty * (1 + t.materialWastePct / 100);

/** Plaster a room: walls (optionally + ceiling) -> bags. */
export function plasterTakeoff(
  g: RoomGeometry,
  opts: { includeCeiling?: boolean } = {},
  t: Takeoff = TAKEOFF,
): CostBreakdown {
  const area = round1(g.wallArea + (opts.includeCeiling ? g.ceilingArea : 0));
  const allowed = withWaste(area, t);
  const bags = Math.ceil(allowed / t.plasterCoveragePerBagSqm);
  const material = bags * t.plasterBagPrice;
  const labour = Math.round(area * t.plasterLabourPerSqm);
  return {
    label: 'Plastering',
    quantity: bags,
    unit: 'bags',
    material,
    labour,
    total: material + labour,
    basis: `${area} sqm +${t.materialWastePct}% = ${round1(allowed)} sqm / ${t.plasterCoveragePerBagSqm} sqm per bag = ${bags} bags @ £${t.plasterBagPrice}; labour ${area} sqm @ £${t.plasterLabourPerSqm}`,
  };
}

/** Paint a room's walls across N coats -> litres. */
export function paintTakeoff(
  g: RoomGeometry,
  opts: { coats?: number } = {},
  t: Takeoff = TAKEOFF,
): CostBreakdown {
  const coats = opts.coats ?? t.paintCoats;
  const area = g.wallArea;
  const coverage = area * coats;
  const allowed = withWaste(coverage, t);
  const litres = Math.ceil(allowed / t.paintCoveragePerLitreSqm);
  const material = litres * t.paintLitrePrice;
  const labour = Math.round(area * t.paintLabourPerSqm);
  return {
    label: 'Painting',
    quantity: litres,
    unit: 'litres',
    material,
    labour,
    total: material + labour,
    basis: `${area} sqm x ${coats} coats +${t.materialWastePct}% = ${round1(allowed)} sqm / ${t.paintCoveragePerLitreSqm} sqm per litre = ${litres} L @ £${t.paintLitrePrice}; labour ${area} sqm @ £${t.paintLabourPerSqm}`,
  };
}

/** Skirting board: room perimeter -> linear metres. */
export function skirtingTakeoff(g: RoomGeometry, t: Takeoff = TAKEOFF): CostBreakdown {
  const allowed = withWaste(g.perimeter, t);
  const metres = Math.ceil(allowed);
  const material = metres * t.skirtingMaterialPerM;
  const labour = Math.round(g.perimeter * t.skirtingLabourPerM);
  return {
    label: 'Skirting board',
    quantity: metres,
    unit: 'metres',
    material,
    labour,
    total: material + labour,
    basis: `perimeter ${g.perimeter} m +${t.materialWastePct}% = ${metres} m @ £${t.skirtingMaterialPerM}/m; labour ${g.perimeter} m @ £${t.skirtingLabourPerM}/m`,
  };
}

/** Architrave: door count x per-door length -> linear metres. */
export function architraveTakeoff(doors: number, t: Takeoff = TAKEOFF): CostBreakdown {
  const n = Math.max(0, doors);
  const raw = round1(n * t.architravePerDoorM);
  const allowed = withWaste(raw, t);
  const metres = Math.ceil(allowed);
  const material = metres * t.architraveMaterialPerM;
  const labour = Math.round(raw * t.architraveLabourPerM);
  return {
    label: 'Architraves',
    quantity: metres,
    unit: 'metres',
    material,
    labour,
    total: material + labour,
    basis: `${n} doors x ${t.architravePerDoorM} m +${t.materialWastePct}% = ${metres} m @ £${t.architraveMaterialPerM}/m; labour ${raw} m @ £${t.architraveLabourPerM}/m`,
  };
}

export type RoomWork = 'plaster' | 'paint' | 'skirting' | 'architrave';

/** Run the chosen measured take-offs for a room and return one line each. */
export function roomTakeoff(
  room: RoomDimensions,
  works: RoomWork[],
  opts: { includeCeiling?: boolean } = {},
  t: Takeoff = TAKEOFF,
): CostBreakdown[] {
  const g = roomGeometry(room);
  const lines: CostBreakdown[] = [];
  for (const w of works) {
    let line: CostBreakdown;
    if (w === 'plaster') line = plasterTakeoff(g, { includeCeiling: opts.includeCeiling }, t);
    else if (w === 'paint') line = paintTakeoff(g, {}, t);
    else if (w === 'skirting') line = skirtingTakeoff(g, t);
    else line = architraveTakeoff(room.doors ?? 0, t);
    lines.push({ ...line, label: `${room.name}: ${line.label}` });
  }
  return lines;
}

// ── Refurb estimate (combines standalone items + measured take-off lines) ────

export interface RefurbEstimate {
  lines: CostBreakdown[];
  materialSubtotal: number;
  labourSubtotal: number;
  subtotal: number;
  contingency: number;
  total: number;
}

/**
 * Summarise any set of cost lines into the refurb estimate: subtotal, project
 * contingency (max £3k / 15%), grand total. This is the number that flows into
 * Report 2 and back into the indicative offer (M6-T5).
 */
export function summariseRefurb(lines: CostBreakdown[]): RefurbEstimate {
  const materialSubtotal = lines.reduce((s, l) => s + l.material, 0);
  const labourSubtotal = lines.reduce((s, l) => s + l.labour, 0);
  const subtotal = materialSubtotal + labourSubtotal;
  const contingency = contingencyFor(subtotal);
  return { lines, materialSubtotal, labourSubtotal, subtotal, contingency, total: subtotal + contingency };
}

/** Convenience: estimate straight from standalone price-book items. */
export function refurbEstimate(
  items: CostItemInput[],
  book: Record<string, PriceBookEntry> = PRICE_BOOK,
): RefurbEstimate {
  return summariseRefurb(items.map((i) => itemCost(i, book)));
}

// ── On-site capture model + aggregation (M6-T3) ─────────────────────────────
//
// What the walkthrough UI collects; the pure functions here turn it into cost
// lines + the refurb estimate, so the UI stays a thin data-collector.

/** A room measured on site, with the measured take-offs the partner selected. */
export interface RoomEntry extends RoomDimensions {
  id: string;
  works?: RoomWork[];
  includeCeiling?: boolean;
}

/** What the partner captured against one walkthrough step. */
export interface StepCapture {
  /** Condition score 1 (worst) - 10 (best). */
  rating?: number;
  notes?: string;
  /** Meter reading / boiler pressure / etc. */
  reading?: string;
  /** A yes/no flag step (e.g. spray foam present, asbestos present). */
  flagged?: boolean;
  photos?: string[];
  cost?: StepCostCapture;
}

export interface StepCostCapture {
  /** Units for a 'unit'-priced step. */
  quantity?: number;
  /** Take the area for an 'area'-priced step from this room. */
  roomId?: string;
  /** Which of the room's areas to use (default floor). */
  areaBasis?: 'floor' | 'wall' | 'ceiling';
  /** Explicit area override (sqm), used ahead of roomId. */
  areaSqm?: number;
  overrideMaterial?: number;
  overrideLabour?: number;
}

export interface InspectionState {
  rooms: RoomEntry[];
  /** Per-step capture, keyed by step.key. */
  steps: Record<string, StepCapture>;
}

export function emptyInspection(): InspectionState {
  return { rooms: [], steps: {} };
}

function areaFrom(capture: StepCostCapture, rooms: RoomEntry[]): number {
  if (capture.areaSqm !== undefined) return Math.max(0, capture.areaSqm);
  const room = rooms.find((r) => r.id === capture.roomId);
  if (!room) return 0;
  const g = roomGeometry(room);
  if (capture.areaBasis === 'wall') return g.wallArea;
  if (capture.areaBasis === 'ceiling') return g.ceilingArea;
  return g.floorArea;
}

/**
 * Turn a captured inspection into cost lines: the price-book cost of each
 * cost-bearing step the partner priced, plus the measured take-offs for each
 * room. Steps with no captured cost, or a zero quantity/area, contribute
 * nothing.
 */
export function buildInspectionLines(
  state: InspectionState,
  steps: InspectionStep[] = INSPECTION_STEPS,
  book: Record<string, PriceBookEntry> = PRICE_BOOK,
): CostBreakdown[] {
  const lines: CostBreakdown[] = [];
  const byKey = new Map(steps.map((s) => [s.key, s]));

  for (const [key, capture] of Object.entries(state.steps)) {
    const step = byKey.get(key);
    if (!step?.costMode || !step.priceKey || !capture.cost) continue;
    const c = capture.cost;
    const line = itemCost(
      {
        label: step.label,
        priceKey: step.priceKey,
        quantity: c.quantity,
        areaSqm: step.costMode === 'area' ? areaFrom(c, state.rooms) : undefined,
        overrideMaterial: c.overrideMaterial,
        overrideLabour: c.overrideLabour,
      },
      book,
    );
    if (line.total > 0) lines.push(line);
  }

  for (const room of state.rooms) {
    if (room.works?.length) {
      lines.push(...roomTakeoff(room, room.works, { includeCeiling: room.includeCeiling }));
    }
  }

  return lines;
}

/** The refurb estimate for a captured inspection (lines + contingency). */
export function inspectionRefurb(
  state: InspectionState,
  steps: InspectionStep[] = INSPECTION_STEPS,
  book: Record<string, PriceBookEntry> = PRICE_BOOK,
): RefurbEstimate {
  return summariseRefurb(buildInspectionLines(state, steps, book));
}

/** Walkthrough completeness: steps with a rating or a photo, out of the total. */
export function inspectionProgress(
  state: InspectionState,
  steps: InspectionStep[] = INSPECTION_STEPS,
): { done: number; total: number } {
  const done = steps.filter((s) => {
    const c = state.steps[s.key];
    return c && (c.rating !== undefined || (c.photos?.length ?? 0) > 0 || c.flagged !== undefined);
  }).length;
  return { done, total: steps.length };
}
