import 'server-only';
import React from 'react';
import { View, Text, Image, Svg, Path, Circle } from '@react-pdf/renderer';
import { C, FONTS, fmtGBP, fmtPct } from '../tokens';
import { SectionHeading, Card, Body, Prose } from '../components';
import type { ReportData } from '../report-data';
import { parseMoney } from '@/lib/deal-calcs';

/**
 * PDF Sections 13-16 (M3-T9): Financial analysis, Offer recommendation,
 * Next steps, and Your accredited partner. Reads only from `data`; uses the
 * precomputed `data.fin` figures and never recomputes financials (SDLT is the
 * one acquisition line not carried in `fin`, so it is estimated here).
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Additional-property SDLT estimate (England, illustrative): standard bands
 * plus a 5% surcharge applied to the whole purchase price.
 */
function estimateSdlt(price: number): number {
  if (price <= 0) return 0;
  const bands: { upTo: number; rate: number }[] = [
    { upTo: 125_000, rate: 0 },
    { upTo: 250_000, rate: 0.02 },
    { upTo: 925_000, rate: 0.05 },
    { upTo: 1_500_000, rate: 0.1 },
    { upTo: Infinity, rate: 0.12 },
  ];
  let standard = 0;
  let lower = 0;
  for (const b of bands) {
    if (price > lower) {
      const taxable = Math.min(price, b.upTo) - lower;
      standard += taxable * b.rate;
      lower = b.upTo;
    } else break;
  }
  const surcharge = price * 0.05;
  return Math.round(standard + surcharge);
}

/** Split a narrative into discrete steps; fall back to a sensible default. */
function parseSteps(text: string | undefined): string[] {
  const fallback = ['Review the pack', 'Confirm finance', 'Instruct a solicitor', 'Authorise the offer'];
  if (!text || !text.trim()) return fallback;
  // Prefer line breaks (numbered/bulleted lists), else sentence-split.
  let parts = text
    .split(/\r?\n+/)
    .map((s) => s.replace(/^\s*(?:\d+[.)]\s*|[-*•]\s*)/, '').trim())
    .filter(Boolean);
  if (parts.length < 2) {
    parts = text
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.replace(/[.]+$/, '').trim())
      .filter((s) => s.length > 0);
  }
  parts = parts.filter((s) => s.length > 1).slice(0, 6);
  return parts.length >= 2 ? parts : fallback;
}

// ─── Small presentational atoms ─────────────────────────────────────────────

function Th({ children, align = 'left', flex = 1 }: { children: React.ReactNode; align?: 'left' | 'right'; flex?: number }) {
  return (
    <Text
      style={{
        flex,
        fontFamily: FONTS.body,
        fontSize: 7.5,
        fontWeight: 700,
        color: C.inkMuted,
        letterSpacing: 0.4,
        textAlign: align,
      }}
    >
      {children}
    </Text>
  );
}

function Row({
  label,
  value,
  bold = false,
  muted = false,
  last = false,
}: {
  label: string;
  value: string;
  bold?: boolean;
  muted?: boolean;
  last?: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 4,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: C.border,
      }}
    >
      <Text style={{ fontFamily: FONTS.body, fontSize: 9.5, fontWeight: bold ? 700 : 400, color: muted ? C.inkMuted : C.ink }}>
        {label}
      </Text>
      <Text style={{ fontFamily: FONTS.body, fontSize: 9.5, fontWeight: bold ? 700 : 400, color: muted ? C.inkMuted : C.ink }}>
        {value}
      </Text>
    </View>
  );
}

function PartnerField({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ marginBottom: 6 }}>
      <Text style={{ fontFamily: FONTS.body, fontSize: 7, fontWeight: 700, color: C.inkMuted, letterSpacing: 0.5 }}>
        {label.toUpperCase()}
      </Text>
      <Text style={{ fontFamily: FONTS.body, fontSize: 9.5, color: C.ink, marginTop: 1 }}>{value}</Text>
    </View>
  );
}

// ─── Section 13: Financial analysis ─────────────────────────────────────────

