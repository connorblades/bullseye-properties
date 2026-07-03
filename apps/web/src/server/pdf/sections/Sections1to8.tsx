import 'server-only';
import React from 'react';
import { View, Text, Image, Svg, Rect, Line } from '@react-pdf/renderer';
import { C, FONTS, fmtGBP, fmtPct } from '../tokens';
import { SectionHeading, Card, Body, KeyRisks, RiskCallout, Prose } from '../components';
import type { ReportData } from '../report-data';
import { parseMoney, parseSoldMonth, hpiAdjustValue } from '@/lib/deal-calcs';
import { keyRiskFlags, deriveRiskFlags } from '@/lib/risk-flags';
import { inspectionPhotos, inspectionFindings, ZONE_ORDER } from '@/lib/inspection';

/**
 * PDF Sections 1-8 (M3-T7).
 * Property summary, fit rationale, location, photos, condition, sales comps,
 * rental comps and the due-diligence pack. Reads only from `data`.
 */

const CONTENT_W = 515;

// ── small shared helpers ────────────────────────────────────────────────────

/**
 * Render a narrative (or a factual fallback if missing) via the markdown-aware,
 * newline-safe Prose component - so AI markdown (**bold**, bullet lists) renders
 * cleanly and a literal '\n' never reaches a <Text>.
 */
function NarrativeOrFallback({ text, fallback }: { text?: string; fallback: string }) {
  const t = text && text.trim() ? text : fallback;
  return <Prose text={t} style={text && text.trim() ? undefined : { color: C.inkMuted }} />;
}

/** Labelled stat tile for grids. */
type Tone = 'good' | 'watch' | 'poor' | 'neutral';

function toneStyle(tone: Tone): { value: string; bg: string; border: string } {
  switch (tone) {
    case 'good':
      return { value: C.successDark, bg: C.successLight, border: C.success };
    case 'watch':
      return { value: '#b45309', bg: C.amberLight, border: C.amber };
    case 'poor':
      return { value: '#b91c1c', bg: C.redLight, border: C.red };
    default:
      return { value: C.ink, bg: C.bg, border: C.border };
  }
}

/** Tone from a metric value against good/watch thresholds. 0/absent = neutral. */
function metricTone(value: number, good: number, watch: number): Tone {
  if (!Number.isFinite(value) || value <= 0) return 'neutral';
  if (value >= good) return 'good';
  if (value >= watch) return 'watch';
  return 'poor';
}

function Stat({
  label,
  value,
  width,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  width: string | number;
  tone?: Tone;
}) {
  const t = toneStyle(tone);
  return (
    <View
      style={{
        width,
        backgroundColor: t.bg,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: t.border,
        borderLeftWidth: tone === 'neutral' ? 1 : 3,
        padding: 8,
        marginBottom: 8,
      }}
    >
      <Text style={{ fontFamily: FONTS.body, fontSize: 7, fontWeight: 700, color: C.inkMuted, letterSpacing: 0.5 }}>
        {label.toUpperCase()}
      </Text>
      <Text style={{ fontFamily: FONTS.body, fontSize: 12, fontWeight: 700, color: t.value, marginTop: 3 }}>
        {value || '—'}
      </Text>
    </View>
  );
}

/** Colour-coded rating chip: Good=success, OK=amber, Issue=red. */
function RatingChip({ rating }: { rating: string }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    Good: { bg: C.successLight, fg: C.successDark, label: 'Good' },
    OK: { bg: C.amberLight, fg: '#92651a', label: 'OK' },
    Issue: { bg: C.redLight, fg: '#b91c1c', label: 'Issue' },
  };
  const m = map[rating] ?? { bg: C.bg, fg: C.inkMuted, label: 'Not assessed' };
  return (
    <View style={{ backgroundColor: m.bg, borderRadius: 4, paddingVertical: 3, paddingHorizontal: 8 }}>
      <Text style={{ fontFamily: FONTS.body, fontSize: 8, fontWeight: 700, color: m.fg }}>{m.label}</Text>
    </View>
  );
}

/** Generic table header row. */
function TableHead({ cols }: { cols: { label: string; flex: number; align?: 'left' | 'right' }[] }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        borderBottomWidth: 1.5,
        borderBottomColor: C.navy,
        paddingBottom: 5,
        marginBottom: 2,
      }}
    >
      {cols.map((c, i) => (
        <Text
          key={i}
          style={{
            flex: c.flex,
            fontFamily: FONTS.body,
            fontSize: 7.5,
            fontWeight: 700,
            color: C.navy,
            letterSpacing: 0.4,
            textAlign: c.align ?? 'left',
          }}
        >
          {c.label.toUpperCase()}
        </Text>
      ))}
    </View>
  );
}

