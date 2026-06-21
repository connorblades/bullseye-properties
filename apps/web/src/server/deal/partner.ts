import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { partnerProfiles } from '@/server/db/schema';
import type { PartnerIdentity } from '@/server/pdf/components';

/**
 * Load the tenant's partner profile as a PartnerIdentity for the PDF (Section 16
 * + page header). Falls back to a neutral Bullseye identity if the partner has
 * not completed their profile yet, so a report can always render.
 */
export async function loadPartnerIdentity(tenantId: string): Promise<PartnerIdentity> {
  const rows = await db.select().from(partnerProfiles).where(eq(partnerProfiles.tenantId, tenantId)).limit(1);
  const p = rows[0];
  if (!p) {
    return { displayName: 'Bullseye Properties Ltd' };
  }
  return {
    displayName: p.displayName,
    accreditationNo: p.accreditationNo ?? undefined,
    accreditedAt: p.accreditedAt ?? undefined,
    amlRegistration: p.amlRegistration ?? undefined,
    icoRegistration: p.icoRegistration ?? undefined,
    piPolicy: p.piPolicy ?? undefined,
    contactEmail: p.contactEmail ?? undefined,
    contactPhone: p.contactPhone ?? undefined,
    shortBio: p.shortBio ?? undefined,
    avatarUrl: p.avatarUrl ?? undefined,
  };
}
