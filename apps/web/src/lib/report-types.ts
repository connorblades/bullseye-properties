import type { SectionKey } from '@/server/claude/prompts';

/**
 * Shared types for the report-generation stream + publish flow (M3-T5).
 *
 * Kept out of the `'use server'` action module (which may only export async
 * functions) AND free of any runtime/server-only import, so the client wizard
 * can import it too. `SectionKey` is a type-only import, erased at build.
 */

/** Section order + display labels - client-safe (mirrors prompts.ts DEFS). */
export const SECTION_META: { key: SectionKey; label: string }[] = [
  { key: 'why-this-fits', label: 'Why this property fits' },
  { key: 'location', label: 'Location overview' },
  { key: 'condition', label: 'Condition assessment' },
  { key: 'offer-rationale', label: 'Offer recommendation' },
  { key: 'next-steps', label: 'Next steps' },
];

/** Live state of a single section as it streams into the wizard. */
export type SectionDraft = {
  text: string; // current AI text (streaming, then final)
  done: boolean;
  degraded: boolean; // Haiku fallback engaged
  manualDraft: boolean; // AI unavailable; partner must write it
  raw: string; // AI original, sent back at publish for the audit diff
  model: string;
  promptVersionHash: string;
  inputTokens: number;
  outputTokens: number;
};

export type ReportStreamState = Record<SectionKey, SectionDraft>;

export function emptyDraft(): SectionDraft {
  return {
    text: '',
    done: false,
    degraded: false,
    manualDraft: false,
    raw: '',
    model: '',
    promptVersionHash: '',
    inputTokens: 0,
    outputTokens: 0,
  };
}

/** What the client sends back when the partner publishes the edited draft. */
export type PublishSection = {
  section: SectionKey;
  raw: string; // AI original
  edited: string; // partner's published text
  model: string;
  promptVersionHash: string;
  inputTokens: number;
  outputTokens: number;
  manualDraft: boolean;
};
