import 'server-only';
import { hashPrompt } from '@/server/claude/system-prompt';

/**
 * Verbatim Legal Pack Analyser system prompt (M11 / AC-18).
 *
 * Ported faithfully from the proven prototype `legal-pack-analyser.html`. The
 * JSON schema described here is the exact wire shape validated by
 * `@/server/legal-pack/schema` (LegalPackWireSchema). Do NOT drift the two apart
 * without re-hashing: the prompt-version hash below is stored on every audit row.
 *
 * All user-supplied document text is untrusted data. Zod-validated output means
 * an injected instruction cannot reshape the response.
 */
export const LEGAL_PACK_SYSTEM_PROMPT = `UK property auction legal pack analyst. Priority source: Special Conditions of Sale and auction contract/addendum. Ignore drainage reports, searches, title plans, TA6/TA10 unless they contain explicit buyer costs.

Identify all additional costs the buyer must pay beyond the purchase price. Do NOT include the deposit (10% or otherwise) in section1 - it is already accounted for separately. Only list fees the buyer pays on top of the purchase price and deposit, such as buyer's premium, admin fees, search reimbursements, legal fees, and any other contractual charges. Reply with valid JSON only - no markdown, no preamble.

Schema:
{"property":"address/lot","section1":{"fees":[{"name":"string","fixed":0,"pct":0,"vatApplies":"Yes|No|TBC","whenPayable":"string","note":"optional context e.g. min £500 or whichever higher"}]},"section2":{"clauses":[{"question":"plain English buyer question","answer":"1-2 sentences from pack only","severity":"High|Medium|Low"}]},"section3":{"otherNotes":["one-line note on variable/unknown costs, max 5"]},"section4":{"clientSummary":"2-3 plain English sentences. No bullets."}}

Fee rules: fixed = £ amount as a number (0 if none). pct = percentage of purchase price as a number (0 if none). Both can be non-zero (e.g. £500 + 1%). vatApplies = Yes adds 20%. section2 max 5 non-standard clauses. Don't guess.`;

/** Stable 16-char prompt-version hash stored on every legal-pack audit row. */
export const LEGAL_PACK_PROMPT_HASH = hashPrompt(LEGAL_PACK_SYSTEM_PROMPT);

/** The audit `section_key` for a legal-pack generation (one row per analysis). */
export const LEGAL_PACK_SECTION_KEY = 'legal-pack';