/** Disclaimer line used under comps tables. */
function CompsDisclaimer({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{ fontFamily: FONTS.body, fontSize: 7.5, lineHeight: 1.4, color: C.inkMuted, marginTop: 8, fontStyle: 'italic' }}>
      {children}
    </Text>
  );
}

/** Vertical bar chart (navy bars) for a set of money values. */
function BarChart({ values, w = CONTENT_W - 24, h = 90 }: { values: number[]; w?: number; h?: number }) {
  const max = Math.max(1, ...values);
  const n = values.length;
  const gap = 8;
  const barW = Math.max(8, (w - gap * (n - 1)) / n);
  const chartH = h - 16;
  return (
    <Svg width={w} height={h}>
      {values.map((v, i) => {
        const bh = max > 0 ? (v / max) * chartH : 0;
        const x = i * (barW + gap);
        const y = chartH - bh;
        return (
          <React.Fragment key={i}>
            <Rect x={x} y={y} width={barW} height={Math.max(1, bh)} rx={2} fill={C.navy} />
            <Line x1={x} y1={chartH} x2={x + barW} y2={chartH} stroke={C.border} strokeWidth={0.5} />
          </React.Fragment>
        );
      })}
      <Line x1={0} y1={chartH} x2={w} y2={chartH} stroke={C.border} strokeWidth={1} />
    </Svg>
  );
}

// ── Section component ────────────────────────────────────────────────────────

