// packages/lib/src/data-connectors/recommended-app-connectors.ts
// Discovery read for the "Connect a source" picker: connectors an org could get by
// installing a published, verified marketplace app it hasn't installed yet.
// See plans/data-connectors/v9/recommended-app-sources-plan.md.

import { type CatalogDataConnector, type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { inArray, sql } from 'drizzle-orm'
import { getCachedInstalledApps, getCachedPublishedApps } from '../cache'

const logger = createScopedLogger('data-connectors:recommended')

/**
 * Cap on how many recommendations the picker's Apps category will carry. The
 * recommended rows sit alongside the org's installed connectors, so an
 * unbounded list would bury what the org already has. If this ever truncates,
 * that is the signal to build real curation (ranking, an editorial flag)
 * instead of raising the number.
 */
const RECOMMENDED_CAP = 8

/** One connector an org could get by installing a published, verified app. */
export interface RecommendedAppConnector {
  /** `app:<slug>` — the same `DataConnectorType` the installed path creates. */
  type: string
  appSlug: string
  appTitle: string
  /** App logo URL, or the generic `package` glyph. Same cascade as the installed branch. */
  appIconId: string
  developerTitle: string | null
  connectorId: string
  label: string
  description: string
  iconKey: string | null
  requiresConnection: boolean
  requestModel: 'builder' | 'fixed'
}

/**
 * Connectors declared by published, **verified** apps this org has not installed.
 *
 * Eligibility is answered almost entirely from the `publishedApps` app cache,
 * which already holds only `publicationStatus = 'published'` rows and projects
 * both `verified` and `latestDeployment` (the newest `production`/`published`
 * deployment). The only DB work left is reading those deployments' connector
 * declarations.
 *
 * **Verified is not decoration here.** `apps.install` puts unverified apps behind
 * the `unverifiedApps` feature gate, so recommending one would dead-end most orgs
 * on a plan limit. And `verified` alone is not enough — an app can be verified but
 * unpublished (excluded by the cache) or published but unverified (excluded here).
 *
 * **Production deployments only.** The install this recommendation leads to runs
 * with no `deploymentId`, and `installApp` then defaults to the latest
 * `production`/`published` deployment. Recommending a connector declared only on a
 * development deployment would advertise a deployment the install would not pick.
 *
 * Never throws: this is a discovery nicety layered onto the connector picker, and
 * a failure here must not take the whole dialog down with it.
 */
export async function listRecommendedAppConnectors(
  db: Database,
  organizationId: string
): Promise<RecommendedAppConnector[]> {
  try {
    const [publishedApps, installedApps] = await Promise.all([
      getCachedPublishedApps(),
      getCachedInstalledApps(organizationId),
    ])

    // Match on slug, not installation id: an org running a DEVELOPMENT install of
    // an app must not be told to go install it.
    const installedSlugs = new Set(installedApps.map((a) => a.app.slug))

    const candidates = publishedApps.filter(
      (app) =>
        app.verified &&
        app.latestDeployment?.status === 'published' &&
        !installedSlugs.has(app.slug)
    )
    if (candidates.length === 0) return []

    const deploymentIds = candidates.map((app) => app.latestDeployment?.id).filter(Boolean)

    // Project the `dataConnectors` subtree in SQL. A full catalog blob carries the
    // app's whole tool/trigger/block/field registry; we want one key out of it and
    // there is no reason to ship the rest. `inArray`, never `= ANY(…::text[])` —
    // the latter matches nothing through Drizzle.
    const rows = await db
      .select({
        id: schema.AppDeployment.id,
        dataConnectors: sql<
          CatalogDataConnector[] | null
        >`${schema.AppDeployment.catalog} -> 'dataConnectors'`,
      })
      .from(schema.AppDeployment)
      .where(inArray(schema.AppDeployment.id, deploymentIds as string[]))

    const connectorsByDeployment = new Map(rows.map((r) => [r.id, r.dataConnectors ?? []]))

    const recommended: RecommendedAppConnector[] = []
    for (const app of candidates) {
      const declared = connectorsByDeployment.get(app.latestDeployment?.id ?? '') ?? []
      for (const dc of declared) {
        recommended.push({
          type: `app:${app.slug}`,
          appSlug: app.slug,
          appTitle: app.title,
          appIconId: app.avatarUrl ?? 'package',
          developerTitle: app.developerAccount?.title ?? null,
          connectorId: dc.id,
          label: dc.label,
          // Connector-declared description, falling back to the app's own — the
          // same cascade the installed branch uses, so a row reads identically
          // before and after install.
          description: dc.description ?? app.description ?? '',
          iconKey: dc.iconKey,
          requiresConnection: dc.requiresConnection,
          requestModel: dc.requestModel ?? 'fixed',
        })
      }
    }

    recommended.sort((a, b) => a.appTitle.localeCompare(b.appTitle))
    return recommended.slice(0, RECOMMENDED_CAP)
  } catch (error) {
    logger.warn('Failed to list recommended app connectors', { error, organizationId })
    return []
  }
}
