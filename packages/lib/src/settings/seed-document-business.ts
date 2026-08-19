// packages/lib/src/settings/seed-document-business.ts

import { type Database, schema, type Transaction } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { getOrganizationSetting, updateOrganizationSetting } from './settings-service'

/** The two `documents.business` fields the organization profile can supply. */
type ProfileBackedFields = { companyName?: string; website?: string }

/**
 * Fill the blank `companyName`/`website` of the `documents.business` identity block (printed on
 * every quote and invoice) from the organization profile, so an org's first PDF isn't headed by
 * a blank company name.
 *
 * Only those two fields exist on `Organization`; address, phone, email and tax id are collected
 * nowhere earlier and are deliberately left empty — `hasBusinessAddress` (the `set-address`
 * checklist signal) keys off `address.street1`/`city`, so seeding the name can never mark that
 * goal falsely complete.
 *
 * **Fill-blanks-only, never overwrite.** Called from two moments, and the second one routinely
 * runs against a block the first already wrote:
 * - `OrganizationSeeder.seedNewOrganization` — covers explicitly created orgs, and no-ops on the
 *   email/password signup path, where the org is created with `name: ''`
 * - `organization.update` — the moment onboarding's last step supplies the real name/website
 *
 * No-ops (and skips the cache event) when the profile has nothing the block is missing.
 */
export async function seedDocumentBusinessFromProfile(params: {
  organizationId: string
  db?: Database | Transaction
}): Promise<void> {
  const { organizationId, db } = params

  const [org] = await (db ?? (await import('@auxx/database')).database)
    .select({ name: schema.Organization.name, website: schema.Organization.website })
    .from(schema.Organization)
    .where(eq(schema.Organization.id, organizationId))
    .limit(1)

  const profile: ProfileBackedFields = {}
  if (org?.name?.trim()) profile.companyName = org.name.trim()
  if (org?.website?.trim()) profile.website = org.website.trim()
  if (!profile.companyName && !profile.website) return

  const existing = ((await getOrganizationSetting({
    organizationId,
    key: 'documents.business',
    db,
  })) ?? {}) as Record<string, unknown> & ProfileBackedFields

  const patch: ProfileBackedFields = {}
  if (profile.companyName && !existing.companyName?.trim()) patch.companyName = profile.companyName
  if (profile.website && !existing.website?.trim()) patch.website = profile.website
  if (!patch.companyName && !patch.website) return

  await updateOrganizationSetting({
    organizationId,
    key: 'documents.business',
    value: { ...existing, ...patch },
    db,
  })

  // `updateOrganizationSetting` does not invalidate on its own — every caller owns this
  // (see setting.ts's mutations). Without it the freshly seeded block sits behind a stale
  // `orgSettings` cache entry and the Documents/Dispatch settings pages read blank.
  const { onCacheEvent } = await import('../cache/invalidate')
  await onCacheEvent('org.settings.changed', { orgId: organizationId })
}
