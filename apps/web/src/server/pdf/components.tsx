import 'server-only';
import React from 'react';
import { View, Text, Svg, Path, Circle } from '@react-pdf/renderer';
import { C, FONTS, DISCLOSURE_FOOTER } from './tokens';
import type { RiskFlag, RiskLevel } from '@/lib/risk-flags';

/** Partner identity rendered in the page header + Section 16. */
export type PartnerIdentity = {
  displayName: string;
  accreditationNo?: string;
  accreditedAt?: string;
  amlRegistration?: string;
  icoRegistration?: string;
  piPolicy?: string;
  contactEmail?: string;
  contactPhone?: string;
  shortBio?: string;
  avatarUrl?: string;
};

/** White tick in a navy disc - the accreditation mark. */
export function CheckMark({ size = 14 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="12" fill={C.navy} />
      <Path d="M6.5 12.5 L10.5 16 L17.5 8" stroke={C.white} strokeWidth={2.4} fill="none" />
    </Svg>
  );
}

/** Co-branding accreditation badge (navy chip + tick + label). */
export function AccreditationBadge() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: C.navy,
          borderRadius: 6,
          paddingVertical: 4,
          paddingHorizontal: 7,
        }}
      >
        <Svg width={12} height={12} viewBox="0 0 24 24" style={{ marginRight: 4 }}>
          <Path d="M6.5 12.5 L10.5 16 L17.5 8" stroke={C.white} strokeWidth={2.6} fill="none" />
        </Svg>
        <Text style={{ color: C.white, fontFamily: FONTS.body, fontSize: 7, fontWeight: 700, letterSpacing: 0.6 }}>
          ACCREDITED PARTNER
        </Text>
      </View>
    </View>
  );
}

