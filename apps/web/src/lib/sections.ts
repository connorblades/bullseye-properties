import {
  Briefcase, Target, Database, Home, BarChart3, Banknote, Gavel,
  Eye, ShieldCheck, TrendingUp, Hammer, Calculator, Send, FileText, MailCheck,
  type LucideIcon,
} from 'lucide-react';

/**
 * The wizard runs in three phases that map to the two-report delivery flow:
 *
 *   pre     -> desk research. Producing the shareable Outline pack (REPORT 1)
 *              and moving the deal to the viewing.
 *   viewing -> the on-site Viewing Report (12-point checklist + photos +
 *              condition + sign-off). Captured at the property; feeds Report 2.
 *   post    -> desk analysis layered on the viewing findings, ending in the
 *              full Standard Deal Report (REPORT 2), gated by the sign-off.
 */
export type WizardPhase = 'pre' | 'viewing' | 'post';

export type Section = {
  id: string;
  slug: string;
  title: string;
  short: string;
  description: string;
  icon: LucideIcon;
  conditional?: boolean;
  phase: WizardPhase;
};

export const SECTIONS: Section[] = [
  { id: '1',  slug: 'new-deal',       title: 'New Deal',                short: 'New Deal',      description: 'Property address and the client you are sourcing for.',                                          icon: Briefcase,   phase: 'pre' },
  { id: '2',  slug: 'criteria',       title: 'Client Criteria',         short: 'Criteria',      description: 'Budget, area, type, yield target, refurb tolerance, timeline.',                               icon: Target,      phase: 'pre' },
  { id: '3',  slug: 'auto-pull',      title: 'Auto-Pull and Location',  short: 'Auto-Pull',     description: 'Public data prefilled. Upload area map and local context images.',                            icon: Database,    phase: 'pre' },
  { id: '4',  slug: 'property',       title: 'Property Details',        short: 'Property',      description: 'Confirm or correct anything Auto-Pull missed.',                                                icon: Home,        phase: 'pre' },
  { id: '5',  slug: 'sales-comps',    title: 'Sales Comparables',       short: 'Sales Comps',   description: 'Minimum 3, evidenced with source links. AI-assisted.',                                         icon: BarChart3,   phase: 'pre' },
  { id: '6',  slug: 'rental-comps',   title: 'Rental Comparables',      short: 'Rental Comps',  description: 'Minimum 3, evidenced. Sets realistic rental income.',                                          icon: Banknote,    phase: 'pre' },
  { id: '7',  slug: 'auction-checks', title: 'Auction Checks',          short: 'Auction',       description: 'Legal Pack Analyser: fees, special conditions, total cost.',                                  icon: Gavel,       phase: 'pre', conditional: true },
  { id: '8',  slug: 'viewing',        title: 'Viewing Report',          short: 'Viewing',       description: 'Photos plus structured condition assessment. Mobile-friendly.',                                icon: Eye,         phase: 'viewing' },
  { id: '9',  slug: 'due-diligence',  title: 'Due Diligence',           short: 'DD',            description: 'The 20+ checks: crime, flood, EPC, planning, title, demographics.',                            icon: ShieldCheck, phase: 'post' },
  { id: '10', slug: 'growth-drivers', title: 'Local Growth Drivers',    short: 'Growth',        description: 'Capture the 4 drivers that justify your capital-growth assumption. Image upload per driver.',  icon: TrendingUp,  phase: 'post' },
  { id: '11', slug: 'refurb',         title: 'Refurbishment Estimate',  short: 'Refurb',        description: 'Itemised by room, with contingency and timeline.',                                             icon: Hammer,      phase: 'post', conditional: true },
  { id: '12', slug: 'financials',     title: 'Financial Analysis',      short: 'Financials',    description: 'Yields, ROI, growth assumptions, mortgage scenario, equity projection preview.',              icon: Calculator,  phase: 'post' },
  { id: '13', slug: 'offer',          title: 'Offer and Strategy',      short: 'Offer',         description: 'Recommended offer, anchor, negotiation strategy.',                                             icon: Send,        phase: 'post' },
  { id: '14', slug: 'generate',       title: 'Generate Final Report',   short: 'Generate',      description: 'Compile every section, plus the viewing findings, into the full Standard Deal Report (Report 2).', icon: FileText,  phase: 'post' },
  { id: '15', slug: 'deliver',        title: 'Deliver to Investor',     short: 'Deliver',       description: 'Secure shareable link plus PDF download. Investor view gated until this stage.',              icon: MailCheck,   phase: 'post' },
];

/** Phase metadata for the wizard rail: the label and the artifact each phase produces. */
export const WIZARD_PHASES: { key: WizardPhase; label: string; produces: string }[] = [
  { key: 'pre',     label: 'Pre-viewing',  produces: 'Report 1 - Outline pack (shareable teaser)' },
  { key: 'viewing', label: 'Viewing',      produces: 'Viewing report - captured on-site' },
  { key: 'post',    label: 'Post-viewing', produces: 'Report 2 - full report (gated by sign-off)' },
];

/** The 1-based step numbers that make up a phase. */
export function stepsInPhase(phase: WizardPhase): number[] {
  return SECTIONS.flatMap((s, i) => (s.phase === phase ? [i + 1] : []));
}
