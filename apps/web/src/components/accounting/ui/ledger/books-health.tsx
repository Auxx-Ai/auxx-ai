// apps/web/src/components/accounting/ui/ledger/books-health.tsx

'use client'

import type { ExportBatchRow } from '@auxx/lib/accounting/export'
import { Button } from '@auxx/ui/components/button'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { CircleAlert, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { WARNING_RING, WARNING_ROW } from '../tone-rows'

/**
 * One shared reason, quoted once - that is the common case, because a role
 * nobody mapped refuses every batch that uses it. Anything more becomes a count.
 */
function refusedReasonSummary(refused: readonly ExportBatchRow[]): string {
  const reasons = new Set(refused.map((row) => row.lastError).filter(Boolean))
  if (reasons.size === 1) return [...reasons][0] as string
  if (reasons.size === 0) return 'No reason was recorded. Open the export queue for the detail.'
  return `${reasons.size} different reasons. Open the export queue for the detail.`
}

interface FailedExportsRowProps {
  /** ONLY refused batches. Held and in-flight ones belong in the export queue. */
  exports: ExportBatchRow[]
  /** 🔌 Never a vendor name. `UNKNOWN_PROVIDER_LABEL` when nothing is connected. */
  providerLabel: string
  /** Opens the export queue, where the rest of the outstanding copies live. */
  onOpenSyncQueue: () => void
}

/**
 * Entries that ARE in the books and that the provider REFUSED, as a count.
 *
 * 🛑 Refusals only, and a summary rather than a list (53 §7.2.2). With the
 * export hold on, `ready` is where every batch rests, so a row keyed on the
 * whole queue would be open forever; and 28 batches naming one unmapped account
 * are one reason, not 28 rows. The export queue is the list; this counts and
 * points at it.
 *
 * 🛑 The wording matters: these are not missing from the statements - they are
 * in the books and it is the COPY that is outstanding. See
 * plans/accounting/export-state-split.md.
 */
export function FailedExportsRow({
  exports: refused,
  providerLabel,
  onOpenSyncQueue,
}: FailedExportsRowProps) {
  const [isOpen, setIsOpen] = useState(false)

  if (refused.length === 0) return null

  return (
    <TreeRow
      expandable
      isOpen={isOpen}
      onToggleOpen={() => setIsOpen((open) => !open)}
      rowClassName={cn(WARNING_ROW, WARNING_RING)}
      icon={<CircleAlert className='size-4 text-yellow-600 dark:text-yellow-500' />}
      title={
        <span className='truncate text-yellow-700 dark:text-yellow-500'>
          {providerLabel} refused {refused.length} {refused.length === 1 ? 'batch' : 'batches'}.
          They are still in your books
        </span>
      }
      secondary={<span className='text-muted-foreground text-xs'>{refused.length}</span>}>
      <TreeRow
        depth={1}
        icon={<RefreshCw className='size-4 text-muted-foreground' />}
        title={
          // WRAPS, where `TreeRow` truncates: the summary is a whole sentence
          // naming what the provider objected to, and clipped at the row edge it
          // keeps the what and drops the why.
          <span className='block whitespace-normal py-1 text-sm'>
            {refusedReasonSummary(refused)}
          </span>
        }
        actions={
          <Button variant='outline' size='xs' onClick={onOpenSyncQueue}>
            Open the export queue
          </Button>
        }
      />
    </TreeRow>
  )
}
