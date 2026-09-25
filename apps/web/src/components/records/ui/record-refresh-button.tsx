// apps/web/src/components/records/ui/record-refresh-button.tsx
'use client'

import type { RecordRefreshOutcome } from '@auxx/lib/data-connectors/client'
import { PermissionKey } from '@auxx/lib/permissions/client'
import type { RecordId, RecordSourceChip } from '@auxx/lib/resources/client'
import type { FieldValueKey } from '@auxx/types/field'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppsContext } from '~/components/apps/providers/apps-context'
import { Tooltip } from '~/components/global/tooltip'
import { fieldValueFetchQueue } from '~/components/resources/store/field-value-fetch-queue'
import {
  parseFieldValueKey,
  useFieldValueStore,
} from '~/components/resources/store/field-value-store'
import { getNormalizedRecordId } from '~/components/resources/utils/normalize-record-id'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'

const POLL_MS = 1500
const POLL_LIMIT_MS = 2 * 60 * 1000
const MESSAGE_MS = 4000

/** One binding the record can be refreshed from. */
export interface RefreshEntry {
  key: string
  label: string
  connectorId?: string
  source?: { appInstallationId: string; connectionId: string | null }
}

interface ConnectorMeta {
  id: string
  name: string
  type: string
  appInstallationId: string | null
}

/**
 * The record's refresh entries: one per connector its hydrated cells name, else one per
 * source chip. A connector the cached list says is not an app is left out (the server
 * refuses a generic REST re-import).
 */
export function buildRefreshEntries(input: {
  connectorIds: string[]
  sources: RecordSourceChip[] | undefined
  connectors: ConnectorMeta[] | undefined
  appTitle: (appInstallationId: string) => string | undefined
}): RefreshEntry[] {
  const { connectorIds, sources = [], connectors, appTitle } = input
  const label = (title: string | undefined) => `Refresh from ${title ?? 'source'}`

  if (connectorIds.length > 0) {
    const onlyChip = sources.length === 1 ? sources[0] : undefined
    return connectorIds.flatMap((connectorId): RefreshEntry[] => {
      const connector = connectors?.find((c) => c.id === connectorId)
      if (connector && !connector.type.startsWith('app:')) return []
      const title = connector
        ? ((connector.appInstallationId && appTitle(connector.appInstallationId)) ?? connector.name)
        : connectorIds.length === 1 && onlyChip
          ? appTitle(onlyChip.appInstallationId)
          : undefined
      return [{ key: connectorId, label: label(title), connectorId }]
    })
  }

  return sources.map((chip) => ({
    key: `${chip.appInstallationId}:${chip.connectionId ?? ''}`,
    label: label(appTitle(chip.appInstallationId)),
    source: { appInstallationId: chip.appInstallationId, connectionId: chip.connectionId },
  }))
}

/** Distinct connector ids across the record's hydrated cells, read from the value store. */
function useRecordCellConnectorIds(recordId: RecordId): string[] {
  const prefix = `${getNormalizedRecordId(recordId)}:`
  return useFieldValueStore(
    useShallow((s) => {
      const ids = new Set<string>()
      for (const [key, info] of Object.entries(s.managedStates)) {
        if (key.startsWith(prefix)) ids.add(info.connectorId)
      }
      return [...ids].sort()
    })
  )
}

/** Re-read the record's cached cells in place, so the drawer shows what the run wrote. */
function refetchRecordCells(recordId: RecordId): void {
  const prefix = `${getNormalizedRecordId(recordId)}:`
  const requests = Object.keys(useFieldValueStore.getState().values)
    .filter((key) => key.startsWith(prefix))
    .map((key) => {
      const { recordId: id, fieldRef } = parseFieldValueKey(key as FieldValueKey)
      return { recordId: id, fieldRef }
    })
  void fieldValueFetchQueue.refetch(requests)
}

interface PendingRefresh {
  connectorId: string
  requestId: string
  queued: boolean
}

type Message = { text: string; tone: 'success' | 'neutral' | 'error' }

interface RecordRefreshButtonProps {
  recordId: RecordId
  sources: RecordSourceChip[] | undefined
  className?: string
}