export function SectionsOneToEight({ data }: { data: ReportData }) {
  const { deal, fin, narratives } = data;
  const pub = deal.publicData;

  // --- Section 4/5: viewing photos + guided-inspection capture (M6-T5) ---
  const inspection = deal.viewing.inspection;
  const inspectionPics = inspection ? inspectionPhotos(inspection) : [];
  const photos = Array.from(new Set([...deal.viewing.photos.filter(Boolean), ...inspectionPics]));
  const findings = inspection ? inspectionFindings(inspection) : [];

  // --- Section 1 derived values ---
  const askingPrice = parseMoney(deal.property.askingPrice);
  const purchasePrice = parseMoney(deal.financials.purchasePrice);
  const floorAreaSqft = Number(String(deal.property.floorArea ?? '').replace(/[^0-9.]/g, ''));
  const psfBasis = purchasePrice ?? askingPrice;
  const pricePerSqft = psfBasis && floorAreaSqft > 0 ? psfBasis / floorAreaSqft : null;
  const headline =
    deal.offer.strategy?.trim() ||
    `A ${deal.property.bedrooms || ''}-bed ${deal.property.type || 'property'} in ${data.address}, assessed against your stated buying criteria.`;

  return (
    <>
      {/* ===================== SECTION 1: PROPERTY SUMMARY ===================== */}
      <SectionHeading index={1} title="Property summary" subtitle={data.address} />
      <Card>
        <Text style={{ fontFamily: FONTS.body, fontSize: 11, lineHeight: 1.5, color: C.ink, fontWeight: 700, marginBottom: 10 }}>
          {headline}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <Stat label="Property type" value={deal.property.type} width="32%" />
          <Stat label="Bedrooms" value={deal.property.bedrooms} width="32%" />
          <Stat label="Bathrooms" value={deal.property.bathrooms} width="32%" />
          <Stat label="Floor area" value={deal.property.floorArea} width="32%" />
          <Stat label="Asking price" value={askingPrice !== null ? fmtGBP(askingPrice) : deal.property.askingPrice} width="32%" />
          <Stat
            label="Intended purchase"
            value={purchasePrice !== null ? fmtGBP(purchasePrice) : deal.financials.purchasePrice}
            width="32%"
          />
          <Stat label="Gross yield" value={fmtPct(fin.grossYield)} width="32%" tone={metricTone(fin.grossYield, 8, 6)} />
          <Stat label="Net yield" value={fmtPct(fin.netYield)} width="32%" tone={metricTone(fin.netYield, 6, 4)} />
          <Stat label="Annual rent" value={fmtGBP(fin.annualRent)} width="32%" />
          {pricePerSqft !== null ? (
            <Stat label="Price per sqft" value={`${fmtGBP(pricePerSqft)}/sqft`} width="32%" />
          ) : null}
        </View>
      </Card>

      {/* Key risks at a glance (Report v2) */}
      <KeyRisks flags={keyRiskFlags(deal)} style={{ marginTop: 10 }} />

      {/* ===================== SECTION 2: WHY THIS PROPERTY FITS ===================== */}
      <SectionHeading index={2} title="Why this property fits" breakPage />
      <Card wrap>
        <NarrativeOrFallback
          text={narratives['why-this-fits']}
          fallback={`This ${deal.property.type || 'property'} was selected against your criteria${
            deal.criteria.targetYield ? ` (target yield ${deal.criteria.targetYield})` : ''
          }${deal.criteria.areas ? `, focused on ${deal.criteria.areas}` : ''}. At an intended purchase of ${
            purchasePrice !== null ? fmtGBP(purchasePrice) : deal.financials.purchasePrice || 'the agreed price'
          } it returns a gross yield of ${fmtPct(fin.grossYield)} and a net yield of ${fmtPct(fin.netYield)}.`}
        />
      </Card>

      {/* ===================== SECTION 3: LOCATION ===================== */}
      <SectionHeading index={3} title="Location" breakPage />
      <Card wrap style={{ marginBottom: 10 }}>
        <NarrativeOrFallback
          text={narratives['location']}
          fallback={`${data.address} sits within ${
            pub?.demographics?.ward ? `the ${pub.demographics.ward} ward` : 'the local area'
          }${pub?.areaStats?.areaName ? ` (${pub.areaStats.areaName})` : ''}. The surrounding amenities, transport links and schools shaping rental demand are summarised below.`}
        />
      </Card>

      {/* Amenities grid */}
      {deal.location.amenities.length > 0 ? (
        <Card style={{ marginBottom: 10 }}>
          <Text style={{ fontFamily: FONTS.body, fontSize: 10, fontWeight: 700, color: C.ink, marginBottom: 8 }}>
            Nearby amenities
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
            {deal.location.amenities.slice(0, 12).map((a) => (
              <View
                key={a.id}
                style={{
                  width: '49%',
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  paddingVertical: 4,
                  borderBottomWidth: 0.5,
                  borderBottomColor: C.border,
                  marginBottom: 2,
                }}
              >
                <View style={{ flex: 1, paddingRight: 6 }}>
                  <Text style={{ fontFamily: FONTS.body, fontSize: 8.5, fontWeight: 700, color: C.ink }}>{a.name}</Text>
                  <Text style={{ fontFamily: FONTS.body, fontSize: 7, color: C.inkMuted }}>{a.category}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontFamily: FONTS.body, fontSize: 8.5, color: C.inkMid }}>{a.distanceText}</Text>
                  {a.travelMinutes ? (
                    <Text style={{ fontFamily: FONTS.body, fontSize: 7, color: C.inkMuted }}>
                      {`~${a.travelMinutes} min ${a.mode}`}
                    </Text>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      {/* Map images */}
      {deal.location.mapImage || pub?.maps?.amenities ? (
        <Card style={{ marginBottom: 10 }}>
          <Text style={{ fontFamily: FONTS.body, fontSize: 10, fontWeight: 700, color: C.ink, marginBottom: 8 }}>
            Location maps
          </Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            {deal.location.mapImage ? (
              <View style={{ width: pub?.maps?.amenities ? '49%' : '100%' }}>
                <Image src={deal.location.mapImage} style={{ width: '100%', height: 150, borderRadius: 4, objectFit: 'cover' }} />
                <Text style={{ fontFamily: FONTS.body, fontSize: 7, color: C.inkMuted, marginTop: 3 }}>Property location</Text>
              </View>
            ) : null}
            {pub?.maps?.amenities ? (
              <View style={{ width: deal.location.mapImage ? '49%' : '100%' }}>
                <Image src={pub.maps.amenities} style={{ width: '100%', height: 150, borderRadius: 4, objectFit: 'cover' }} />
                <Text style={{ fontFamily: FONTS.body, fontSize: 7, color: C.inkMuted, marginTop: 3 }}>Amenities</Text>
              </View>
            ) : null}
          </View>
        </Card>
      ) : null}

      {/* Schools */}
      {pub?.schools && pub.schools.length > 0 ? (
        <Card style={{ marginBottom: 10 }}>
          <Text style={{ fontFamily: FONTS.body, fontSize: 10, fontWeight: 700, color: C.ink, marginBottom: 8 }}>
            Nearest schools
          </Text>
          <TableHead
            cols={[
              { label: 'School', flex: 3 },
              { label: 'Type', flex: 1.5 },
              { label: 'Ofsted', flex: 1.5 },
              { label: 'Distance', flex: 1, align: 'right' },
            ]}
          />
          {pub.schools.slice(0, 6).map((s, i) => (
            <View
              key={i}
              style={{ flexDirection: 'row', paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: C.border }}
            >
              <Text style={{ flex: 3, fontFamily: FONTS.body, fontSize: 8.5, color: C.ink }}>{s.name}</Text>
              <Text style={{ flex: 1.5, fontFamily: FONTS.body, fontSize: 8.5, color: C.inkMid }}>{s.type}</Text>
              <Text style={{ flex: 1.5, fontFamily: FONTS.body, fontSize: 8.5, color: C.inkMid }}>{s.ofstedRating || '—'}</Text>
              <Text style={{ flex: 1, fontFamily: FONTS.body, fontSize: 8.5, color: C.inkMid, textAlign: 'right' }}>
                {`${s.distanceMi.toFixed(1)} mi`}
              </Text>
            </View>
          ))}
        </Card>
      ) : null}

      {/* Area / demographics summary */}
      {pub?.areaStats || pub?.airQuality || pub?.demographics ? (
        <Card>
          <Text style={{ fontFamily: FONTS.body, fontSize: 10, fontWeight: 700, color: C.ink, marginBottom: 8 }}>
            Area profile
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
            {pub?.areaStats?.population ? (
              <Stat label="Population" value={pub.areaStats.population.toLocaleString('en-GB')} width="32%" />
            ) : null}
            {pub?.areaStats?.employmentRate !== undefined ? (
              <Stat label="Employment rate" value={`${pub.areaStats.employmentRate}%`} width="32%" />
            ) : null}
            {pub?.airQuality?.band ? <Stat label="Air quality" value={pub.airQuality.band} width="32%" /> : null}
            {pub?.demographics?.imdDecile !== undefined ? (
              <Stat label="IMD decile" value={`${pub.demographics.imdDecile} / 10`} width="32%" />
            ) : null}
            {pub?.demographics?.ward ? <Stat label="Ward" value={pub.demographics.ward} width="32%" /> : null}
            {pub?.demographics?.region ? <Stat label="Region" value={pub.demographics.region} width="32%" /> : null}
          </View>
        </Card>
      ) : null}

      {/* ===================== SECTION 4: PHOTOS AND WALKTHROUGH ===================== */}
      <SectionHeading index={4} title="Photos and walkthrough" breakPage />
      {photos.length > 0 ? (
        <Card style={{ marginBottom: 10 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start' }}>
            {photos.map((src, i) =>
              src ? (
                <Image
                  key={i}
                  src={src}
                  style={{ width: 160, height: 120, borderRadius: 4, objectFit: 'cover', marginRight: 9, marginBottom: 9 }}
                />
              ) : null
            )}
          </View>
        </Card>
      ) : (
        <Card style={{ marginBottom: 10 }}>
          <Body style={{ color: C.inkMuted }}>No viewing photographs were supplied for this property.</Body>
        </Card>
      )}

      {/* Documents list */}
      {deal.property.documents.length > 0 ? (
        <Card>
          <Text style={{ fontFamily: FONTS.body, fontSize: 10, fontWeight: 700, color: C.ink, marginBottom: 8 }}>
            Documents on file
          </Text>
          {deal.property.documents.map((d) => (
            <View
              key={d.id}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                paddingVertical: 4,
                borderBottomWidth: 0.5,
                borderBottomColor: C.border,
              }}
            >
              <Text style={{ fontFamily: FONTS.body, fontSize: 8.5, color: C.ink }}>{d.filename}</Text>
              <Text style={{ fontFamily: FONTS.body, fontSize: 7.5, color: C.inkMuted }}>{d.kind.replace(/-/g, ' ')}</Text>
            </View>
          ))}
        </Card>
      ) : null}

      {/* ===================== SECTION 5: CONDITION ASSESSMENT ===================== */}
      <SectionHeading index={5} title="Condition assessment" breakPage />
      {narratives['condition'] && narratives['condition'].trim() ? (
        <Card wrap style={{ marginBottom: 10 }}>
          <Prose text={narratives['condition']} />
        </Card>
      ) : null}
      <Card style={{ marginBottom: 10 }}>
        {(
          [
            ['Roof', deal.viewing.roof],
            ['Damp', deal.viewing.damp],
            ['Windows', deal.viewing.windows],
            ['Heating', deal.viewing.heating],
            ['Electrics', deal.viewing.electrics],
            ['Structure', deal.viewing.structure],
          ] as [string, string][]
        ).map(([label, rating], i) => (
          <View
            key={label}
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingVertical: 6,
              borderBottomWidth: i === 5 ? 0 : 0.5,
              borderBottomColor: C.border,
            }}
          >
            <Text style={{ fontFamily: FONTS.body, fontSize: 9.5, color: C.ink, fontWeight: 700 }}>{label}</Text>
            <RatingChip rating={rating} />
          </View>
        ))}
        {deal.viewing.notes ? (
          <View style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: C.border }}>
            <Text style={{ fontFamily: FONTS.body, fontSize: 7.5, fontWeight: 700, color: C.inkMuted, marginBottom: 3 }}>
              VIEWING NOTES
            </Text>
            <Prose text={deal.viewing.notes} style={{ fontSize: 9 }} />
          </View>
        ) : null}
        {deal.viewing.assessment ? (
          <View style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: C.border }}>
            <Text style={{ fontFamily: FONTS.body, fontSize: 7.5, fontWeight: 700, color: C.inkMuted, marginBottom: 3 }}>
              POST-VIEWING ASSESSMENT
            </Text>
            <Prose text={deal.viewing.assessment} style={{ fontSize: 9 }} />
          </View>
        ) : null}
        {deal.viewing.summary ? (
          <View style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: C.border }}>
            <Text style={{ fontFamily: FONTS.body, fontSize: 7.5, fontWeight: 700, color: C.inkMuted, marginBottom: 3 }}>
              FURTHER COMMENTS
            </Text>
            <Prose text={deal.viewing.summary} style={{ fontSize: 9 }} />
          </View>
        ) : null}
      </Card>

      {/* Guided inspection - rated walkthrough (M6-T5) */}
      {findings.length > 0 ? (
        <Card style={{ marginBottom: 10 }}>
          <Text style={{ fontFamily: FONTS.body, fontSize: 10, fontWeight: 700, color: C.ink, marginBottom: 6 }}>
            Guided inspection
          </Text>
          {ZONE_ORDER.map((z) => {
            const zoneFindings = findings.filter((f) => f.zone === z.zone);
            if (zoneFindings.length === 0) return null;
            return (
              <View key={z.zone} style={{ marginBottom: 6 }}>
                <Text style={{ fontFamily: FONTS.body, fontSize: 7.5, fontWeight: 700, color: C.inkMuted, letterSpacing: 0.6, marginBottom: 2 }}>
                  {z.title.toUpperCase()}
                </Text>
                {zoneFindings.map((f) => (
                  <View
                    key={f.key}
                    style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: C.border }}
                  >
                    <Text style={{ flex: 1, fontFamily: FONTS.body, fontSize: 9, color: C.ink }}>
                      {f.label}
                      {f.walkAway ? '  (flag)' : ''}
                    </Text>
                    {f.reading ? (
                      <Text style={{ fontFamily: FONTS.body, fontSize: 8, color: C.inkMuted, marginRight: 8 }}>{f.reading}</Text>
                    ) : null}
                    {f.rating !== undefined ? (
                      <Text style={{ width: 44, textAlign: 'right', fontFamily: FONTS.body, fontSize: 9, fontWeight: 700, color: f.rating >= 7 ? C.success : f.rating >= 4 ? C.ink : C.red }}>
                        {f.rating}/10
                      </Text>
                    ) : (
                      <Text style={{ width: 44, textAlign: 'right', fontFamily: FONTS.body, fontSize: 8, color: C.inkMuted }}>
                        {f.flagged ? 'noted' : ''}
                      </Text>
                    )}
                  </View>
                ))}
              </View>
            );
          })}
          <Text style={{ fontFamily: FONTS.body, fontSize: 7.5, color: C.inkMuted, marginTop: 4 }}>
            Condition scored 1 (poor) to 10 (excellent) at the on-site inspection.
          </Text>
        </Card>
      ) : null}

      {/* EPC block */}
      {pub?.epc ? (
        <Card>
          <Text style={{ fontFamily: FONTS.body, fontSize: 10, fontWeight: 700, color: C.ink, marginBottom: 8 }}>
            Energy performance (EPC)
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
            <Stat label="Current rating" value={`${pub.epc.currentRating} (${pub.epc.currentScore})`} width="32%" />
            <Stat label="Potential rating" value={`${pub.epc.potentialRating} (${pub.epc.potentialScore})`} width="32%" />
            <Stat
              label="Floor area"
              value={pub.epc.floorAreaM2 ? `${pub.epc.floorAreaM2} m²` : '—'}
              width="32%"
            />
            <Stat label="Main heating" value={pub.epc.mainHeating || '—'} width="49%" />
            <Stat label="Property type" value={pub.epc.propertyType || '—'} width="49%" />
          </View>
          {pub.epc.potentialScore > pub.epc.currentScore ? (
            <View style={{ marginTop: 2, backgroundColor: C.successLight, borderRadius: 4, padding: 7 }}>
              <Text style={{ fontFamily: FONTS.body, fontSize: 8.5, color: C.successDark, fontWeight: 700 }}>
                {`Uplift potential: ${pub.epc.currentRating} (${pub.epc.currentScore}) to ${pub.epc.potentialRating} (${pub.epc.potentialScore}), +${pub.epc.potentialScore - pub.epc.currentScore} points`}
              </Text>
              <Text style={{ fontFamily: FONTS.body, fontSize: 8, color: C.inkMid, marginTop: 1 }}>
                Reaching the EPC C standard is a common lettings and grant threshold. Budget the recommended works into the refurbishment.
              </Text>
            </View>
          ) : null}
        </Card>
      ) : null}

      {/* ===================== SECTION 6: SALES COMPARABLES ===================== */}
      <SectionHeading index={6} title="Sales comparables" breakPage />
      {deal.salesComps.length > 0 ? (
        <>
          <Card style={{ marginBottom: 10 }}>
            <TableHead
              cols={[
                { label: 'Address', flex: 3 },
                { label: 'Detail', flex: 3 },
                { label: 'Value', flex: 1.4, align: 'right' },
                ...(pub?.hpi ? [{ label: 'HPI adj.', flex: 1.4, align: 'right' as const }] : []),
              ]}
            />
            {deal.salesComps.map((c) => {
              const v = parseMoney(c.value);
              let adj: string = '—';
              if (pub?.hpi && v !== null) {
                const month = parseSoldMonth(c.detail);
                if (month) {
                  const r = hpiAdjustValue(v, month, pub.hpi);
                  if (r) adj = fmtGBP(r.adjusted);
                }
              }
              return (
                <View
                  key={c.id}
                  style={{ flexDirection: 'row', paddingVertical: 5, borderBottomWidth: 0.5, borderBottomColor: C.border }}
                >
                  <Text style={{ flex: 3, fontFamily: FONTS.body, fontSize: 8.5, color: C.ink, paddingRight: 4 }}>
                    {c.address}
                  </Text>
                  <Text style={{ flex: 3, fontFamily: FONTS.body, fontSize: 8, color: C.inkMid, paddingRight: 4 }}>
                    {c.detail}
                  </Text>
                  <Text style={{ flex: 1.4, fontFamily: FONTS.body, fontSize: 8.5, fontWeight: 700, color: C.ink, textAlign: 'right' }}>
                    {v !== null ? fmtGBP(v) : c.value}
                  </Text>
                  {pub?.hpi ? (
                    <Text style={{ flex: 1.4, fontFamily: FONTS.body, fontSize: 8.5, color: C.navy, textAlign: 'right' }}>
                      {adj}
                    </Text>
                  ) : null}
                </View>
              );
            })}
            <CompsDisclaimer>
              Comparable evidence supports a market-value estimate; it is not a formal RICS valuation.
              {pub?.hpi
                ? ` HPI-adjusted figures restate each sold price to ${pub.hpi.latestMonth} using the ${pub.hpi.district} Land Registry index.`
                : ''}
            </CompsDisclaimer>
          </Card>

          {/* Weighting bar chart */}
          {(() => {
            const valued = deal.salesComps
              .map((c) => ({ v: parseMoney(c.value), label: c.address }))
              .filter((x): x is { v: number; label: string } => x.v !== null);
            if (valued.length === 0) return null;
            return (
              <Card>
                <Text style={{ fontFamily: FONTS.body, fontSize: 10, fontWeight: 700, color: C.ink, marginBottom: 8 }}>
                  Comparable weighting
                </Text>
                <BarChart values={valued.map((x) => x.v)} />
                <Text style={{ fontFamily: FONTS.body, fontSize: 7, color: C.inkMuted, marginTop: 4 }}>
                  {`Range ${fmtGBP(Math.min(...valued.map((x) => x.v)))} – ${fmtGBP(Math.max(...valued.map((x) => x.v)))} across ${valued.length} comparables.`}
                </Text>
              </Card>
            );
          })()}
        </>
      ) : (
        <Card>
          <Body style={{ color: C.inkMuted }}>No sales comparables were recorded for this property.</Body>
        </Card>
      )}

      {/* ===================== SECTION 7: RENTAL COMPARABLES ===================== */}
      <SectionHeading index={7} title="Rental comparables" breakPage />
      {deal.rentalComps.length > 0 ? (
        <Card>
          {deal.financials.monthlyRent ? (
            <View style={{ marginBottom: 10, backgroundColor: C.bg, borderRadius: 6, padding: 8 }}>
              <Text style={{ fontFamily: FONTS.body, fontSize: 7.5, fontWeight: 700, color: C.inkMuted, letterSpacing: 0.5 }}>
                EXPECTED MONTHLY RENT
              </Text>
              <Text style={{ fontFamily: FONTS.body, fontSize: 14, fontWeight: 700, color: C.navy, marginTop: 2 }}>
                {(() => {
                  const r = parseMoney(deal.financials.monthlyRent);
                  return r !== null ? `${fmtGBP(r)} pcm` : deal.financials.monthlyRent;
                })()}
              </Text>
              <Text style={{ fontFamily: FONTS.body, fontSize: 7.5, color: C.inkMuted, marginTop: 2 }}>
                Supported by the comparables below.
              </Text>
            </View>
          ) : null}
          <TableHead
            cols={[
              { label: 'Address', flex: 3 },
              { label: 'Detail', flex: 3 },
              { label: 'Rent', flex: 1.4, align: 'right' },
            ]}
          />
          {deal.rentalComps.map((c) => {
            const v = parseMoney(c.value);
            return (
              <View
                key={c.id}
                style={{ flexDirection: 'row', paddingVertical: 5, borderBottomWidth: 0.5, borderBottomColor: C.border }}
              >
                <Text style={{ flex: 3, fontFamily: FONTS.body, fontSize: 8.5, color: C.ink, paddingRight: 4 }}>
                  {c.address}
                </Text>
                <Text style={{ flex: 3, fontFamily: FONTS.body, fontSize: 8, color: C.inkMid, paddingRight: 4 }}>
                  {c.detail}
                </Text>
                <Text style={{ flex: 1.4, fontFamily: FONTS.body, fontSize: 8.5, fontWeight: 700, color: C.ink, textAlign: 'right' }}>
                  {v !== null ? fmtGBP(v) : c.value}
                </Text>
              </View>
            );
          })}
          <CompsDisclaimer>
            Rental comparables are an evidence-based estimate of achievable rent, not a guarantee of letting income.
          </CompsDisclaimer>
        </Card>
      ) : (
        <Card>
          <Body style={{ color: C.inkMuted }}>No rental comparables were recorded for this property.</Body>
        </Card>
      )}

      {/* ===================== SECTION 8: DUE DILIGENCE PACK ===================== */}
      <SectionHeading index={8} title="Due diligence pack" breakPage />

      {/* Crime profile */}
      {deal.location.crime ? (
        <Card style={{ marginBottom: 10 }}>
          <Text style={{ fontFamily: FONTS.body, fontSize: 10, fontWeight: 700, color: C.ink, marginBottom: 6 }}>
            Crime profile
          </Text>
          <Text style={{ fontFamily: FONTS.body, fontSize: 8.5, color: C.inkMid, marginBottom: 8 }}>
            {`${deal.location.crime.total12mo.toLocaleString('en-GB')} recorded offences over 12 months — `}
            <Text
              style={{
                color:
                  deal.location.crime.comparison === 'lower'
                    ? C.successDark
                    : deal.location.crime.comparison === 'higher'
                    ? '#b91c1c'
                    : C.inkMid,
                fontWeight: 700,
              }}
            >
              {`${deal.location.crime.comparison} than the district average`}
            </Text>
            {deal.location.crime.comparisonPct ? ` (${deal.location.crime.comparisonPct}).` : '.'}
          </Text>
          {deal.location.crime.breakdown.length > 0
            ? (() => {
                const rows = [...deal.location.crime.breakdown].sort((a, b) => b.count - a.count).slice(0, 8);
                const max = Math.max(1, ...rows.map((r) => r.count));
                const barAreaW = CONTENT_W - 24 - 160 - 40;
                return rows.map((r, i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 2.5 }}>
                    <Text style={{ width: 160, fontFamily: FONTS.body, fontSize: 8, color: C.inkMid }} wrap={false}>
                      {r.category}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Svg width={barAreaW} height={9}>
                        <Rect x={0} y={0} width={barAreaW} height={9} rx={2} fill={C.bg} />
                        <Rect x={0} y={0} width={Math.max(2, (r.count / max) * barAreaW)} height={9} rx={2} fill={C.navy} />
                      </Svg>
                    </View>
                    <Text style={{ width: 40, fontFamily: FONTS.body, fontSize: 8, color: C.ink, textAlign: 'right', fontWeight: 700 }}>
                      {r.count}
                    </Text>
                  </View>
                ));
              })()
            : null}
        </Card>
      ) : null}

      {/* Flood + planning + council tax */}
      {pub?.flood || pub?.planning || pub?.planningApplications || pub?.councilTax || deal.councilTaxBand ? (
        <Card style={{ marginBottom: 10 }}>
          <Text style={{ fontFamily: FONTS.body, fontSize: 10, fontWeight: 700, color: C.ink, marginBottom: 8 }}>
            Flood, planning and council tax
          </Text>

          {pub?.flood ? (
            <View style={{ marginBottom: 8 }}>
              {deriveRiskFlags(deal)
                .filter((f) => f.title.startsWith('Flood') && (f.level === 'red' || f.level === 'amber'))
                .map((f, i) => (
                  <RiskCallout key={i} flag={f} />
                ))}
              <Text style={{ fontFamily: FONTS.body, fontSize: 8, fontWeight: 700, color: C.inkMuted, marginBottom: 2 }}>
                FLOOD RISK
              </Text>
              <Text style={{ fontFamily: FONTS.body, fontSize: 9, color: C.ink }}>{pub.flood.riskLabel}</Text>
              {pub.flood.riversAndSea ? (
                <Text style={{ fontFamily: FONTS.body, fontSize: 8, color: C.inkMid, marginTop: 1 }}>
                  {`Rivers and sea: ${pub.flood.riversAndSea}`}
                </Text>
              ) : null}
            </View>
          ) : null}

          {pub?.planning ? (
            <View style={{ marginBottom: 8 }}>
              <Text style={{ fontFamily: FONTS.body, fontSize: 8, fontWeight: 700, color: C.inkMuted, marginBottom: 2 }}>
                PLANNING DESIGNATIONS
              </Text>
              <Text style={{ fontFamily: FONTS.body, fontSize: 9, color: C.ink }}>
                {`Conservation area: ${pub.planning.conservationArea ? 'Yes' : 'No'}    Listed building: ${
                  pub.planning.listed ? 'Yes' : 'No'
                }`}
              </Text>
            </View>
          ) : null}

          {pub?.planningApplications && pub.planningApplications.length > 0
            ? (() => {
                const apps = pub.planningApplications!;
                const residential = apps.filter((a) => a.residential);
                return (
                  <View style={{ marginBottom: 8 }}>
                    <Text style={{ fontFamily: FONTS.body, fontSize: 8, fontWeight: 700, color: C.inkMuted, marginBottom: 2 }}>
                      NEARBY PLANNING APPLICATIONS
                    </Text>
                    <Text style={{ fontFamily: FONTS.body, fontSize: 9, color: C.ink }}>
                      {`${apps.length} application${apps.length === 1 ? '' : 's'} found nearby${
                        residential.length > 0 ? `, including ${residential.length} residential / new-homes` : ''
                      }.`}
                    </Text>
                  </View>
                );
              })()
            : null}

          {pub?.councilTax?.band || deal.councilTaxBand ? (
            <View>
              <Text style={{ fontFamily: FONTS.body, fontSize: 8, fontWeight: 700, color: C.inkMuted, marginBottom: 2 }}>
                COUNCIL TAX BAND
              </Text>
              <Text style={{ fontFamily: FONTS.body, fontSize: 9, color: C.ink }}>
                {`Band ${pub?.councilTax?.band || deal.councilTaxBand}`}
              </Text>
            </View>
          ) : null}
        </Card>
      ) : null}

      {/* Demographic context */}
      {pub?.demographics ? (
        <Card>
          <Text style={{ fontFamily: FONTS.body, fontSize: 10, fontWeight: 700, color: C.ink, marginBottom: 8 }}>
            Demographic context
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
            {pub.demographics.imdDecile !== undefined ? (
              <Stat label="IMD decile" value={`${pub.demographics.imdDecile} / 10`} width="32%" />
            ) : null}
            {pub.demographics.ward ? <Stat label="Ward" value={pub.demographics.ward} width="32%" /> : null}
            {pub.demographics.constituency ? (
              <Stat label="Constituency" value={pub.demographics.constituency} width="32%" />
            ) : null}
            {pub.demographics.adminCounty ? <Stat label="County" value={pub.demographics.adminCounty} width="32%" /> : null}
            {pub.demographics.region ? <Stat label="Region" value={pub.demographics.region} width="32%" /> : null}
            {pub.demographics.lsoa ? <Stat label="LSOA" value={pub.demographics.lsoa} width="32%" /> : null}
          </View>
        </Card>
      ) : null}

      {/* Title & connectivity (Report v2: more characteristics) */}
      {(pub?.landOwnership?.titles?.length ?? 0) > 0 || pub?.broadband ? (
        <Card>
          <Text style={{ fontFamily: FONTS.body, fontSize: 10, fontWeight: 700, color: C.ink, marginBottom: 8 }}>
            Title and connectivity
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
            {pub?.landOwnership?.titles?.[0]?.proprietors?.[0]?.name ? (
              <Stat
                label={pub.landOwnership.titles.some((t) => t.dataset === 'ocod') ? 'Registered proprietor (overseas)' : 'Registered proprietor'}
                value={pub.landOwnership.titles[0].proprietors[0].name}
                width="49%"
              />
            ) : null}
            {pub?.landOwnership?.titles?.[0]?.tenure ? (
              <Stat label="Tenure" value={pub.landOwnership.titles[0].tenure!} width="49%" />
            ) : null}
            {pub?.broadband?.maxDownloadMbps ? (
              <Stat label="Max broadband" value={`${pub.broadband.maxDownloadMbps} Mbps`} width="32%" />
            ) : null}
            {pub?.broadband?.fullFibrePct != null ? (
              <Stat label="Full-fibre availability" value={`${pub.broadband.fullFibrePct}%`} width="32%" tone={Number(pub.broadband.fullFibrePct) >= 50 ? 'good' : 'neutral'} />
            ) : null}
            {pub?.broadband?.superfastPct != null ? (
              <Stat label="Superfast availability" value={`${pub.broadband.superfastPct}%`} width="32%" />
            ) : null}
          </View>
        </Card>
      ) : null}
    </>
  );
}
