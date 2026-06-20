import {
  Briefcase, Target, Database, Home, BarChart3, Banknote, Gavel,
  Eye, ShieldCheck, TrendingUp, Hammer, Calculator, Send, FileText, MailCheck,
  type LucideIcon,
} from 'lucide-react';

export type Section = {
  id: string;
  slug: string;
  title: string;
  short: string;
  description: string;
  icon: LucideIcon;
  conditional?: boolean;
};

export const SECTIONS: Section[] = [
  { id: '1',  slug: 'new-deal',       title: 'New Deal',                short: 'New Deal',      description: 'Property address and the client you are sourcing for.',                                          icon: Briefcase },
  { id: '2',  slug: 'criteria',       title: 'Client Criteria',         short: 'Criteria',      description: 'Budget, area, type, yield target, refurb tolerance, timeline.',                               icon: Target },
  { id: '3',  slug: 'auto-pull',      title: 'Auto-Pull and Location',  short: 'Auto-Pull',     description: 'Public data prefilled. Upload area map and local context images.',                            icon: Database },
  { id: '4',  slug: 'property',       title: 'Property Details',        short: 'Property',      description: 'Confirm or correct anything Auto-Pull missed.',                                                icon: Home },
  { id: '5',  slug: 'sales-comps',    title: 'Sales Comparables',       short: 'Sales Comps',   description: 'Minimum 3, evidenced with source links. AI-assisted.',                                         icon: BarChart3 },
  { id: '6',  slug: 'rental-comps',   title: 'Rental Comparables',      short: 'Rental Comps',  description: 'Minimum 3, evidenced. Sets realistic rental income.',                                          icon: Banknote },
  { id: '7',  slug: 'auction-checks', title: 'Auction Checks',          short: 'Auction',       description: 'Legal Pack Analyser: fees, special conditions, total cost.',                                  icon: Gavel,       conditional: true },
  { id: '8',  slug: 'viewing',        title: 'Viewing Report',          short: 'Viewing',       description: 'Photos plus structured condition assessment. Mobile-friendly.',                                icon: Eye },
  { id: '9',  slug: 'due-diligence',  title: 'Due Diligence',           short: 'DD',            description: 'The 20+ checks: crime, flood, EPC, planning, title, demographics.',                            icon: ShieldCheck },
  { id: '10', slug: 'growth-drivers', title: 'Local Growth Drivers',    short: 'Growth',        description: 'Capture the 4 drivers that justify your capital-growth assumption. Image upload per driver.',  icon: TrendingUp },
  { id: '11', slug: 'refurb',         title: 'Refurbishment Estimate',  short: 'Refurb',        description: 'Itemised by room, with contingency and timeline.',                                             icon: Hammer,      conditional: true },
  { id: '12', slug: 'financials',     title: 'Financial Analysis',      short: 'Financials',    description: 'Yields, ROI, growth assumptions, mortgage scenario, equity projection preview.',              icon: Calculator },
  { id: '13', slug: 'offer',          title: 'Offer and Strategy',      short: 'Offer',         description: 'Recommended offer, anchor, negotiation strategy.',                                             icon: Send },
  { id: '14', slug: 'generate',       title: 'Generate Report',         short: 'Generate',      description: 'Compile all sections into the branded Standard Deal Report.',                                  icon: FileText },
  { id: '15', slug: 'deliver',        title: 'Deliver to Investor',     short: 'Deliver',       description: 'Secure shareable link plus PDF download. Investor view gated until this stage.',              icon: MailCheck },
];