/** Refresh-from-source next to the record's source chip (v13 §4). Renders nothing unbound. */
export function RecordRefreshButton({ recordId, sources, className }: RecordRefreshButtonProps) {
  const { can } = useAccess()
  const { appInstallations } = useAppsContext()
  const connectorIds = useRecordCellConnectorIds(recordId)
  // Cache read only: the cells' sync badges load this list; the header never fetches it.
  const { data: connectors } = api.dataConnector.list.useQuery(undefined, { enabled: false })

  const entries = useMemo(
    () =>
      buildRefreshEntries({
        connectorIds,
        sources,
        connectors,
        appTitle: (id) => appInstallations.find((i) => i.installationId === id)?.app.title,
      }),
    [connectorIds, sources, connectors, appInstallations]
  )

  const [pending, setPending] = useState<PendingRefresh | null>(null)
  const [message, setMessage] = useState<Message | null>(null)

  const refreshRecord = api.dataConnector.refreshRecord.useMutation({
    onSuccess: (data) => {
      setMessage(null)
      setPending({
        connectorId: data.connectorId,
        requestId: data.requestId,
        queued: data.status === 'queued',
      })
    },
    onError: (error) => toastError({ title: 'Couldn’t refresh', description: error.message }),
  })

  const status = api.dataConnector.refreshStatus.useQuery(
    { connectorId: pending?.connectorId ?? '', requestId: pending?.requestId ?? '' },
    {
      enabled: !!pending,
      refetchInterval: POLL_MS,
      // Bounded by POLL_LIMIT_MS; a hidden tab would otherwise freeze the line on "Refreshing…".
      refetchIntervalInBackground: true,
      staleTime: 0,
      gcTime: 0,
    }
  )

  useEffect(() => {
    const outcome: RecordRefreshOutcome | undefined = status.data
    if (!pending || outcome?.state !== 'done') return
    if (outcome.tone === 'success') refetchRecordCells(recordId)
    setPending(null)
    setMessage({ text: outcome.message, tone: outcome.tone })
  }, [status.data, pending, recordId])

  useEffect(() => {
    if (!pending) return
    const timer = setTimeout(() => {
      setPending(null)
      setMessage({
        text: 'The refresh hasn’t finished yet. Check the connector’s runs.',
        tone: 'neutral',
      })
    }, POLL_LIMIT_MS)
    return () => clearTimeout(timer)
  }, [pending])

  useEffect(() => {
    if (!message) return
    const timer = setTimeout(() => setMessage(null), MESSAGE_MS)
    return () => clearTimeout(timer)
  }, [message])

  if (entries.length === 0 || !can(PermissionKey.connectorsManage)) return null

  const busy = refreshRecord.isPending || !!pending
  const start = (entry: RefreshEntry) =>
    refreshRecord.mutate({ recordId, connectorId: entry.connectorId, source: entry.source })

  const line = pending
    ? pending.queued && status.data?.state !== 'running'
      ? 'Refreshing after the current sync…'
      : 'Refreshing…'
    : message?.text

  const [only] = entries
  const trigger = (
    <Button
      variant='ghost'
      size='icon-xs'
      loading={busy}
      aria-label={only && entries.length === 1 ? only.label : 'Refresh from source'}
      onClick={only && entries.length === 1 ? () => start(only) : undefined}>
      <RefreshCw />
    </Button>
  )

  return (
    <div className={cn('flex min-w-0 items-center gap-1', className)}>
      {entries.length === 1 && only ? (
        <Tooltip content={only.label} side='top'>
          {trigger}
        </Tooltip>
      ) : (
        <DropdownMenu>
          <Tooltip content='Refresh from source' side='top'>
            <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent align='start'>
            {entries.map((entry) => (
              <DropdownMenuItem key={entry.key} onSelect={() => start(entry)}>
                {entry.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {line && (
        <span
          role='status'
          title={line}
          className={cn(
            'truncate text-xs max-w-[10rem] sm:max-w-xs',
            message?.tone === 'error' && !pending ? 'text-red-600' : 'text-muted-foreground'
          )}>
          {line}
        </span>
      )}
    </div>
  )
}
