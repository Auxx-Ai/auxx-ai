// apps/web/src/components/data-connectors/ui/connector-coverage-check.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { AlertTriangle, Check, ChevronDown, ChevronRight, History } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { api, type RouterOutputs } from '~/trpc/react'
import { useCanManageConnectors } from '../hooks/use-can-manage-connectors'
import { formatHistoryDay } from '../lib/format-history'
import { ConnectorGlyph } from './connector-card'

type Coverage = RouterOutputs['dataConnector']['coverage']
type CoverageRow = Coverage['rows'][number]
type ImportOutcome = RouterOutputs['dataConnector']['importMissingHistory'][number]

const connectorHref = (row: CoverageRow, tab?: 'schedule') =>
  `/app/connectors/${row.connectorId}${tab ? `?tab=${tab}` : ''}`

/**
 * How far back every connected source's history reaches, against the books start − 60 days
 * (plans/data-connectors/v15/history-window.md §4 D). Shared by accounting setup and stock setup.
 */
export function ConnectorCoverageCheck({ className }: { className?: string }) {
  const canManage = useCanManageConnectors()
  const utils = api.useUtils()
  const coverage = api.dataConnector.coverage.useQuery(undefined, {
    refetchInterval: (query) => (query.state.data?.rows.some((r) => r.importing) ? 15000 : false),
  })
  const importHistory = api.dataConnector.importMissingHistory.useMutation()
  const [expanded, setExpanded] = useState(false)
  const [outcomes, setOutcomes] = useState<ImportOutcome[]>([])

  const data = coverage.data
  if (!data || data.rows.length === 0) return null
  const { needsFrom, rows } = data
  const short = rows.filter((r) => r.ok === false)
  const importable = short.filter((r) => !r.importing)

  const runImport = async (connectorId?: string) => {
    try {
      setOutcomes(await importHistory.mutateAsync({ connectorId }))
    } catch (error) {
      toastError({
        title: 'Could not import the missing history',
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      await utils.dataConnector.coverage.invalidate()
    }
  }

  const summary = !needsFrom
    ? `History from ${rows.length} connected ${rows.length === 1 ? 'source' : 'sources'}`
    : short.length === 0
      ? 'Connected data reaches back far enough'
      : `${short.length} of ${rows.length} sources start after ${formatHistoryDay(needsFrom)}`

  return (
    <div className={cn('flex flex-col gap-2 rounded-xl border p-3 text-sm', className)}>
      <div className='flex flex-wrap items-center gap-2'>
        {!needsFrom ? (
          <History className='size-4 shrink-0 text-muted-foreground' />
        ) : short.length === 0 ? (
          <Check className='size-4 shrink-0 text-green-600' />
        ) : (
          <AlertTriangle className='size-4 shrink-0 text-amber-600' />
        )}
        <button
          type='button'
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className='flex min-w-0 flex-1 items-center gap-1 text-left'>
          <span className='truncate'>{summary}</span>
          {expanded ? (
            <ChevronDown className='size-3.5 shrink-0 text-muted-foreground' />
          ) : (
            <ChevronRight className='size-3.5 shrink-0 text-muted-foreground' />
          )}
        </button>
        {canManage && needsFrom && importable.length > 0 && (
          <Button
            variant='outline'
            size='xs'
            loading={importHistory.isPending && !importHistory.variables?.connectorId}
            loadingText='Importing...'
            disabled={importHistory.isPending}
            onClick={() => runImport()}>
            Import missing history
          </Button>
        )}
      </div>

      {expanded && (
        <ul className='flex flex-col gap-1.5 border-t pt-2'>
          {rows.map((row) => (
            <CoverageLine
              key={row.connectorId}
              row={row}
              judged={!!needsFrom}
              canImport={canManage && !importHistory.isPending}
              importing={
                importHistory.isPending && importHistory.variables?.connectorId === row.connectorId
              }
              onImport={() => runImport(row.connectorId)}
            />
          ))}
        </ul>
      )}

      {needsFrom && expanded && (
        <p className='text-muted-foreground text-xs'>
          The books start needs data from {formatHistoryDay(needsFrom)}: 60 days before the books
          start, so orders paid or refunded after it are complete.
        </p>
      )}

      {outcomes.some(outcomeNote) && (
        <ul className='flex flex-col gap-0.5 text-muted-foreground text-xs'>
          {outcomes.map((o) => {
            const note = outcomeNote(o)
            return note ? <li key={o.connectorId}>{`${o.name}: ${note}`}</li> : null
          })}
        </ul>
      )}
    </div>
  )
}

/** One connector: icon, name, how far back it reaches, and what to do about it. */
function CoverageLine({
  row,
  judged,
  canImport,
  importing,
  onImport,
}: {
  row: CoverageRow
  judged: boolean
  canImport: boolean
  importing: boolean
  onImport: () => void
}) {
  const from = row.coverageFrom
    ? `from ${formatHistoryDay(row.coverageFrom)}`
    : 'from the beginning'
  return (
    <li className='flex min-w-0 items-center gap-2'>
      <ConnectorGlyph icon={row.icon} size='xs' />
      <Link
        href={connectorHref(row, judged ? undefined : 'schedule')}
        className='min-w-0 truncate hover:underline'>
        {row.name}
      </Link>
      <span className='shrink-0 text-muted-foreground text-xs'>{from}</span>
      <span className='ml-auto flex shrink-0 items-center gap-2'>
        {row.importing ? (
          <Link href={connectorHref(row)} className='text-primary-600 text-xs hover:underline'>
            Importing…
          </Link>
        ) : judged && row.ok === false && canImport ? (
          <Button variant='ghost' size='xs' loading={importing} onClick={onImport}>
            Import
          </Button>
        ) : null}
        {judged &&
          (row.ok ? (
            <Check className='size-3.5 text-green-600' />
          ) : (
            <AlertTriangle className='size-3.5 text-amber-600' />
          ))}
      </span>
    </li>
  )
}

/** The part of an import result a person has to act on or wait for; undefined when it just started. */
function outcomeNote(o: ImportOutcome): string | undefined {
  if (o.reimport === 'busy') return 'a sync is running. Try again when it ends.'
  if (o.reimport === 'refused' || (!o.reimport && !o.syncQueued && !o.resyncStamped && o.message))
    return o.message
  if (o.resyncStamped) return 'open the connector and run the re-sync it offers.'
  if (o.waiting.length > 0) return `${o.waiting.join(', ')} will reach the date in its first sync.`
  return undefined
}
