// apps/web/src/components/rules/ui/rule-runs-dialog.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@auxx/ui/components/dialog'
import { formatDistanceToNow } from 'date-fns'
import type { ReactNode } from 'react'

/** The minimum a run row must expose for the shared history view. */
export interface RuleRunRow {
  id: string
  /** `'ok' | 'partial' | 'failed'` — anything else falls back to the neutral badge. */
  status: string
  /** Which door dispatched the firing. */
  source: string
  firedAt: Date
  /** `[{ actionIndex, type, status, error? }]` — jsonb, so narrowed at render time. */
  outcomes: unknown
}

/** One action's result within a run. */
interface RuleRunOutcome {
  actionIndex: number
  type: string
  status: string
  error?: string
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive'> = {
  ok: 'secondary',
  partial: 'default',
  failed: 'destructive',
}

export interface RuleRunsDialogProps<R extends RuleRunRow> {
  open: boolean
  onClose: () => void
  /** Rule name, shown after "Run history — ". */
  name: string
  /** Already-fetched runs, newest first. */
  runs: R[] | undefined
  isLoading: boolean
  /** Copy for the never-fired state. */
  emptyText: string
  /** Feature-specific detail line under the run header (e.g. the old → new value). */
  renderExtraColumns?: (run: R) => ReactNode
}

/** Recent firings of one rule with per-action outcomes — the debugging view. */
export function RuleRunsDialog<R extends RuleRunRow>({
  open,
  onClose,
  name,
  runs,
  isLoading,
  emptyText,
  renderExtraColumns,
}: RuleRunsDialogProps<R>) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size='md' position='tc' className='max-h-[80vh] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>Run history: {name}</DialogTitle>
        </DialogHeader>

        {isLoading && <p className='text-sm text-muted-foreground'>Loading…</p>}
        {!isLoading && (!runs || runs.length === 0) && (
          <p className='text-sm text-muted-foreground'>{emptyText}</p>
        )}

        <div className='flex flex-col gap-2'>
          {runs?.map((run) => {
            const outcomes = Array.isArray(run.outcomes) ? (run.outcomes as RuleRunOutcome[]) : []
            return (
              <div key={run.id} className='rounded-md border p-3 text-sm'>
                <div className='flex items-center gap-2'>
                  <Badge variant={STATUS_VARIANT[run.status] ?? 'default'}>{run.status}</Badge>
                  <span className='text-muted-foreground'>
                    {formatDistanceToNow(run.firedAt, { addSuffix: true })} · {run.source}
                  </span>
                </div>
                {renderExtraColumns?.(run)}
                {outcomes.length > 0 && (
                  <ul className='mt-2 flex flex-col gap-1'>
                    {outcomes.map((o) => (
                      <li key={o.actionIndex} className='flex items-center gap-2'>
                        <Badge variant={o.status === 'failed' ? 'destructive' : 'secondary'}>
                          {o.status}
                        </Badge>
                        <span>{o.type}</span>
                        {o.error && <span className='text-destructive'>{o.error}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
