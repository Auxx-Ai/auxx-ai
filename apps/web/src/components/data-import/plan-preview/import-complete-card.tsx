// apps/web/src/components/data-import/plan-preview/import-complete-card.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { EntityIcon } from '@auxx/ui/components/icons'
import { AlertTriangle, Ban, CheckCircle2, Plus, RefreshCw, SearchX } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useAnalytics } from '~/hooks/use-analytics'

interface ImportCompleteCardProps {
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
    /** Rows that imported with at least one warning (values skipped) */
    warnings?: number
  }
  onComplete: () => void
}

/**
 * The four post-run outcome tiles, in the order a reader scans them.
 *
 * `Unmatched` sits beside `Skipped` rather than inside it for the same reason
 * the pre-run summary and the row badge keep them apart: `skipped` is "this row
 * has an error", `unmatched` is "this row is fine, but update-only mode found no
 * record to update". One number for both is how a wholly unimported file reads
 * as a clean run.
 */
const STAT_TILES = [
  { key: 'created', label: 'Created', icon: Plus },
  { key: 'updated', label: 'Updated', icon: RefreshCw },
  { key: 'unmatched', label: 'Unmatched', icon: SearchX },
  { key: 'skipped', label: 'Skipped', icon: Ban },
] as const satisfies ReadonlyArray<{
  key: 'created' | 'updated' | 'unmatched' | 'skipped'
  label: string
  icon: typeof Plus
}>

/**
 * Card displayed when import is complete, showing final statistics.
 */
export function ImportCompleteCard({
  entityDefinitionId,
  statistics,
  onComplete,
}: ImportCompleteCardProps) {
  const posthog = useAnalytics()
  const trackedRef = useRef(false)

  // Track contacts_imported once when the card mounts
  useEffect(() => {
    if (!trackedRef.current && entityDefinitionId === 'contact') {
      trackedRef.current = true
      posthog?.capture('contacts_imported', {
        count: statistics.created + statistics.updated,
      })
    }
  }, [entityDefinitionId, statistics, posthog])
  return (
    <div className='flex flex-col items-center justify-center flex-1'>
      <div className='w-full max-w-[360px] border rounded-2xl overflow-hidden'>
        {/* Header with success icon */}
        <div className='flex items-center justify-between p-4 border-b'>
          <div className='flex items-center gap-3 min-w-0'>
            <EntityIcon iconId='check' variant='muted' />
            <div className='min-w-0'>
              <p className='font-medium text-sm'>Import Complete</p>
              <p className='text-sm text-muted-foreground'>{entityDefinitionId}</p>
            </div>
          </div>
          <CheckCircle2 className='size-5 text-green-500' />
        </div>

        {/* Stats grid: 2x2, hairlines drawn by the gap over a border-coloured bed */}
        <div className='grid grid-cols-2 gap-px bg-border'>
          {STAT_TILES.map(({ key, label, icon: Icon }) => (
            <div key={key} className='bg-background p-4 text-center'>
              <div className='flex items-center justify-center gap-1.5 text-muted-foreground mb-1'>
                <Icon className='size-3.5' />
                <span className='text-xs font-medium'>{label}</span>
              </div>
              <p className='text-2xl font-bold'>{statistics[key].toLocaleString()}</p>
            </div>
          ))}
        </div>

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
