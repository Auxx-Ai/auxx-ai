// packages/lib/src/accounting/rails/feed-state.ts
//
// Client-safe and pure: the D2 decision table of plans/accounting/tasks/113 §2, fed by `feed-status.ts`.

import { processorByHandle } from '../processors/client'
import type { ProcessorDescriptor } from '../processors/types'
import type { RailFeedState, RailFeedStatus } from './client'

/** Connector statuses that mean the connector is on its way out, so it reads as absent. */
const DEAD_CONNECTOR_STATUSES: readonly string[] = ['disconnected', 'deleting', 'delete_failed']

/** Everything {@link decideRailFeedState} reads. The caller batches these across gateways. */
export interface RailFeedInputs {
  handles: readonly string[]
  /** A live feed already points at this rail. */
  linked: boolean
  /** Live unlinked feeds with activity (`listUnlinkedFeeds`), any provider. */
  unlinkedFeeds: readonly { processorAccountId: string; providerKey: string }[]
  /** Live feeds linked to another gateway, with that gateway. */
  linkedFeeds: readonly {
    providerKey: string
    gateway: { id: string; name: string; handles: string[] }
  }[]
  /** The org's `DataConnector` rows, any type and status. */
  connectors: readonly { id: string; type: string; status: string }[]
  /** Installed app slug → title. */
  installedApps: ReadonlyMap<string, string>
  /** Slug → title of apps the "Connect a source" picker would offer to install. */
  installableApps: ReadonlyMap<string, string>
}

/** The first processor, in handle order, whose feed an app reads. */
export function feedProcessorForHandles(handles: readonly string[]): ProcessorDescriptor | null {
  for (const handle of handles) {
    const processor = processorByHandle(handle)
    if (processor?.feedApp) return processor
  }
  return null
}

/** The processor a rail's feed state is about: one with a feed app first, then any. */
export function railProcessorForHandles(handles: readonly string[]): ProcessorDescriptor | null {
  return (
    feedProcessorForHandles(handles) ??
    handles.map(processorByHandle).find((p) => p !== null) ??
    null
  )
}

/** Decide one rail's feed state (brief 113 D2/D3). Never links anything. */
export function decideRailFeedState(inputs: RailFeedInputs): RailFeedStatus {
  const processor = railProcessorForHandles(inputs.handles)
  const feedApp = processor?.feedApp ?? null
  const connector = feedApp
    ? inputs.connectors.find(
        (row) => row.type === `app:${feedApp}` && !DEAD_CONNECTOR_STATUSES.includes(row.status)
      )
    : undefined
  const candidates = processor
    ? inputs.unlinkedFeeds.filter((feed) => feed.providerKey === processor.id)
    : []
  const elsewhere = processor
    ? inputs.linkedFeeds.find((feed) => feed.providerKey === processor.id)
    : undefined

  const status = (state: RailFeedState): RailFeedStatus => ({
    state,
    feedApp,
    feedAppTitle: feedApp
      ? (inputs.installedApps.get(feedApp) ?? inputs.installableApps.get(feedApp) ?? null)
      : null,
    processorLabel: processor?.label ?? null,
    connectorId: connector?.id ?? null,
    candidateSourceAccountId:
      state === 'available' && candidates.length === 1
        ? (candidates[0]?.processorAccountId ?? null)
        : null,
    optional: processor?.feeTreatment === 'billed',
    processorHandle: processor
      ? (inputs.handles.find((handle) => processorByHandle(handle)?.id === processor.id) ?? null)
      : null,
    linkedGateway: state === 'linked_elsewhere' && elsewhere ? elsewhere.gateway : null,
  })

  if (inputs.linked) return status('linked')
  if (candidates.length > 0) return status('available')
  if (elsewhere) return status('linked_elsewhere')
  if (!feedApp) return status('none')
  if (connector) return status('syncing')
  if (inputs.installedApps.has(feedApp)) return status('not_connected')
  if (inputs.installableApps.has(feedApp)) return status('not_installed')
  return status('none')
}
