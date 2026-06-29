// ~/components/data-connectors/hooks/use-connector-sync-realtime.ts

'use client'

import type { DataConnectorSyncEvent } from '@auxx/lib/realtime'
import { useCallback } from 'react'
import { useOrgChannel } from '~/realtime/hooks'
import { api, type RouterOutputs } from '~/trpc/react'

type ConnectorStatusData = RouterOutputs['dataConnector']['getStatus']

/**
 * Live connector-sync updates for one connector's detail view. Listens on the org
 * channel for `dataConnector:sync` and:
 *  - `progress` → patches the cached `getStatus` in place (instant counter motion,
 *    no refetch).
 *  - lifecycle (`run-started` / `run-finished`) → invalidates `getStatus` + `listRuns`
 *    for the authoritative shape (new run row, freshness, schedule, resyncPending —
 *    none of which the frame carries).
 *
 * Best-effort (realtime is never authoritative): the detail view keeps a slow
 * safety poll while syncing so a dropped frame still converges.
 */
export function useConnectorSyncRealtime(connectorId: string) {
  const utils = api.useUtils()

  const onEvent = useCallback(
    (event: string, payload: unknown) => {
      if (event !== 'dataConnector:sync') return
      const data = payload as DataConnectorSyncEvent['data']
      if (data.connectorId !== connectorId) return

      if (data.kind === 'progress') {
        const cached = utils.dataConnector.getStatus.getData({ id: connectorId })
        // No run cached yet (progress raced ahead of the run-started refetch) — hydrate
        // the authoritative shape instead of patching onto a null run.
        if (!cached?.latestRun) {
          utils.dataConnector.getStatus.invalidate({ id: connectorId })
          return
        }
        utils.dataConnector.getStatus.setData({ id: connectorId }, (prev) =>
          prev ? mergeProgress(prev, data) : prev
        )
        return
      }

      utils.dataConnector.getStatus.invalidate({ id: connectorId })
      utils.dataConnector.listRuns.invalidate({ id: connectorId })
    },
    [connectorId, utils]
  )

  useOrgChannel({ onEvent })
}

/** Merge a `progress` frame onto the cached status — overwrite live counters, keep the rest. */
function mergeProgress(
  prev: ConnectorStatusData,
  data: DataConnectorSyncEvent['data']
): ConnectorStatusData {
  return {
    ...prev,
    status: data.connectorStatus,
    lastSyncedAt: data.lastSyncedAt ? new Date(data.lastSyncedAt) : prev.lastSyncedAt,
    perStream: data.perStream,
    latestRun: prev.latestRun
      ? {
          ...prev.latestRun,
          status: data.runStatus ?? prev.latestRun.status,
          phase: data.phase ?? prev.latestRun.phase,
          recordsSeen: data.recordsSeen,
          created: data.created,
          updated: data.updated,
        }
      : prev.latestRun,
  }
}
