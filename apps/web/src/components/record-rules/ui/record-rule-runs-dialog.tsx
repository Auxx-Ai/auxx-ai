// apps/web/src/components/record-rules/ui/record-rule-runs-dialog.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@auxx/ui/components/dialog'
import { formatDistanceToNow } from 'date-fns'
import { api } from '~/trpc/react'
import type { EditableRecordRule } from './record-rule-dialog'

interface RecordRuleRunsDialogProps {
  rule: EditableRecordRule
  open: boolean
  onClose: () => void
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive'> = {
  ok: 'secondary',
  partial: 'default',
  failed: 'destructive',
}

/** Recent firings of one rule with per-action outcomes — the debugging view. */
export function RecordRuleRunsDialog({ rule, open, onClose }: RecordRuleRunsDialogProps) {
  const { data: runs, isLoading } = api.recordRules.runs.useQuery(
    { ruleId: rule.id },
    { enabled: open }
  )

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size='md' position='tc' className='max-h-[80vh] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>Run history — {rule.name}</DialogTitle>
        </DialogHeader>

        {isLoading && <p className='text-sm text-muted-foreground'>Loading…</p>}
        {!isLoading && (!runs || runs.length === 0) && (
          <p className='text-sm text-muted-foreground'>This rule has not fired yet.</p>
        )}

        <div className='flex flex-col gap-2'>
          {runs?.map((run) => {
            const outcomes = Array.isArray(run.outcomes)
              ? (run.outcomes as {
                  actionIndex: number
                  type: string
                  status: string
                  error?: string
                }[])
              : []
            return (
              <div key={run.id} className='rounded-md border p-3 text-sm'>
                <div className='flex items-center gap-2'>
                  <Badge variant={STATUS_VARIANT[run.status] ?? 'default'}>{run.status}</Badge>
                  <span className='text-muted-foreground'>
                    {formatDistanceToNow(run.firedAt, { addSuffix: true })} · {run.source}
                  </span>
                </div>
                {run.fieldId && (
                  <p className='mt-1 text-muted-foreground'>
                    {JSON.stringify(run.oldValue)} → {JSON.stringify(run.newValue)}
                  </p>
                )}
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
