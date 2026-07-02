import 'server-only';
import React from 'react';
import { View, Text, Image, Svg, Path, Rect, Circle, Line } from '@react-pdf/renderer';
import { C, FONTS, fmtGBP, fmtPct } from '../tokens';
import { SectionHeading, Card, Body, Prose } from '../components';
import type { ReportData } from '../report-data';

/**
 * PDF Sections 9-12 (M3-T8).
 *
 *  9. Auction risk (conditional)
 * 10. Refurbishment plan (conditional)
 * 11. Local growth drivers
 * 12. Equity projection and exit scenarios (key stacked-bar + cash-line chart)
 *
 * Reads only from `data`; financials/projection come precomputed from
 * data.fin / data.proj (never recomputed here).
 */

const CONTENT_W = 515;

// ── small shared bits ────────────────────────────────────────────────────────

/** Label/value stat used across cards. */
function Stat({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={{ marginRight: 18 }}>
      <Text style={{ fontFamily: FONTS.body, fontSize: 7.5, fontWeight: 700, color: C.inkMuted, letterSpacing: 0.6 }}>
        {label.toUpperCase()}
      </Text>
      <Text style={{ fontFamily: FONTS.body, fontSize: 13, fontWeight: 700, color: valueColor ?? C.ink, marginTop: 2 }}>
        {value}
      </Text>
    </View>
  );
}

/** Amber cautionary callout. */
function CautionNote({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: C.amberLight,
        borderLeftWidth: 3,
        borderLeftColor: C.amber,
        borderRadius: 4,
        padding: 8,
        marginTop: 10,
      }}
    >
      <Text style={{ fontFamily: FONTS.body, fontSize: 9, lineHeight: 1.45, color: C.ink }}>{children}</Text>
    </View>
  );
}

function num(s: string | undefined): number {
  const n = parseFloat((s ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

// ── Section 9: Auction Risk ───────────────────────────────────────────────────

function AuctionSection({ data }: { data: ReportData }) {
  const a = data.deal.auction;
  const fees = num(a.buyerFees);
  return (
    <>
      <SectionHeading
        index={9}
        title="Auction Risk"
        subtitle="Buyer-side costs and legal conditions specific to an auction purchase"
        breakPage
      />
      <Card>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          <Stat label="Buyer-side fees" value={fmtGBP(fees)} valueColor={C.navy} />
          <Stat
            label="Special conditions"
            value={a.specialConditions ? 'Disclosed' : 'None noted'}
            valueColor={a.specialConditions ? C.amber : C.success}
          />
          <Stat
            label="Restrictive covenants"
            value={a.restrictiveCovenants ? 'Present' : 'None noted'}
            valueColor={a.restrictiveCovenants ? C.amber : C.success}
          />
        </View>

        {a.specialConditions ? (
          <View style={{ marginTop: 12 }}>
            <Text style={{ fontFamily: FONTS.body, fontSize: 8.5, fontWeight: 700, color: C.inkMuted, letterSpacing: 0.6 }}>
              SPECIAL CONDITIONS OF SALE
            </Text>
            <Prose text={a.specialConditions} style={{ marginTop: 3, fontSize: 9.5 }} />
          </View>
        ) : null}

        {a.restrictiveCovenants ? (
          <View style={{ marginTop: 12 }}>
            <Text style={{ fontFamily: FONTS.body, fontSize: 8.5, fontWeight: 700, color: C.inkMuted, letterSpacing: 0.6 }}>
              RESTRICTIVE COVENANTS
            </Text>
            <Prose text={a.restrictiveCovenants} style={{ marginTop: 3, fontSize: 9.5 }} />
          </View>
        ) : null}

        <CautionNote>
          {`Auction purchases are legally binding on the fall of the hammer. The buyer-side fees above are payable on top of the hammer price and are non-refundable. Review the full legal pack and budget the additional ${fmtGBP(
            fees
          )} in fees before bidding.`}
        </CautionNote>
      </Card>
    </>
  );
}

// ── Section 10: Refurbishment plan ────────────────────────────────────────────

function RefurbSection({ data }: { data: ReportData }) {
  const r = data.deal.refurb;
  const contingencyPct = num(r.contingencyPct);
  const weeks = (r.weeks ?? '').trim();
  return (
    <>
      <SectionHeading
        index={10}
        title="Refurbishment Plan"
        subtitle="Itemised works, contingency and total budget"
        breakPage
      />
      <Card>
        {/* Table header */}
        <View
          style={{
            flexDirection: 'row',
            borderBottomWidth: 1,
            borderBottomColor: C.border,
            paddingBottom: 5,
            marginBottom: 2,
          }}
        >
          <Text style={{ flex: 1, fontFamily: FONTS.body, fontSize: 8, fontWeight: 700, color: C.inkMuted, letterSpacing: 0.6 }}>
            WORKS
          </Text>
          <Text style={{ width: 90, textAlign: 'right', fontFamily: FONTS.body, fontSize: 8, fontWeight: 700, color: C.inkMuted, letterSpacing: 0.6 }}>
            COST
          </Text>
        </View>

        {r.items.map((item, i) => (
          <View
            key={item.id}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingVertical: 5,
              borderBottomWidth: i === r.items.length - 1 ? 0 : 1,
              borderBottomColor: C.border,
            }}
          >
            <Text style={{ flex: 1, fontFamily: FONTS.body, fontSize: 10, color: C.ink }}>
              {item.name || 'Refurbishment item'}
            </Text>
            <Text style={{ width: 90, textAlign: 'right', fontFamily: FONTS.body, fontSize: 10, color: C.ink }}>
              {fmtGBP(num(item.cost))}
            </Text>
          </View>
        ))}

        {/* Subtotal + contingency */}
        <View style={{ flexDirection: 'row', paddingTop: 8, marginTop: 4, borderTopWidth: 1, borderTopColor: C.border }}>
          <Text style={{ flex: 1, fontFamily: FONTS.body, fontSize: 9.5, color: C.inkMid }}>Works subtotal</Text>
          <Text style={{ width: 90, textAlign: 'right', fontFamily: FONTS.body, fontSize: 9.5, color: C.inkMid }}>
            {fmtGBP(data.fin.refurbCost)}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', paddingTop: 4 }}>
          <Text style={{ flex: 1, fontFamily: FONTS.body, fontSize: 9.5, color: C.inkMid }}>
            {`Contingency (${fmtPct(contingencyPct, 0)})`}
          </Text>
          <Text style={{ width: 90, textAlign: 'right', fontFamily: FONTS.body, fontSize: 9.5, color: C.inkMid }}>
            {fmtGBP(data.fin.refurbWithContingency - data.fin.refurbCost)}
          </Text>
        </View>

        {/* Total */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: C.navy,
            borderRadius: 6,
            paddingVertical: 8,
            paddingHorizontal: 10,
            marginTop: 8,
          }}
        >
          <Text style={{ flex: 1, fontFamily: FONTS.body, fontSize: 10, fontWeight: 700, color: C.white }}>
            Total refurbishment budget
          </Text>
          <Text style={{ fontFamily: FONTS.body, fontSize: 13, fontWeight: 700, color: C.white }}>
            {fmtGBP(data.fin.refurbWithContingency)}
          </Text>
        </View>

        {weeks ? (
          <Text style={{ fontFamily: FONTS.body, fontSize: 9, color: C.inkMuted, marginTop: 8 }}>
            {`Estimated programme: ${weeks} ${weeks === '1' ? 'week' : 'weeks'} to practical completion.`}
          </Text>
        ) : null}
      </Card>
    </>
  );
}

