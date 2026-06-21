import 'server-only';
import React from 'react';
import { View, Text, Svg, Path, Circle } from '@react-pdf/renderer';
import { C, FONTS, DISCLOSURE_FOOTER } from './tokens';

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

/** Soft card surface. `wrap={false}` keeps it whole across page breaks. */
export function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  return (
    <View
      wrap={false}
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