function FinancialAnalysis({ data }: { data: ReportData }) {
  const { deal, fin } = data;
  const purchasePrice = parseMoney(deal.financials.purchasePrice) ?? fin.purchasePrice ?? 0;

  const solicitors = 1500;
  const searches = 500;
  const survey = 600;
  const sourcing = 3000;
  const refurb = fin.refurbWithContingency || 0;
  const sdlt = estimateSdlt(purchasePrice);

  const acquisition: { label: string; value: number; note?: string }[] = [
    { label: 'Purchase price', value: purchasePrice },
    { label: 'Stamp Duty (additional property, estimate)', value: sdlt },
    { label: 'Solicitors', value: solicitors },
    { label: 'Searches', value: searches },
    { label: 'Survey', value: survey },
    { label: 'Sourcing fee', value: sourcing },
    { label: 'Refurbishment incl. contingency', value: refurb },
  ];
  const totalAcquisition = acquisition.reduce((s, a) => s + a.value, 0);

  // Mortgage scenarios.
  const rate = (parseFloat(deal.growth.mortgageRatePct) || 0) / 100;
  const annualRent = fin.annualRent || 0;
  const annualCosts = fin.annualCosts || 0;
  // Non-mortgage cash always required (everything in acquisition except the loan portion).
  const fixedCosts = sdlt + solicitors + searches + survey + sourcing + refurb;

  type Scenario = {
    name: string;
    ltv: number; // 0 for cash
  };
  const scenarios: Scenario[] = [
    { name: 'Cash', ltv: 0 },
    { name: '60% LTV', ltv: 0.6 },
    { name: '75% LTV', ltv: 0.75 },
  ];

  function compute(ltv: number) {
    const loan = purchasePrice * ltv;
    const deposit = purchasePrice - loan;
    const cashIn = deposit + fixedCosts;
    const interest = loan * rate;
    const cashflow = annualRent - annualCosts - interest;
    const coc = cashIn > 0 ? (cashflow / cashIn) * 100 : 0;
    return { loan, deposit, cashIn, interest, cashflow, coc };
  }

  const computed = scenarios.map((s) => ({ ...s, ...compute(s.ltv) }));

  // Stress tests against the 75% LTV scenario.
  const base75 = computed[2];
  const loan75 = purchasePrice * 0.75;
  const stressRate = base75.cashflow - loan75 * 0.02; // rate +2%
  const stressVoid = base75.cashflow - annualRent / 12; // one month void

  const cocColour = (v: number) => (v >= 7 ? C.success : v >= 4 ? C.amber : C.red);

  return (
    <>
      <SectionHeading
        index={13}
        title="Financial analysis"
        subtitle="Acquisition costs, funding scenarios and stress tests"
        breakPage
      />

      {/* Acquisition breakdown */}
      <Card style={{ marginBottom: 10 }}>
        <Text style={{ fontFamily: FONTS.body, fontSize: 11, fontWeight: 700, color: C.ink, marginBottom: 6 }}>
          Acquisition breakdown
        </Text>
        {acquisition.map((a) => (
          <Row key={a.label} label={a.label} value={fmtGBP(a.value)} muted={a.value === 0} />
        ))}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 6,
            paddingTop: 8,
            paddingHorizontal: 8,
            paddingBottom: 8,
            backgroundColor: C.navy,
            borderRadius: 6,
          }}
        >
          <Text style={{ fontFamily: FONTS.body, fontSize: 10, fontWeight: 700, color: C.white }}>
            Total cash to complete
          </Text>
          <Text style={{ fontFamily: FONTS.body, fontSize: 12, fontWeight: 700, color: C.white }}>
            {fmtGBP(totalAcquisition)}
          </Text>
        </View>
      </Card>

      {/* Mortgage scenarios */}
      <Card style={{ marginBottom: 10 }}>
        <Text style={{ fontFamily: FONTS.body, fontSize: 11, fontWeight: 700, color: C.ink, marginBottom: 2 }}>
          Funding scenarios
        </Text>
        <Body style={{ fontSize: 8.5, marginBottom: 8 }}>
          {`Interest-only at ${fmtPct(rate * 100)}. Annual rent ${fmtGBP(annualRent)}, annual costs ${fmtGBP(annualCosts)}.`}
        </Body>

        {/* Header row */}
        <View style={{ flexDirection: 'row', paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: C.border }}>
          <Th flex={1.4}>METRIC</Th>
          {computed.map((s) => (
            <Th key={s.name} align="right">
              {s.name === 'Cash' ? 'CASH' : s.name.toUpperCase()}
            </Th>
          ))}
        </View>

        {[
          { label: 'Deposit / cash in', get: (s: typeof base75) => fmtGBP(s.cashIn) },
          { label: 'Mortgage loan', get: (s: typeof base75) => (s.loan > 0 ? fmtGBP(s.loan) : '—') },
          { label: 'Annual interest', get: (s: typeof base75) => (s.interest > 0 ? fmtGBP(s.interest) : '—') },
          { label: 'Net annual cashflow', get: (s: typeof base75) => fmtGBP(s.cashflow) },
        ].map((m) => (
          <View
            key={m.label}
            style={{ flexDirection: 'row', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: C.border, alignItems: 'center' }}
          >
            <Text style={{ flex: 1.4, fontFamily: FONTS.body, fontSize: 8.5, color: C.inkMid }}>{m.label}</Text>
            {computed.map((s) => (
              <Text
                key={s.name}
                style={{ flex: 1, fontFamily: FONTS.body, fontSize: 8.5, color: C.ink, textAlign: 'right' }}
              >
                {m.get(s)}
              </Text>
            ))}
          </View>
        ))}

        {/* Cash-on-cash highlighted */}
        <View style={{ flexDirection: 'row', paddingTop: 6, alignItems: 'center' }}>
          <Text style={{ flex: 1.4, fontFamily: FONTS.body, fontSize: 8.5, fontWeight: 700, color: C.ink }}>
            Cash-on-cash return
          </Text>
          {computed.map((s) => (
            <Text
              key={s.name}
              style={{ flex: 1, fontFamily: FONTS.body, fontSize: 10, fontWeight: 700, color: cocColour(s.coc), textAlign: 'right' }}
            >
              {fmtPct(s.coc)}
            </Text>
          ))}
        </View>
      </Card>

      {/* Stress tests */}
      <Card style={{ marginBottom: 10 }}>
        <Text style={{ fontFamily: FONTS.body, fontSize: 11, fontWeight: 700, color: C.ink, marginBottom: 2 }}>
          Stress tests (75% LTV)
        </Text>
        <Body style={{ fontSize: 8.5, marginBottom: 6 }}>
          {`Base net annual cashflow at 75% LTV: ${fmtGBP(base75.cashflow)}.`}
        </Body>
        <Row label="Interest rate +2%" value={`${fmtGBP(stressRate)} / yr`} muted={stressRate < 0} />
        <Row label="One month void (lost rent)" value={`${fmtGBP(stressVoid)} / yr`} muted={stressVoid < 0} last />
      </Card>

      <Body style={{ fontSize: 7.5, color: C.inkMuted }}>
        Stamp Duty and all funding figures are illustrative estimates based on the inputs provided and current
        additional-property rates. They are not tax, mortgage or financial advice. Confirm Stamp Duty with your
        solicitor and lending terms with a qualified broker before proceeding.
      </Body>
    </>
  );
}

