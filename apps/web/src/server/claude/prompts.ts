import 'server-only';
import { z } from 'zod';
import { SYSTEM_PROMPT, hashPrompt } from './system-prompt';
import { generateGuarded, type GuardedGenerateOptions } from './generate';
import type { StreamMessageResult } from './client';

/**
 * The five Claude-drafted narrative sections (M3-T2).
 *
 * Each section pairs a static instruction `template` (versioned by hash) with a
 * `buildUserPrompt(context)` that appends the deal fact digest. Output is prose
 * with inline [VERIFY: ...] markers; `parseSectionOutput` lifts those markers
 * into a structured, Zod-validated result that the audit row and the editor UI
 * both consume.
 */

export type SectionKey =
  | 'why-this-fits'
  | 'location'
  | 'condition'
  | 'offer-rationale'
  | 'next-steps';

export const SECTION_ORDER: SectionKey[] = [
  'why-this-fits',
  'location',
  'condition',
  'offer-rationale',
  'next-steps',
];

export const SectionResultSchema = z.object({
  narrative: z.string().min(1, 'narrative must not be empty'),
  verifyFlags: z.array(z.string()),
});
export type SectionResult = z.infer<typeof SectionResultSchema>;

type SectionDef = {
  key: SectionKey;
  label: string;
  template: string;
  maxTokens: number;
};

const COMMON_TAIL =
  'Use only the facts in the deal data below. Do not invent figures, names, distances, dates, schemes, or comparables. ' +
  'Where a claim would help but the data does not support it, write the marker [VERIFY: what the partner must confirm] inline. ' +
  'Return clean prose only - no heading, no preamble, no sign-off.';

const DEFS: Record<SectionKey, SectionDef> = {
  'why-this-fits': {
    key: 'why-this-fits',
    label: 'Why this property fits',
    maxTokens: 1200,
    template:
      'Draft the "Why this property fits" section. In two or three tight paragraphs, explain how this property matches ' +
      "the investor's stated criteria (budget, area, type, yield, timeline) and the case for their attention. Anchor every " +
      'claim to a stated figure or fact. ' + COMMON_TAIL,
  },
  location: {
    key: 'location',
    label: 'Location overview',
    maxTokens: 1400,
    template:
      'Draft the "Location overview" section. In two or three paragraphs, characterise the immediate area for a buy-to-let ' +
      'investor: amenities and transport, demographics and the local economy, schools, and any flood, crime, planning or ' +
      'deprivation context that bears on rental demand and risk. Be balanced - note negatives plainly. ' + COMMON_TAIL,
  },
  condition: {
    key: 'condition',
    label: 'Condition interpretation',
    maxTokens: 1200,
    template:
      'Draft the "Condition assessment" narrative. Interpret the viewing-report ratings (roof, damp, windows, heating, ' +
      'electrics, structure), the EPC, and any refurbishment plan into a plain-English read of the property\'s condition and ' +
      'what the works imply for the investor. Do not assert a defect the ratings or notes do not record. ' + COMMON_TAIL,
  },
  'offer-rationale': {
    key: 'offer-rationale',
    label: 'Offer recommendation rationale',
    maxTokens: 1200,
    template:
      'Draft the "Offer recommendation" rationale. Explain, transparently, why the recommended offer is justified by the ' +
      'comparable evidence, condition, and the investor\'s return targets, and outline the negotiation strategy from the ' +
      'partner\'s notes. State plainly that the figure is a recommendation, not a valuation or a guarantee. ' + COMMON_TAIL,
  },
  'next-steps': {
    key: 'next-steps',
    label: 'Next steps',
    maxTokens: 900,
    template:
      'Draft the "Next steps" section as a short, ordered list of concrete actions for the investor to move this deal ' +
      'forward (e.g. review the pack, confirm finance, instruct a solicitor, authorise the offer). Keep each step to one ' +
      'sentence. ' + COMMON_TAIL,
  },
};

export function sectionDef(key: SectionKey): SectionDef {
  return DEFS[key];
}

export function buildUserPrompt(key: SectionKey, context: string): string {
  return `${DEFS[key].template}\n\n--- DEAL DATA ---\n${context}`;
}

/** Stable prompt-version hash for a section: system prompt + static template. */
export function sectionPromptHash(key: SectionKey): string {
  return hashPrompt(SYSTEM_PROMPT, DEFS[key].template);
}

/**
 * Lift inline [VERIFY: ...] markers out of the prose into a structured list,
 * leaving the markers in the narrative so the partner sees them in the editor.
 */
export function parseSectionOutput(text: string): SectionResult {
  const verifyFlags: string[] = [];
  const re = /\[VERIFY:\s*([^\]]+)\]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    verifyFlags.push(m[1].trim());
  }
  return SectionResultSchema.parse({ narrative: text.trim(), verifyFlags });
}

export type GenerateSectionOptions = {
  section: SectionKey;
  context: string;
  tenantId: string;
  /** Full accumulated text so far. */
  onText?: (fullText: string) => void;
  onFallback?: (info: { model: string; attempt: number }) => void;
  /** Injectable for tests - defaults to the guarded generator. */
  generate?: (opts: GuardedGenerateOptions) => Promise<StreamMessageResult>;
};

export type GeneratedSection = SectionResult & {
  section: SectionKey;
  promptVersionHash: string;
  modelUsed: string;
  inputTokens: number;
  outputTokens: number;
  rawText: string;
  /** True when AI was unavailable and the partner must draft this section. */
  manualDraft: boolean;
};

/** Generate a single section: build prompt -> generate -> parse + validate. */
export async function generateSection(opts: GenerateSectionOptions): Promise<GeneratedSection> {
  const def = DEFS[opts.section];
  const gen = opts.generate ?? generateGuarded;
  const result = await gen({
    tenantId: opts.tenantId,
    system: SYSTEM_PROMPT,
    userPrompt: buildUserPrompt(opts.section, opts.context),
    maxTokens: def.maxTokens,
    onText: opts.onText,
    onFallback: opts.onFallback,
  });
  const parsed = parseSectionOutput(result.text);
  return {
    ...parsed,
    section: opts.section,
    promptVersionHash: sectionPromptHash(opts.section),
    modelUsed: result.modelUsed,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    rawText: result.text,
    manualDraft: false,
  };
}

/** Placeholder shown when AI is fully unavailable - partner drafts in its place. */
export const MANUAL_DRAFT_PLACEHOLDER =
  'AI drafting is unavailable right now. Write this section manually, or save and regenerate later.';

/**
 * Resilient wrapper (M3-T3): never throws. On a total Claude outage it returns
 * a manual-draft section so the PDF compile is never blocked. `onError` lets
 * the caller log/surface the underlying failure.
 */
export async function generateSectionResilient(
  opts: GenerateSectionOptions & { onError?: (err: unknown) => void }
): Promise<GeneratedSection> {
  try {
    return await generateSection(opts);
  } catch (err) {
    opts.onError?.(err);
    return {
      narrative: MANUAL_DRAFT_PLACEHOLDER,
      verifyFlags: [],
      section: opts.section,
      promptVersionHash: sectionPromptHash(opts.section),
      modelUsed: 'manual',
      inputTokens: 0,
      outputTokens: 0,
      rawText: '',
      manualDraft: true,
    };
  }
}