/** Fixed page header on content pages: badge left, partner identity right. */
export function PageHeader({ partner }: { partner: PartnerIdentity }) {
  return (
    <View
      fixed
      style={{
        position: 'absolute',
        top: 24,
        left: 40,
        right: 40,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingBottom: 8,
        borderBottomWidth: 1,
        borderBottomColor: C.border,
      }}
    >
      <AccreditationBadge />
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ fontFamily: FONTS.body, fontSize: 9, fontWeight: 700, color: C.ink }}>
          {partner.displayName}
        </Text>
        {partner.accreditationNo ? (
          <Text style={{ fontFamily: FONTS.body, fontSize: 7, color: C.inkMuted }}>
            Accreditation {partner.accreditationNo}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** Fixed AI-disclosure footer (AC-07) + page number. `dark` for the cover. */
export function DisclosureFooter({ dark = false }: { dark?: boolean }) {
  const fg = dark ? 'rgba(255,255,255,0.7)' : C.inkMuted;
  const line = dark ? 'rgba(255,255,255,0.2)' : C.border;
  return (
    <View
      fixed
      style={{
        position: 'absolute',
        bottom: 22,
        left: 40,
        right: 40,
        borderTopWidth: 1,
        borderTopColor: line,
        paddingTop: 6,
        flexDirection: 'row',
        alignItems: 'flex-start',
      }}
    >
      <Text style={{ flex: 1, fontFamily: FONTS.body, fontSize: 6.5, lineHeight: 1.4, color: fg }}>
        {DISCLOSURE_FOOTER}
      </Text>
      <Text
        style={{ marginLeft: 12, fontFamily: FONTS.body, fontSize: 6.5, color: fg }}
        render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
      />
    </View>
  );
}

/** Section eyebrow + title block. `break` forces a new page before it. */
export function SectionHeading({
  index,
  title,
  subtitle,
  breakPage = false,
}: {
  index: number;
  title: string;
  subtitle?: string;
  breakPage?: boolean;
}) {
  return (
    <View break={breakPage} style={{ marginBottom: 10 }}>
      <Text style={{ fontFamily: FONTS.body, fontSize: 8, fontWeight: 700, color: C.navy, letterSpacing: 1 }}>
        {`SECTION ${index}`}
      </Text>
      <Text style={{ fontFamily: FONTS.body, fontSize: 17, fontWeight: 700, color: C.ink, marginTop: 2 }}>
        {title}
      </Text>
      {subtitle ? (
        <Text style={{ fontFamily: FONTS.body, fontSize: 9, color: C.inkMuted, marginTop: 2 }}>{subtitle}</Text>
      ) : null}
    </View>
  );
}

/**
 * Soft card surface. `wrap={false}` (default) keeps it whole across page breaks.
 * Pass `wrap` for variable-length prose (AI narratives), which can exceed the
 * space left on a page - an unbreakable card taller than the remaining page then
 * crashes the layout engine, so long text must be allowed to flow across pages.
 */
export function Card({ children, style, wrap = false }: { children: React.ReactNode; style?: object; wrap?: boolean }) {
  return (
    <View
      wrap={wrap}
      style={{
        backgroundColor: C.white,
        borderWidth: 1,
        borderColor: C.border,
        borderRadius: 8,
        padding: 12,
        ...style,
      }}
    >
      {children}
    </View>
  );
}

/** Body paragraph. */
export function Body({ children, style }: { children: React.ReactNode; style?: object }) {
  return (
    <Text style={{ fontFamily: FONTS.body, fontSize: 10, lineHeight: 1.5, color: C.inkMid, ...style }}>
      {children}
    </Text>
  );
}

/**
 * Multi-paragraph prose for AI narratives. This @react-pdf build crashes on a
 * literal '\n' inside a <Text> (an empty/broken run -> `unitsPerEm` of
 * undefined), so newlines must never reach a Text node. Split on blank lines
 * into paragraphs, collapse any remaining single newlines to spaces, drop empty
 * paragraphs, and render each as its own <Text> with paragraph spacing.
 */
export function Prose({ text, style }: { text: string; style?: object }) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return null;
  return (
    <>
      {paragraphs.map((p, i) => (
        <Text
          key={i}
          style={{
            fontFamily: FONTS.body,
            fontSize: 10,
            lineHeight: 1.5,
            color: C.inkMid,
            marginBottom: i < paragraphs.length - 1 ? 6 : 0,
            ...style,
          }}
        >
          {p}
        </Text>
      ))}
    </>
  );
}

// ─── Risk flags (Report v2) ─────────────────────────────────────────────────

function riskColors(level: RiskLevel): { fg: string; bg: string; border: string; label: string } {
  switch (level) {
    case 'red':
      return { fg: '#b91c1c', bg: C.redLight, border: C.red, label: 'RISK' };
    case 'amber':
      return { fg: '#b45309', bg: C.amberLight, border: C.amber, label: 'WATCH' };
    case 'good':
      return { fg: C.successDark, bg: C.successLight, border: C.success, label: 'OK' };
    default:
      return { fg: C.navy, bg: '#eaf1fb', border: C.navyLight, label: 'NOTE' };
  }
}

/** A single colour-coded risk callout (left accent bar + title + detail). */
export function RiskCallout({ flag, style }: { flag: RiskFlag; style?: object }) {
  const c = riskColors(flag.level);
  return (
    <View
      wrap={false}
      style={{
        flexDirection: 'row',
        backgroundColor: c.bg,
        borderLeftWidth: 3,
        borderLeftColor: c.border,
        borderRadius: 4,
        padding: 8,
        marginBottom: 6,
        ...style,
      }}
    >
      <View style={{ width: 42, flexShrink: 0 }}>
        <Text style={{ fontFamily: FONTS.body, fontSize: 6.5, fontWeight: 700, letterSpacing: 0.8, color: c.fg }}>{c.label}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: FONTS.body, fontSize: 9, fontWeight: 700, color: c.fg }}>{flag.title}</Text>
        <Text style={{ fontFamily: FONTS.body, fontSize: 8, lineHeight: 1.4, color: C.inkMid, marginTop: 1 }}>{flag.detail}</Text>
      </View>
    </View>
  );
}

/** "Key risks at a glance" panel - the red/amber flags, or a reassurance line. */
export function KeyRisks({ flags, style }: { flags: RiskFlag[]; style?: object }) {
  return (
    <View wrap={false} style={{ backgroundColor: C.white, borderWidth: 1, borderColor: C.border, borderRadius: 8, padding: 12, ...style }}>
      <Text style={{ fontFamily: FONTS.body, fontSize: 8, fontWeight: 700, color: C.navy, letterSpacing: 1, marginBottom: 8 }}>
        KEY RISKS AT A GLANCE
      </Text>
      {flags.length === 0 ? (
        <RiskCallout flag={{ level: 'good', title: 'No material risks flagged', detail: 'No flood, crime, EPC or ownership red flags were identified from the pulled data.' }} style={{ marginBottom: 0 }} />
      ) : (
        flags.map((f, i) => <RiskCallout key={i} flag={f} style={i === flags.length - 1 ? { marginBottom: 0 } : undefined} />)
      )}
    </View>
  );
}
