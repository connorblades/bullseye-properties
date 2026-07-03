import 'server-only';
import React from 'react';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { Document, Page, View, Text, Image, Svg, Rect, Defs, LinearGradient, Stop } from '@react-pdf/renderer';
import { C, FONTS } from './tokens';
import { PageHeader, DisclosureFooter } from './components';
import type { ReportData } from './report-data';
import { SectionsOneToEight } from './sections/Sections1to8';
import { SectionsNineToTwelve } from './sections/Sections9to12';
import { SectionsThirteenToSixteen } from './sections/Sections13to16';

/**
 * Standard Deal Report PDF root.
 *
 * Cover page (navy gradient, white wordmark, serif display title) + a content
 * Page that flows all 16 sections (built in T7-T9), with the fixed
 * accreditation header and AI-disclosure footer repeating on every page.
 */

const A4_W = 595.28;
const A4_H = 841.89;

function assetPath(file: string): string | null {
  const p = path.join(process.cwd(), 'public', file);
  return existsSync(p) ? p : null;
}

const pageStyle = {
  paddingTop: 64,
  paddingBottom: 58,
  paddingHorizontal: 40,
  backgroundColor: C.bg,
} as const;

function Cover({ data }: { data: ReportData }) {
  const { reference, address, preparedFor, generatedOn, partner } = data;
  const wordmark = assetPath('logo-white.png');
  return (
    <Page size="A4" wrap={false} style={{ position: 'relative' }}>
      {/* Full-bleed navy gradient background */}
      <View wrap={false} style={{ position: 'absolute', top: 0, left: 0, width: A4_W, height: A4_H }}>
        <Svg width={A4_W} height={A4_H}>
          <Defs>
            <LinearGradient id="cover" x1="0" y1="0" x2="0.6" y2="1">
              <Stop offset="0" stopColor={C.navyLight} />
              <Stop offset="0.55" stopColor={C.navyDark} />
              <Stop offset="1" stopColor={C.navyDeeper} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={A4_W} height={A4_H} fill="url(#cover)" />
        </Svg>
      </View>

      <View style={{ position: 'absolute', top: 64, left: 48, right: 48 }}>
        {wordmark ? (
          <Image src={wordmark} style={{ width: 150 }} />
        ) : (
          <Text style={{ fontFamily: FONTS.display, fontSize: 22, fontWeight: 700, color: C.white }}>
            Bullseye Properties
          </Text>
        )}
      </View>

      <View style={{ position: 'absolute', top: 300, left: 48, right: 48 }}>
        <Text style={{ fontFamily: FONTS.body, fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.75)', letterSpacing: 2 }}>
          STANDARD DEAL REPORT
        </Text>
        <Text style={{ fontFamily: FONTS.display, fontSize: 30, fontWeight: 700, color: C.white, marginTop: 12, lineHeight: 1.1 }}>
          {address}
        </Text>
        <Text style={{ fontFamily: FONTS.body, fontSize: 10, color: 'rgba(255,255,255,0.8)', marginTop: 16 }}>
          {`Reference  ${reference}`}
        </Text>
        {preparedFor ? (
          <Text style={{ fontFamily: FONTS.body, fontSize: 10, color: 'rgba(255,255,255,0.8)', marginTop: 3 }}>
            {`Prepared for  ${preparedFor}`}
          </Text>
        ) : null}
        {generatedOn ? (
          <Text style={{ fontFamily: FONTS.body, fontSize: 10, color: 'rgba(255,255,255,0.8)', marginTop: 3 }}>
            {`Date  ${generatedOn}`}
          </Text>
        ) : null}
      </View>

      <View style={{ position: 'absolute', bottom: 70, left: 48, right: 48 }}>
        <Text style={{ fontFamily: FONTS.body, fontSize: 11, fontWeight: 700, color: C.white }}>
          {partner.displayName}
        </Text>
        <Text style={{ fontFamily: FONTS.body, fontSize: 8.5, color: 'rgba(255,255,255,0.7)', marginTop: 2 }}>
          {partner.accreditationNo ? `Accredited Bullseye Partner  ·  ${partner.accreditationNo}` : 'Accredited Bullseye Partner'}
        </Text>
      </View>

      <DisclosureFooter dark />
    </Page>
  );
}

function Content({ data }: { data: ReportData }) {
  return (
    <Page size="A4" style={pageStyle}>
      <PageHeader partner={data.partner} />
      <SectionsOneToEight data={data} />
      <SectionsNineToTwelve data={data} />
      <SectionsThirteenToSixteen data={data} />
      <DisclosureFooter />
    </Page>
  );
}

export function DealReport({ data }: { data: ReportData }) {
  return (
    <Document
      title={`Standard Deal Report - ${data.reference}`}
      author={data.partner.displayName}
      creator="Bullseye Platform"
      producer="Bullseye Platform"
    >
      <Cover data={data} />
      <Content data={data} />
    </Document>
  );
}