// ─── Section 14: Offer recommendation ───────────────────────────────────────

function OfferRecommendation({ data }: { data: ReportData }) {
  const { deal, narratives } = data;
  const recommended = parseMoney(deal.offer.recommended);
  const asking = parseMoney(deal.property.askingPrice);
  const rationale = narratives['offer-rationale'];

  const fallbackRationale =
    asking && recommended
      ? `We recommend an offer of ${fmtGBP(recommended)} against an asking price of ${fmtGBP(
          asking,
        )}. This reflects the comparable evidence, the condition assessment and the works required to bring the property to a lettable standard while protecting your target return.`
      : recommended
        ? `We recommend an offer of ${fmtGBP(
            recommended,
          )}. This reflects the comparable evidence, the condition assessment and the works required while protecting your target return.`
        : 'The recommended offer reflects the comparable evidence, the condition assessment and the works required while protecting your target return.';

  return (
    <>
      <SectionHeading index={14} title="Offer recommendation" subtitle="Our recommended position and the reasoning behind it" breakPage />

      <Card style={{ marginBottom: 10, backgroundColor: C.navy, borderColor: C.navy }}>
        <Text style={{ fontFamily: FONTS.body, fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.75)', letterSpacing: 1 }}>
          RECOMMENDED OFFER
        </Text>
        <Text style={{ fontFamily: FONTS.display, fontSize: 34, fontWeight: 700, color: C.white, marginTop: 4 }}>
          {recommended ? fmtGBP(recommended) : 'To be confirmed'}
        </Text>
        {asking ? (
          <Text style={{ fontFamily: FONTS.body, fontSize: 9, color: 'rgba(255,255,255,0.8)', marginTop: 4 }}>
            {`Asking price ${fmtGBP(asking)}${
              recommended && asking > 0 ? `  ·  ${fmtPct(((asking - recommended) / asking) * 100)} below asking` : ''
            }`}
          </Text>
        ) : null}
      </Card>

      <Card wrap style={{ marginBottom: 10 }}>
        <Text style={{ fontFamily: FONTS.body, fontSize: 11, fontWeight: 700, color: C.ink, marginBottom: 6 }}>
          Rationale
        </Text>
        <Prose text={rationale && rationale.trim() ? rationale : fallbackRationale} />
      </Card>

      <Card style={{ backgroundColor: C.bg, borderColor: C.border }}>
        <Body style={{ fontSize: 9.5, fontWeight: 700, color: C.ink }}>
          We are open and transparent as Bullseye Partners. We work with pre-qualified buyers and submit offers on behalf
          of investors who do not have the time and knowledge to source themselves. No deals are pre-accepted with estate
          agents.
        </Body>
      </Card>
    </>
  );
}

// ─── Section 15: Next steps ─────────────────────────────────────────────────

function StepChip({ n, text }: { n: number; text: string }) {
  return (
    <View
      style={{
        width: '23%',
        marginRight: '2%',
        marginBottom: 8,
        backgroundColor: C.white,
        borderWidth: 1,
        borderColor: C.border,
        borderRadius: 8,
        padding: 9,
      }}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 11,
          backgroundColor: C.navy,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 6,
        }}
      >
        <Text style={{ fontFamily: FONTS.body, fontSize: 11, fontWeight: 700, color: C.white }}>{n}</Text>
      </View>
      <Text style={{ fontFamily: FONTS.body, fontSize: 8.5, lineHeight: 1.35, color: C.ink }}>{text}</Text>
    </View>
  );
}

