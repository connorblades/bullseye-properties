import 'server-only';
import React from 'react';
import { Document, Page, View, Text } from '@react-pdf/renderer';
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

        {/* Recommendation */}
        <View style={{ borderWidth: 1, borderColor: C.navy, borderRadius: 8, padding: 14, marginBottom: 16 }}>
          <Text style={{ fontFamily: FONTS.body, fontSize: 8, fontWeight: 700, color: C.navy, letterSpacing: 0.8, marginBottom: 4 }}>
            OUR RECOMMENDATION
          </Text>
          <Text style={{ fontFamily: FONTS.body, fontSize: 12, lineHeight: 1.5, color: C.ink }}>{data.recommendation}</Text>
        </View>

        {/* Headline numbers */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}>
          <NumberTile label="Guide price" value={data.price != null ? fmtGBP(data.price) : '—'} />
          <NumberTile label="Est. rent (pcm)" value={data.monthlyRent != null ? fmtGBP(data.monthlyRent) : '—'} />
          <NumberTile label="Gross yield" value={data.grossYield > 0 ? fmtPct(data.grossYield) : '—'} />
          <NumberTile label="Net yield" value={data.netYield > 0 ? fmtPct(data.netYield) : '—'} />
        </View>

        {/* Why it fits */}
        {data.fitApplicable > 0 && (
          <View style={{ marginBottom: 16 }}>
            <Text style={{ fontFamily: FONTS.body, fontSize: 11, fontWeight: 700, color: C.ink, marginBottom: 6 }}>
              {`Why this fits your criteria (${data.fitMet} of ${data.fitApplicable})`}
            </Text>
            {data.matched.map((m, i) => (
              <View key={i} style={{ flexDirection: 'row', marginBottom: 3 }}>
                <Text style={{ color: C.success, fontFamily: FONTS.body, fontSize: 10, marginRight: 6 }}>✓</Text>
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