// ── Section 11: Local growth drivers ──────────────────────────────────────────

function DriversSection({ data }: { data: ReportData }) {
  const drivers = data.deal.growth.drivers.filter((d) => (d.title || '').trim() || (d.justification || '').trim());
  const capPct = num(data.deal.growth.capitalGrowthPct);
  return (
    <>
      <SectionHeading
        index={11}
        title="Local Growth Drivers"
        subtitle="Why we expect demand and values to hold and grow in this location"
        breakPage
      />
      {drivers.length === 0 ? (
        <Card>
          <Body>
            {`No specific local drivers were itemised for this deal. The projection assumes a conservative ${fmtPct(
              capPct
            )} annual capital growth rate, in line with the wider area trend rather than any single catalyst.`}
          </Body>
        </Card>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          {drivers.map((d) => (
            <Card key={d.id} style={{ width: (CONTENT_W - 12) / 2, marginBottom: 12, padding: 0, overflow: 'hidden' }}>
              {d.imageData ? (
                <Image src={d.imageData} style={{ width: '100%', height: 84, objectFit: 'cover' }} />
              ) : null}
              <View style={{ padding: 10 }}>
                <Text style={{ fontFamily: FONTS.body, fontSize: 11, fontWeight: 700, color: C.navy }}>
                  {d.title || 'Growth driver'}
                </Text>
                {d.justification ? (
                  <Prose text={d.justification} style={{ fontSize: 9, marginTop: 4 }} />
                ) : null}
              </View>
            </Card>
          ))}
        </View>
      )}
    </>
  );
}

// ── Section 12: Equity projection + exit scenarios ────────────────────────────