function NextSteps({ data }: { data: ReportData }) {
  const steps = parseSteps(data.narratives['next-steps']);
  return (
    <>
      <SectionHeading index={15} title="Next steps" subtitle="How we move from this report to a completed purchase" breakPage />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {steps.map((s, i) => (
          <StepChip key={i} n={i + 1} text={s} />
        ))}
      </View>
    </>
  );
}

// ─── Section 16: Your accredited partner ────────────────────────────────────

function AccreditedPartner({ data }: { data: ReportData }) {
  const p = data.partner;

  const fields: { label: string; value?: string }[] = [
    { label: 'Accreditation number', value: p.accreditationNo },
    { label: 'Accredited since', value: p.accreditedAt },
    { label: 'AML registration', value: p.amlRegistration },
    { label: 'ICO registration', value: p.icoRegistration },
    { label: 'Professional indemnity', value: p.piPolicy },
    { label: 'Email', value: p.contactEmail },
    { label: 'Phone', value: p.contactPhone },
  ].filter((f) => f.value && f.value.trim());

  return (
    <>
      <SectionHeading index={16} title="Your accredited partner" subtitle="Who prepared and reviewed this report" breakPage />

      <Card>
        <View style={{ flexDirection: 'row' }}>
          {/* Avatar column */}
          <View style={{ width: 132, marginRight: 14, alignItems: 'center' }}>
            {p.avatarUrl ? (
              <Image
                src={p.avatarUrl}
                style={{ width: 120, height: 120, borderRadius: 8, objectFit: 'cover', borderWidth: 1, borderColor: C.border }}
              />
            ) : (
              <View
                style={{
                  width: 120,
                  height: 120,
                  borderRadius: 8,
                  backgroundColor: C.navy,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ fontFamily: FONTS.display, fontSize: 36, fontWeight: 700, color: C.white }}>
                  {(p.displayName || '?').trim().charAt(0).toUpperCase()}
                </Text>
              </View>
            )}

            {/* Accreditation badge under the avatar */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: C.navy,
                borderRadius: 6,
                paddingVertical: 4,
                paddingHorizontal: 7,
                marginTop: 8,
              }}
            >
              <Svg width={12} height={12} viewBox="0 0 24 24" style={{ marginRight: 4 }}>
                <Circle cx="12" cy="12" r="12" fill="none" />
                <Path d="M6.5 12.5 L10.5 16 L17.5 8" stroke={C.white} strokeWidth={2.6} fill="none" />
              </Svg>
              <Text style={{ color: C.white, fontFamily: FONTS.body, fontSize: 7, fontWeight: 700, letterSpacing: 0.6 }}>
                ACCREDITED PARTNER
              </Text>
            </View>
          </View>

          {/* Details column */}
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: FONTS.body, fontSize: 15, fontWeight: 700, color: C.ink }}>
              {p.displayName || 'Bullseye Partner'}
            </Text>
            <Text style={{ fontFamily: FONTS.body, fontSize: 9, color: C.navy, fontWeight: 700, marginTop: 1, marginBottom: 8 }}>
              Accredited Bullseye Partner
            </Text>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {fields.map((f) => (
                <View key={f.label} style={{ width: '50%', paddingRight: 8 }}>
                  <PartnerField label={f.label} value={f.value as string} />
                </View>
              ))}
            </View>
          </View>
        </View>

        {p.shortBio && p.shortBio.trim() ? (
          <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border }}>
            <Text style={{ fontFamily: FONTS.body, fontSize: 7, fontWeight: 700, color: C.inkMuted, letterSpacing: 0.5, marginBottom: 3 }}>
              ABOUT
            </Text>
            <Body style={{ fontSize: 9.5 }}>{p.shortBio}</Body>
          </View>
        ) : null}
      </Card>
    </>
  );
}

// ─── Group export ───────────────────────────────────────────────────────────

export function SectionsThirteenToSixteen({ data }: { data: ReportData }) {
  return (
    <>
      <FinancialAnalysis data={data} />
      <OfferRecommendation data={data} />
      <NextSteps data={data} />
      <AccreditedPartner data={data} />
    </>
  );
}
