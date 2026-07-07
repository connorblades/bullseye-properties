import 'server-only';
import { z } from 'zod';
import type { LegalPackSections, Fee, Clause } from '@/lib/legal-pack';

/**
 * Zod encoding of the four-section JSON Claude must return (M11 / AC-18).
 *
 * The wire shape (section1..section4) is exactly the schema baked into the
 * verbatim system prompt (ported from `legal-pack-analyser.html`), so Claude's
 * output validates 1:1. `toSections` maps the validated wire object to the
 * app's friendly `LegalPackSections` shape used by the store and the UI.
 *
 * Validation happens server-side only: a malformed response is rejected before
 * anything is persisted, and the API key never leaves the server.
 */

const FeeWire = z.object({
  name: z.string(),
  fixed: z.coerce.number().default(0),
  pct: z.coerce.number().default(0),
  vatApplies: z.enum(['Yes', 'No', 'TBC']).catch('TBC'),
  whenPayable: z.string().default(''),
  note: z.string().optional(),
});

const ClauseWire = z.object({
  question: z.string(),
  answer: z.string(),
  severity: z.enum(['High', 'Medium', 'Low']).catch('Low'),
});

export const LegalPackWireSchema = z.object({
  property: z.string().optional(),
  section1: z.object({ fees: z.array(FeeWire).default([]) }).default({ fees: [] }),
  section2: z.object({ clauses: z.array(ClauseWire).default([]) }).default({ clauses: [] }),
  section3: z.object({ otherNotes: z.array(z.string()).default([]) }).default({ otherNotes: [] }),
  section4: z.object({ clientSummary: z.string().default('') }).default({ clientSummary: '' }),
});

export type LegalPackWire = z.infer<typeof LegalPackWireSchema>;

/** Map the validated wire object to the app's four-section shape. */
export function toSections(wire: LegalPackWire): LegalPackSections {
  const fees: Fee[] = wire.section1.fees.map((f) => ({
    name: f.name,
    fixed: f.fixed,
    pct: f.pct,
    vatApplies: f.vatApplies,
    whenPayable: f.whenPayable,
    ...(f.note ? { note: f.note } : {}),
  }));
  const clauses: Clause[] = wire.section2.clauses.map((c) => ({
    question: c.question,
    answer: c.answer,
    severity: c.severity,
  }));
  return {
    property: wire.property,
    fees,
    clauses,
    notes: wire.section3.otherNotes.filter((n) => n && n.trim()),
    clientSummary: wire.section4.clientSummary,
  };
}

/**
 * Strip an optional ```json fence and parse Claude's raw text into validated
 * sections. Throws (ZodError / SyntaxError) on anything that is not the
 * expected JSON - the caller surfaces that as an analysis failure.
 */
export function parseLegalPackResponse(rawText: string): LegalPackSections {
  const clean = rawText
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  const json = JSON.parse(clean) as unknown;
  const wire = LegalPackWireSchema.parse(json);
  return toSections(wire);
}
