// packages/lib/src/accounting/rails/feed-status.ts

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { getCachedInstalledApps } from '../../cache'
import { listRecommendedAppConnectors } from '../../data-connectors/recommended-app-connectors'
import type { PaymentGatewayRow, RailFeedStatus } from './client'
import {
  decideRailFeedState,
  feedProcessorForHandles,
  type RailFeedInputs,
  railProcessorForHandles,
} from './feed-state'
import { guard } from './guard'
import { listLinkedFeeds, listPaymentGateways } from './reads'
import { listUnlinkedFeeds } from './settlement-discovery'

/**
 * What the feed state reads off a gateway. `processorAccountId` is non-null exactly when a feed is
 * linked. `name` saves a gateway read when this gateway is the one another's feed is linked to.
 */
export type RailFeedGateway = Pick<PaymentGatewayRow, 'id' | 'handles' | 'processorAccountId'> & {
  name?: string
}

/**
 * Every gateway's feed state (brief 113 D2), keyed by gateway id. One read each of unlinked feeds,
 * linked feeds, connectors, installed apps and installable apps, and each is skipped when no
 * gateway needs it. The gateways a linked feed names are read only when `gateways` lacks them.
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

      const processorIds = new Set<string>(
        open.flatMap((gateway) => railProcessorForHandles(gateway.handles)?.id ?? [])
      )

      const [unlinkedFeeds, linkedRows, connectors, installed] = await Promise.all([
        open.length > 0 ? listUnlinkedFeeds(db, organizationId) : [],
        processorIds.size > 0 ? listLinkedFeeds(db, organizationId) : [],
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

      const linkedFeeds = await linkedFeedGateways(
        db,
        organizationId,
        linkedRows.filter((row) => processorIds.has(row.providerKey)),
        gateways
      )

      const shared: Omit<RailFeedInputs, 'handles' | 'linked'> = {
        unlinkedFeeds,
        linkedFeeds,
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

/** Attach each linked feed's gateway; `known` answers first, one gateway list read covers the rest. */
async function linkedFeedGateways(
  db: Database,
  organizationId: string,
  rows: readonly { providerKey: string; paymentGatewayId: string }[],
  known: readonly RailFeedGateway[]
): Promise<RailFeedInputs['linkedFeeds']> {
  if (rows.length === 0) return []
  const byId = new Map<string, { id: string; name: string; handles: string[] }>()
  for (const gateway of known) {
    if (gateway.name !== undefined)
      byId.set(gateway.id, { id: gateway.id, name: gateway.name, handles: gateway.handles })
  }
  if (rows.some((row) => !byId.has(row.paymentGatewayId))) {
    const all = await listPaymentGateways(db, organizationId, { includeArchived: true })
    if (all.isErr()) throw all.error
    for (const gateway of all.value) {
      byId.set(gateway.id, { id: gateway.id, name: gateway.name, handles: gateway.handles })
    }
  }
  return rows.flatMap((row) => {
    const gateway = byId.get(row.paymentGatewayId)
    return gateway ? [{ providerKey: row.providerKey, gateway }] : []
  })
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

/**
 * The feed state a rail would have if a gateway with these handles existed and had no feed, one per
 * group in order: the add dialog's and the wizard's answer before the gateway is written.
 */
export async function railFeedStatusesForHandles(
  db: Database,
  organizationId: string,
  groups: readonly (readonly string[])[]
): Promise<Result<RailFeedStatus[], Error>> {
  const drafts = groups.map((handles, index) => ({
    id: `draft:${index}`,
    handles: [...handles],
    processorAccountId: null,
  }))
  const result = await listRailFeedStatuses(db, organizationId, drafts)
  return result.map((byId) => drafts.map((draft) => byId.get(draft.id) as RailFeedStatus))
}
