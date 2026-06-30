import 'server-only';
import React from 'react';
import { Document, Page, View, Text, Image, Svg, Path } from '@react-pdf/renderer';
import { C, FONTS, fmtGBP, fmtPct } from './tokens';
import { DisclosureFooter, type PartnerIdentity } from './components';
import type { OutlineData } from '@/lib/outline';

/**
 * Outline Deal pack (M5) - 1-page pre-viewing teaser to gauge prospect interest
 * before any viewing/DD. Light by design: headline numbers, why it fits, a few
 * location highlights, and the recommendation/CTA.
 */
export type OutlinePackProps = {
  data: OutlineData;
  partner: PartnerIdentity;
  preparedFor?: string;
  generatedOn?: string;
};

/** Drawn tick - Noto Sans has no U+2713, which crashes @react-pdf's layout. */
function Tick() {
  return (
    <Svg width={9} height={9} viewBox="0 0 24 24" style={{ marginRight: 6, marginTop: 2 }}>
      <Path d="M4 12.5 L10 18.5 L20 6" stroke={C.success} strokeWidth={3.5} fill="none" />
    </Svg>
  );
}

function NumberTile({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ width: '23%', backgroundColor: C.bg, borderRadius: 8, padding: 10 }}>
      <Text style={{ fontFamily: FONTS.body, fontSize: 7, fontWeight: 700, color: C.inkMuted, letterSpacing: 0.5 }}>
        {label.toUpperCase()}
      </Text>
      <Text style={{ fontFamily: FONTS.body, fontSize: 14, fontWeight: 700, color: C.ink, marginTop: 3 }}>{value}</Text>
    </View>
  );
}

