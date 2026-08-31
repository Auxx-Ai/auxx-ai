// apps/web/src/components/data-import/plan-preview/import-complete-card.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { EntityIcon } from '@auxx/ui/components/icons'
import { AlertTriangle, Ban, CheckCircle2, Plus, RefreshCw, SearchX, XCircle } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useAnalytics } from '~/hooks/use-analytics'
import { api } from '~/trpc/react'

interface ImportCompleteCardProps {
  jobId: string
  entityDefinitionId: string
  statistics: {
    created: number
    updated: number
    /** Rows skipped because they carry an ERROR. */
    skipped: number
    /**
     * Rows skipped because update-only mode found no record to update.
     *
     * Never folded into `skipped`, and never omitted from this card: an
     * update-only run that matched nothing otherwise reports "0 created,
     * 0 updated, 0 skipped" and reads like a successful no-op.
     */
    unmatched: number
    /**
     * Rows the writer REJECTED. Same rule as `unmatched`, and for a sharper
     * reason: this card used to have no failed tile and no failure branch at
     * all, so an import that rejected every one of its 201 rows rendered
     * "0 / 0 / 0 / 0" under a green check and read as a clean run.
     */
    failed: number
    /** Rows that imported with at least one warning (values skipped) */
    warnings?: number
  }
  onComplete: () => void
}

/**
 * The five post-run outcome tiles, in the order a reader scans them.
 *
 * `Unmatched`, `Skipped` and `Failed` are three different things and never
 * share a tile: `skipped` is "this row has an error and was not attempted",
 * `unmatched` is "this row is fine, but update-only mode found no record to
 * update", `failed` is "this row was attempted and the writer rejected it".
 * One number for any two of them is how a wholly unimported file reads as a
 * clean run.
 */
const STAT_TILES = [
  { key: 'created', label: 'Created', icon: Plus },
  { key: 'updated', label: 'Updated', icon: RefreshCw },
  { key: 'unmatched', label: 'Unmatched', icon: SearchX },
  { key: 'skipped', label: 'Skipped', icon: Ban },
  { key: 'failed', label: 'Failed', icon: XCircle },
] as const satisfies ReadonlyArray<{
  key: 'created' | 'updated' | 'unmatched' | 'skipped' | 'failed'
  label: string
  icon: typeof Plus
}>

/**
 * Card displayed when import execution finishes, showing final statistics.
 *
 * The header reflects the actual outcome — success, partial, or total failure —
 * rather than announcing "Import Complete" unconditionally.
 */
export function ImportCompleteCard({
  jobId,
  entityDefinitionId,
  statistics,
  onComplete,
}: ImportCompleteCardProps) {
  const posthog = useAnalytics()
  const trackedRef = useRef(false)

  const landed = statistics.created + statistics.updated
  const hasFailures = statistics.failed > 0
  // Nothing was written AND rows were rejected — the run achieved nothing.
  const totalFailure = hasFailures && landed === 0

  const { data: failures } = api.dataImport.getJobFailures.useQuery(
    { jobId, limit: 5 },
    { enabled: hasFailures }
  )

  // Track contacts_imported once when the card mounts
  useEffect(() => {
    if (!trackedRef.current && entityDefinitionId === 'contact') {
      trackedRef.current = true
      posthog?.capture('contacts_imported', {
        count: statistics.created + statistics.updated,
      })
    }
  }, [entityDefinitionId, statistics, posthog])

  const title = totalFailure
    ? 'Import Failed'
    : hasFailures
      ? 'Imported With Errors'
      : 'Import Complete'

  return (
    <div className='flex flex-col items-center justify-center flex-1'>
      <div className='w-full max-w-[360px] border rounded-2xl overflow-hidden'>
        {/* Header — icon and wording follow the outcome, not the mere fact of finishing */}
        <div className='flex items-center justify-between p-4 border-b'>
          <div className='flex items-center gap-3 min-w-0'>
            <EntityIcon iconId={hasFailures ? 'alert-triangle' : 'check'} variant='muted' />
            <div className='min-w-0'>
              <p className='font-medium text-sm'>{title}</p>
              <p className='text-sm text-muted-foreground'>{entityDefinitionId}</p>
            </div>
          </div>
          {totalFailure ? (
            <XCircle className='size-5 text-destructive' />
          ) : hasFailures ? (
            <AlertTriangle className='size-5 text-amber-500' />
          ) : (
            <CheckCircle2 className='size-5 text-green-500' />
          )}
        </div>

        {/* Stats grid: hairlines drawn by the gap over a border-coloured bed */}
        <div className='grid grid-cols-2 gap-px bg-border'>
          {STAT_TILES.map(({ key, label, icon: Icon }) => (
            <div
              key={key}
              className={`bg-background p-4 text-center ${
                // Odd tile count — the failed tile spans the last row so the
                // grid never ends on a half-width orphan.
                key === 'failed' ? 'col-span-2' : ''
              }`}>
              <div
                className={`flex items-center justify-center gap-1.5 mb-1 ${
                  key === 'failed' && hasFailures ? 'text-destructive' : 'text-muted-foreground'
                }`}>
                <Icon className='size-3.5' />
                <span className='text-xs font-medium'>{label}</span>
              </div>
              <p
                className={`text-2xl font-bold ${
                  key === 'failed' && hasFailures ? 'text-destructive' : ''
                }`}>
                {statistics[key].toLocaleString()}
              </p>
            </div>
          ))}
        </div>

        {/* Why the rows failed — grouped, so one systemic cause reads as one line */}
        {hasFailures && failures && failures.reasons.length > 0 && (
          <div className='px-4 py-3 border-t text-sm space-y-1.5'>
            {failures.reasons.map((reason) => (
              <div key={reason.message} className='flex gap-2'>
                <span className='font-medium text-destructive shrink-0 tabular-nums'>
                  {reason.count.toLocaleString()}×
                </span>
                <span className='text-muted-foreground min-w-0 break-words'>{reason.message}</span>
              </div>
            ))}
            {failures.total > failures.reasons.reduce((sum, reason) => sum + reason.count, 0) && (
              <p className='text-xs text-muted-foreground pt-1'>
                ...and other reasons. See import history for the full list.
              </p>
            )}
          </div>
        )}

        {/* Warnings notice */}
        {(statistics.warnings ?? 0) > 0 && (
          <div className='flex items-center gap-2 px-4 py-3 border-t text-sm text-muted-foreground'>
            <AlertTriangle className='size-4 shrink-0 text-amber-500' />
            <span>
              {statistics.warnings} {statistics.warnings === 1 ? 'row' : 'rows'} imported with
              warnings — some values were skipped
            </span>
          </div>
        )}

        {/* Done button */}
        <div className='p-4 border-t bg-muted/30'>
          <Button onClick={onComplete} className='w-full'>
            Done
          </Button>
        </div>
      </div>
    </div>
  )
}