function LegendSwatch({
  color,
  label,
  dashed,
  dot,
}: {
  color: string;
  label: string;
  dashed?: boolean;
  dot?: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 14, marginTop: 2 }}>
      {dot ? (
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, marginRight: 4 }} />
      ) : dashed ? (
        <View style={{ width: 12, height: 0, borderTopWidth: 1.2, borderTopColor: color, borderStyle: 'dashed', marginRight: 4 }} />
      ) : (
        <View style={{ width: 12, height: 8, borderRadius: 2, backgroundColor: color, marginRight: 4 }} />
      )}
      <Text style={{ fontFamily: FONTS.body, fontSize: 7.5, color: C.inkMuted }}>{label}</Text>
    </View>
  );
}

function ProjectionSection({ data }: { data: ReportData }) {
  const proj = data.proj;
  // Drop year 0 (starting baseline) from the chart for a cleaner timeline,
  // unless the hold is too short to have anything else.
  const all = proj.years;
  const series = all.length > 1 ? all.slice(1) : all;

  // ── chart geometry ──
  const W = CONTENT_W;
  const H = 210;
  const padL = 44;
  const padR = 14;
  const padT = 14;
  const padB = 24;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const maxVal = Math.max(1, ...all.map((y) => y.propertyValue), proj.cashDeployed);
  const maxCash = Math.max(...all.map((y) => y.cumulativeCash), proj.cashDeployed, 0);
  const yMax = Math.max(maxVal, maxCash);

  const n = series.length;
  const slot = plotW / Math.max(1, n);
  const barW = Math.min(34, slot * 0.6);

  const yOf = (v: number) => padT + plotH - (v / yMax) * plotH;
  const xCenter = (i: number) => padL + slot * i + slot / 2;

  const cashDeployedY = yOf(proj.cashDeployed);
  const baseY = yOf(0);

  // Cumulative-cash polyline across charted years.
  const cashCoords = series.map((y, i) => ({ x: xCenter(i), y: yOf(y.cumulativeCash) }));
  const cashPath = cashCoords.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

  // y-axis gridlines.
  const gridVals = [0, 0.25, 0.5, 0.75, 1].map((p) => p * yMax);

  const refinanceYears = data.deal.growth.refinanceYears
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((v) => Number.isFinite(v) && v > 0);
  const hasRefi = refinanceYears.length > 0 && data.deal.growth.mortgageType !== 'cash' && proj.refinanceTotal > 0;

  const exitRow = (
    label: string,
    e: { propertyValue: number; cashOut: number; netGain: number }
  ) => (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 6,
        borderBottomWidth: 1,
        borderBottomColor: C.border,
      }}
    >
      <Text style={{ width: 88, fontFamily: FONTS.body, fontSize: 9.5, fontWeight: 700, color: C.ink }}>{label}</Text>
      <Text style={{ flex: 1, textAlign: 'right', fontFamily: FONTS.body, fontSize: 9.5, color: C.inkMid }}>
        {fmtGBP(Math.round(e.propertyValue))}
      </Text>
      <Text style={{ flex: 1, textAlign: 'right', fontFamily: FONTS.body, fontSize: 9.5, color: C.inkMid }}>
        {fmtGBP(Math.round(e.cashOut))}
      </Text>
      <Text
        style={{
          flex: 1,
          textAlign: 'right',
          fontFamily: FONTS.body,
          fontSize: 9.5,
          fontWeight: 700,
          color: e.netGain >= 0 ? C.successDark : C.red,
        }}
      >
        {fmtGBP(Math.round(e.netGain))}
      </Text>
    </View>
  );

  return (
    <>
      <SectionHeading
        index={12}
        title="Equity Projection & Exit Scenarios"
        subtitle="Projected equity build, cumulative cash returned and modelled exits"
        breakPage
      />

      {/* Chart */}
      <Card>
        <Svg width={W} height={H}>
          {/* gridlines + y-axis labels */}
          {gridVals.map((v, i) => {
            const gy = yOf(v);
            return (
              <React.Fragment key={`g${i}`}>
                <Line x1={padL} y1={gy} x2={W - padR} y2={gy} stroke={C.border} strokeWidth={0.6} />
                <Text
                  x={padL - 5}
                  y={gy + 2.5}
                  style={{ fontFamily: FONTS.body, fontSize: 6, fill: C.inkMuted, textAnchor: 'end' }}
                >
                  {v >= 1000 ? `£${Math.round(v / 1000)}k` : `£${Math.round(v)}`}
                </Text>
              </React.Fragment>
            );
          })}

          {/* stacked bars: mortgage balance (navyDark, bottom) + equity (navy, top) */}
          {series.map((y, i) => {
            const cx = xCenter(i);
            const x = cx - barW / 2;
            const yMortTop = yOf(y.mortgageBalance);
            const yTop = yOf(y.mortgageBalance + y.equity); // top = property value
            const mortH = Math.max(0, baseY - yMortTop);
            const eqH = Math.max(0, yMortTop - yTop);
            return (
              <React.Fragment key={`bar${i}`}>
                {mortH > 0 ? <Rect x={x} y={yMortTop} width={barW} height={mortH} fill={C.navyDark} /> : null}
                {eqH > 0 ? <Rect x={x} y={yTop} width={barW} height={eqH} fill={C.navy} /> : null}
                {y.refinanceEvent ? <Circle cx={cx} cy={yTop - 5} r={3} fill={C.success} /> : null}
                <Text
                  x={cx}
                  y={H - padB + 12}
                  style={{ fontFamily: FONTS.body, fontSize: 7, fill: C.inkMuted, textAnchor: 'middle' }}
                >
                  {`Y${y.year}`}
                </Text>
              </React.Fragment>
            );
          })}

          {/* cash-deployed reference line (dashed red) */}
          <Line
            x1={padL}
            y1={cashDeployedY}
            x2={W - padR}
            y2={cashDeployedY}
            stroke={C.red}
            strokeWidth={1}
            strokeDasharray="3 2"
          />

          {/* cumulative cash line (green) */}
          {n > 1 ? <Path d={cashPath} stroke={C.success} strokeWidth={1.6} fill="none" /> : null}
          {cashCoords.map((p, i) => (
            <Circle key={`cp${i}`} cx={p.x} cy={p.y} r={1.8} fill={C.success} />
          ))}
        </Svg>

        {/* legend */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }}>
          <LegendSwatch color={C.navy} label="Equity" />
          <LegendSwatch color={C.navyDark} label="Mortgage balance" />
          <LegendSwatch color={C.success} label="Cumulative cash returned" />
          <LegendSwatch color={C.red} label="Cash deployed" dashed />
          <LegendSwatch color={C.success} label="Refinance event" dot />
        </View>
      </Card>

      {/* Exit scenarios table */}
      <Card style={{ marginTop: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: C.border, paddingBottom: 5 }}>
          <Text style={{ width: 88, fontFamily: FONTS.body, fontSize: 8, fontWeight: 700, color: C.inkMuted, letterSpacing: 0.6 }}>
            EXIT
          </Text>
          <Text style={{ flex: 1, textAlign: 'right', fontFamily: FONTS.body, fontSize: 8, fontWeight: 700, color: C.inkMuted, letterSpacing: 0.6 }}>
            VALUE
          </Text>
          <Text style={{ flex: 1, textAlign: 'right', fontFamily: FONTS.body, fontSize: 8, fontWeight: 700, color: C.inkMuted, letterSpacing: 0.6 }}>
            CASH OUT
          </Text>
          <Text style={{ flex: 1, textAlign: 'right', fontFamily: FONTS.body, fontSize: 8, fontWeight: 700, color: C.inkMuted, letterSpacing: 0.6 }}>
            NET GAIN
          </Text>
        </View>
        {exitRow('Year 5', proj.exit5)}
        {exitRow('Year 10', proj.exit10)}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 }}>
          <Stat label="Cash deployed" value={fmtGBP(Math.round(proj.cashDeployed))} valueColor={C.navy} />
          <Stat
            label="Payoff year"
            value={proj.payoffYear !== null ? `Year ${proj.payoffYear}` : 'Beyond hold'}
            valueColor={proj.payoffYear !== null ? C.successDark : C.amber}
          />
        </View>

        {hasRefi ? (
          <View
            style={{
              flexDirection: 'row',
              backgroundColor: C.successLight,
              borderLeftWidth: 3,
              borderLeftColor: C.success,
              borderRadius: 4,
              padding: 8,
              marginTop: 10,
            }}
          >
            <Text style={{ fontFamily: FONTS.body, fontSize: 9, lineHeight: 1.45, color: C.ink }}>
              {`Buy-refurbish-refinance: refinancing in ${
                refinanceYears.length > 1 ? `years ${refinanceYears.join(' and ')}` : `year ${refinanceYears[0]}`
              } releases the post-refurbishment equity, returning an estimated ${fmtGBP(
                Math.round(proj.refinanceTotal)
              )} in cash-out to recycle into the next acquisition.`}
            </Text>
          </View>
        ) : null}
      </Card>
    </>
  );
}

// ── Group export ──────────────────────────────────────────────────────────────

export function SectionsNineToTwelve({ data }: { data: ReportData }) {
  const showAuction = data.deal.auction.isAuction;
  const showRefurb = data.deal.refurb.needed && data.deal.refurb.items.length > 0;
  return (
    <>
      {showAuction ? <AuctionSection data={data} /> : null}
      {showRefurb ? <RefurbSection data={data} /> : null}
      <DriversSection data={data} />
      <ProjectionSection data={data} />
    </>
  );
}
