// packages/lib/src/accounting/rails/feed-status.ts

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { getCachedInstalledApps } from '../../cache'
import { listRecommendedAppConnectors } from '../../data-connectors/recommended-app-connectors'
import type { PaymentGatewayRow, RailFeedStatus } from './client'
import { decideRailFeedState, feedProcessorForHandles, type RailFeedInputs } from './feed-state'
import { guard } from './guard'
import { listUnlinkedFeeds } from './settlement-discovery'

/** What the feed state reads off a gateway. `processorAccountId` is non-null exactly when a feed is linked. */
export type RailFeedGateway = Pick<PaymentGatewayRow, 'id' | 'handles' | 'processorAccountId'>

/**
 * Every gateway's feed state (brief 113 D2), keyed by gateway id. One read each of unlinked feeds,
 * connectors, installed apps and installable apps, and each is skipped when no gateway needs it.
 */
export async function listRailFeedStatuses(
  db: Database,
  organizationId: string,
  gateways: readonly RailFeedGateway[]
): Promise<Result<Map<string, RailFeedStatus>, Error>> {
  return guard(
    async () => {
      const open = gateways.filter((gateway) => gateway.processorAccountId === null)
      const feedApps = [
        ...new Set(
          open.flatMap((gateway) => feedProcessorForHandles(gateway.handles)?.feedApp ?? [])
        ),
      ]

      const [unlinkedFeeds, connectors, installed] = await Promise.all([
        open.length > 0 ? listUnlinkedFeeds(db, organizationId) : [],
        feedApps.length > 0
          ? db
              .select({
                id: schema.DataConnector.id,
                type: schema.DataConnector.type,
                status: schema.DataConnector.status,
              })
              .from(schema.DataConnector)
              .where(
                and(
                  eq(schema.DataConnector.organizationId, organizationId),
                  inArray(
                    schema.DataConnector.type,
                    feedApps.map((slug) => `app:${slug}` as const)
                  )
                )
              )
              .orderBy(schema.DataConnector.createdAt)
          : [],
        feedApps.length > 0 ? getCachedInstalledApps(organizationId) : [],
      ])

      const installedApps = new Map(installed.map((row) => [row.app.slug, row.app.title]))
      // The picker's own list, so `not_installed` only names an app the picker will show.
      const installableApps = new Map<string, string>()
      if (feedApps.some((slug) => !installedApps.has(slug))) {
        for (const row of await listRecommendedAppConnectors(db, organizationId)) {
          installableApps.set(row.appSlug, row.appTitle)
        }
      }

      const shared: Omit<RailFeedInputs, 'handles' | 'linked'> = {
        unlinkedFeeds,
        connectors,
        installedApps,
        installableApps,
      }
      return new Map(
        gateways.map((gateway) => [
          gateway.id,
          decideRailFeedState({
            ...shared,
            handles: gateway.handles,
            linked: gateway.processorAccountId !== null,
          }),
        ])
      )
    },
    'Failed to read payment gateway feed states',
    { organizationId }
  )
}

/** {@link listRailFeedStatuses} for one gateway. */
export async function railFeedStatus(
  db: Database,
  organizationId: string,
  gateway: RailFeedGateway
): Promise<Result<RailFeedStatus, Error>> {
  const result = await listRailFeedStatuses(db, organizationId, [gateway])
  return result.map((byId) => byId.get(gateway.id) as RailFeedStatus)
}
