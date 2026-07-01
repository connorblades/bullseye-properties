import type { Deal } from './deal-store';

/**
 * Risk-flag derivation for the report (Report v2). Pure: turns the deal + pulled
 * public data into a ranked set of colour-coded flags so the report can surface
 * red flags at a glance (flood, crime, EPC, ownership, planning) instead of
 * burying them in grey body text. Shown to investors, colour-coded (Connor,
 * 2026-07-01).
 */

export type RiskLevel = 'red' | 'amber' | 'info' | 'good';

export interface RiskFlag {
  level: RiskLevel;
  title: string;
  detail: string;
}

const LEVEL_RANK: Record<RiskLevel, number> = { red: 0, amber: 1, info: 2, good: 3 };

/** EPC bands below C (the grant/standard threshold). */
function epcBelowC(band: string | undefined): boolean {
  const b = (band ?? '').trim().toUpperCase();
  return b === 'D' || b === 'E' || b === 'F' || b === 'G';
}

/**
 * Derive all risk flags for a deal, most severe first. Positives (good) are
 * included so the report can also reassure where a factor is favourable.
 */
export function deriveRiskFlags(deal: Deal): RiskFlag[] {
  const flags: RiskFlag[] = [];
  const pub = deal.publicData;

  // Flood (EA Flood Map for Planning zone).
  const band = pub?.flood?.band;
  if (band === 3) {
    flags.push({ level: 'red', title: 'Flood Zone 3 (high risk)', detail: '1% or greater annual chance of river flooding. Confirm flood insurance and mortgageability before proceeding.' });
  } else if (band === 2) {
    flags.push({ level: 'amber', title: 'Flood Zone 2 (medium risk)', detail: 'Between 0.1% and 1% annual chance of flooding. Check insurance availability and cost.' });
  } else if (band === 1) {
    flags.push({ level: 'good', title: 'Flood Zone 1 (low risk)', detail: 'Low probability of river or sea flooding.' });
  }

  // Crime vs district average.
  const crime = deal.location?.crime;
  if (crime) {
    if (crime.comparison === 'higher') {
      flags.push({ level: 'amber', title: 'Crime above district average', detail: `${crime.total12mo.toLocaleString('en-GB')} recorded offences in 12 months${crime.comparisonPct ? `, ${crime.comparisonPct} above the district average` : ''}. Review the categories driving it.` });
    } else if (crime.comparison === 'lower') {
      flags.push({ level: 'good', title: 'Crime below district average', detail: `${crime.total12mo.toLocaleString('en-GB')} recorded offences in 12 months, below the district average.` });
    }
  }

  // EPC rating vs the C standard.
  const epc = pub?.epc;
  if (epc?.currentRating) {
    if (epcBelowC(epc.currentRating)) {
      flags.push({ level: 'amber', title: `EPC ${epc.currentRating} - below the C standard`, detail: `Potential ${epc.potentialRating || 'C'} after improvements. Factor any works needed to reach a C into the refurbishment budget.` });
    } else {
      flags.push({ level: 'good', title: `EPC ${epc.currentRating}`, detail: 'Meets or exceeds the C standard.' });
    }
  }

  // Corporate / overseas ownership (HMLR CCOD/OCOD).
  const titles = pub?.landOwnership?.titles ?? [];
  if (titles.length > 0) {
    const owner = titles[0]?.proprietors?.[0]?.name;
    const overseas = titles.some((t) => t.dataset === 'ocod');
    flags.push({
      level: 'info',
      title: overseas ? 'Overseas-registered owner' : 'Corporate-owned title',
      detail: `${owner ? `${owner} holds the title (HMLR). ` : ''}Confirm the sale structure and who has authority to sell.`,
    });
  }

  // Planning designations.
  if (pub?.planning?.listed) {
    flags.push({ level: 'amber', title: 'Listed building', detail: 'Alterations require listed-building consent; refurbishment scope and cost may be constrained.' });
  }
  if (pub?.planning?.conservationArea) {
    flags.push({ level: 'info', title: 'Conservation area', detail: 'Extra planning control over external changes; permitted-development rights may be restricted.' });
  }

  return flags.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]);
}

/** Only the flags that warrant attention (red / amber), most severe first. */
export function keyRiskFlags(deal: Deal): RiskFlag[] {
  return deriveRiskFlags(deal).filter((f) => f.level === 'red' || f.level === 'amber');
}