export function OutlinePack({ data, partner, preparedFor, generatedOn }: OutlinePackProps) {
  return (
    <Document title={`Outline Deal - ${data.address}`} author={partner.displayName} creator="Bullseye Platform">
      <Page size="A4" style={{ paddingTop: 40, paddingBottom: 56, paddingHorizontal: 40, backgroundColor: C.white }}>
        {/* Header band */}
        <View style={{ backgroundColor: C.navy, borderRadius: 10, padding: 18, marginBottom: 16 }}>
          <Text style={{ fontFamily: FONTS.body, fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.75)', letterSpacing: 2 }}>
            OUTLINE DEAL
          </Text>
          <Text style={{ fontFamily: FONTS.display, fontSize: 20, fontWeight: 700, color: C.white, marginTop: 6, lineHeight: 1.15 }}>
            {data.address}
          </Text>
          <Text style={{ fontFamily: FONTS.body, fontSize: 9, color: 'rgba(255,255,255,0.8)', marginTop: 8 }}>
            {preparedFor ? `Prepared for ${preparedFor}` : 'Prepared for you'}
            {generatedOn ? `  ·  ${generatedOn}` : ''}
            {`  ·  ${partner.displayName}`}
          </Text>
        </View>

        {/* Pre-viewing visuals (area map / context shots) */}
        {data.images.length > 0 && (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}>
            {data.images.map((img, i) => (
              <View key={i} style={{ width: data.images.length > 1 ? '49%' : '100%' }}>
                <Image src={img.src} style={{ width: '100%', height: 150, borderRadius: 6, objectFit: 'cover' }} />
                {img.caption ? (
                  <Text style={{ fontFamily: FONTS.body, fontSize: 7, color: C.inkMuted, marginTop: 3 }}>{img.caption}</Text>
                ) : null}
              </View>
            ))}
          </View>
        )}

        {/* Recommendation */}
        <View style={{ borderWidth: 1, borderColor: C.navy, borderRadius: 8, padding: 14, marginBottom: 16 }}>
          <Text style={{ fontFamily: FONTS.body, fontSize: 8, fontWeight: 700, color: C.navy, letterSpacing: 0.8, marginBottom: 4 }}>
            OUR RECOMMENDATION
          </Text>
          <Text style={{ fontFamily: FONTS.body, fontSize: 12, lineHeight: 1.5, color: C.ink }}>{data.recommendation}</Text>
        </View>

        {/* Headline numbers */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}>
          <NumberTile label="Guide price" value={data.price != null ? fmtGBP(data.price) : 'TBC'} />
          <NumberTile label="Est. rent (pcm)" value={data.monthlyRent != null ? fmtGBP(data.monthlyRent) : 'TBC'} />
          <NumberTile label="Gross yield" value={data.grossYield > 0 ? fmtPct(data.grossYield) : 'TBC'} />
          <NumberTile label="Net yield" value={data.netYield > 0 ? fmtPct(data.netYield) : 'TBC'} />
        </View>

        {/* Indicative opening offer (pre-condition) */}
        {data.indicative.suggestedOffer != null && (
          <View style={{ backgroundColor: C.navy, borderRadius: 8, padding: 14, marginBottom: 16 }}>
            <Text style={{ fontFamily: FONTS.body, fontSize: 8, fontWeight: 700, color: 'rgba(255,255,255,0.7)', letterSpacing: 0.8 }}>
              INDICATIVE OPENING OFFER
            </Text>
            <Text style={{ fontFamily: FONTS.display, fontSize: 22, fontWeight: 700, color: C.white, marginTop: 2 }}>
              {fmtGBP(data.indicative.suggestedOffer)}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }}>
              {data.indicative.marketValue != null && (
                <Text style={{ fontFamily: FONTS.body, fontSize: 8, color: 'rgba(255,255,255,0.85)', marginRight: 18 }}>
                  {`Estimated value: ${fmtGBP(data.indicative.marketValue)} (${data.indicative.marketValueBasis.toLowerCase()})`}
                </Text>
              )}
              {data.indicative.yieldMaxPrice != null && data.indicative.targetYieldPct != null && (
                <Text style={{ fontFamily: FONTS.body, fontSize: 8, color: 'rgba(255,255,255,0.85)' }}>
                  {`Max for ${data.indicative.targetYieldPct}% target yield: ${fmtGBP(data.indicative.yieldMaxPrice)}`}
                </Text>
              )}
            </View>
            <Text style={{ fontFamily: FONTS.body, fontSize: 7.5, color: 'rgba(255,255,255,0.7)', marginTop: 6, lineHeight: 1.4 }}>
              A desktop estimate from comparables and your yield target. A starting point only, subject to the viewing and
              refurbishment assessment, which may move it down.
            </Text>
          </View>
        )}

        {/* Why it fits */}
        {data.fitApplicable > 0 && (
          <View style={{ marginBottom: 16 }}>
            <Text style={{ fontFamily: FONTS.body, fontSize: 11, fontWeight: 700, color: C.ink, marginBottom: 6 }}>
              {`Why this fits your criteria (${data.fitMet} of ${data.fitApplicable})`}
            </Text>
            {data.matched.map((m, i) => (
              <View key={i} style={{ flexDirection: 'row', marginBottom: 3 }}>
                <Tick />
                <Text style={{ fontFamily: FONTS.body, fontSize: 10, color: C.inkMid }}>{m}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Location highlights */}
        {data.highlights.length > 0 && (
          <View style={{ marginBottom: 16 }}>
            <Text style={{ fontFamily: FONTS.body, fontSize: 11, fontWeight: 700, color: C.ink, marginBottom: 6 }}>
              Location highlights
            </Text>
            {data.highlights.map((h, i) => (
              <View key={i} style={{ flexDirection: 'row', marginBottom: 3 }}>
                <Text style={{ color: C.navy, fontFamily: FONTS.body, fontSize: 10, marginRight: 6 }}>•</Text>
                <Text style={{ fontFamily: FONTS.body, fontSize: 10, color: C.inkMid }}>{h}</Text>
              </View>
            ))}
          </View>
        )}

        {data.projected5yr != null && data.projected5yr > 0 && (
          <Text style={{ fontFamily: FONTS.body, fontSize: 9, color: C.inkMuted }}>
            {`Illustrative projected value in 5 years: ${fmtGBP(data.projected5yr)} (on the assumptions in the full report).`}
          </Text>
        )}

        <Text style={{ fontFamily: FONTS.body, fontSize: 8, color: C.inkMuted, marginTop: 14, lineHeight: 1.4 }}>
          This is an outline summary to gauge interest. It is not advice or a valuation. Full comparable evidence, condition
          assessment and financial detail follow in the complete report after a viewing.
        </Text>

        <DisclosureFooter />
      </Page>
    </Document>
  );
}
