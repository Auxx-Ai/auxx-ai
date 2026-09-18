// packages/lib/src/postings/provider-sync/scheduler-io.ts
//
// The three database reads `scheduler.ts` makes, isolated so the registration
// logic above them is testable without one - the same split `run-state-io.ts`
// makes for the run blob.

import { type Database, database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { isDemoOrganization } from '../../demo'
import { readOrganizationSettings } from '../../settings/read'
import { listAccountingProviderIds, NONE_PROVIDER_ID, resolveAccountingProvider } from '../provider'
import { PROVIDER_SYNC_SCHEDULE_SETTING_KEY, type ProviderSyncScheduleConfig } from './client'

const logger = createScopedLogger('postings:provider-sync:scheduler-io')

/**
 * The org's cadence, read from the ROW.
 *
 * 🛑 Passes `database` to `readOrganizationSettings` rather than omitting it,
 * for `run-state-io.ts`'s reason: the cached path resolves from the
 * `orgSettings` org cache, which `updateOrganizationSetting` does not
 * invalidate - so the settings mutation that has just written a cadence and
 * then reconciles the scheduler would register the one it replaced.
 */
export async function readProviderSyncSchedule(
  organizationId: string
): Promise<ProviderSyncScheduleConfig | null> {
  const settings = await readOrganizationSettings(
    organizationId,
    [PROVIDER_SYNC_SCHEDULE_SETTING_KEY] as const,
    database
  )
  const value = settings[PROVIDER_SYNC_SCHEDULE_SETTING_KEY]
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as ProviderSyncScheduleConfig)
    : null
}

/**
 * The analog of `SUSPENDED_CONNECTOR_STATUSES`: a cadence only fires for an org
 * that has an accounting system connected and is not a demo.
 *
 * A demo org is excluded because its books are seeded fiction on an hour-long
 * lease; spending a provider's rate limit walking them is waste, and the demo
 * cleanup will delete the org underneath a running chain.
 */
export async function isSchedulableOrg(organizationId: string): Promise<boolean> {
  const provider = await resolveAccountingProvider(organizationId)
  if (provider.id === NONE_PROVIDER_ID) return false

  const [org] = await database
    .select({ demoExpiresAt: schema.Organization.demoExpiresAt })
    .from(schema.Organization)
    .where(eq(schema.Organization.id, organizationId))
    .limit(1)
  return !!org && !isDemoOrganization(org)
}

/**
 * Every organization with a live installation of a registered accounting
 * provider, excluding demo orgs. One query.
 *
 * 🛑 Deliberately NOT `resolveAccountingProvider` over every org: that reads the
 * installed-apps org cache per org, a Redis round trip each, and boot would be
 * O(orgs). This is the direct query brief 55 §5.1 says has to be written, and it
 * is the same fact the resolver answers - a live `AppInstallation`
 * (`uninstalledAt IS NULL`) for an `App.slug` an adapter has registered under.
 * The slug list comes from the registry rather than being spelled here, so the
 * two cannot disagree and Xero costs nothing.
 */
export async function listOrgsWithAccountingProvider(db: Database): Promise<string[]> {
  const providerIds = listAccountingProviderIds()
  if (providerIds.length === 0) {
    // `registerAccountingProviders()` has not run in this process, so every org
    // would resolve to the null provider anyway. A boot-order mistake, not a
    // quiet no-op.
    logger.warn('No accounting providers are registered; skipping the provider-sync reconcile')
    return []
  }

  const rows = await db
    .selectDistinct({ organizationId: schema.AppInstallation.organizationId })
    .from(schema.AppInstallation)
    .innerJoin(schema.App, eq(schema.App.id, schema.AppInstallation.appId))
    .innerJoin(
      schema.Organization,
      eq(schema.Organization.id, schema.AppInstallation.organizationId)
    )
    .where(
      and(
        isNull(schema.AppInstallation.uninstalledAt),
        inArray(schema.App.slug, providerIds),
        isNull(schema.Organization.demoExpiresAt)
      )
    )
  return rows.map((row) => row.organizationId)
}
