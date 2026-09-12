// apps/web/src/components/money/ui/batch-posting/batch-posting-result.tsx
'use client'

/**
 * What the run actually did, per group.
 *
 * 🛑 **Skipped is not failed and neither is an error.** `postEntry` never throws:
 * `already_posted` means the group is in the books already, and a locked period
 * means somebody closed the month. Reporting either as a failure is what makes
 * people press the button a second time, which on this screen would be asking
 * for the same revenue twice.
 *
 * Shared across sources. Only the nouns come from the descriptor.
 */

import { Button } from '@auxx/ui/components/button'
import { KbdSubmit } from '@auxx/ui/components/kbd'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { countLabel } from './count-label'
import type { BatchPostingCount, BatchPostingPostedRow, BatchPostingSummaryShape } from './types'

/** How many rows of a list are printed before it collapses into "and N more". */
const ROWS_SHOWN = 24

interface BatchPostingResultProps<Summary extends BatchPostingSummaryShape> {
  result: Summary | null
  /** What the posted entries covered, in this source's nouns. */
  membersPosted: BatchPostingCount
  postedRows: ReadonlyArray<BatchPostingPostedRow>
  /**
   * What this source's option did, from `BatchPostingOptionsSlot.resultNote`.
   *
   * Rendered directly under the posted entries and ABOVE skipped and failed: an
   * option that writes to documents (issuing a draft) leaves work behind when it
   * refuses, and the bottom of a list of 62 groups is where that gets lost.
   */
  optionNote?: ReactNode
  excludedNoun: { singular: string; plural: string }
  onBack: () => void
  onClose: () => void
}

export function BatchPostingResult<Summary extends BatchPostingSummaryShape>({
  result,
  membersPosted,
  postedRows,
  optionNote,
  excludedNoun,
  onBack,
  onClose,
}: BatchPostingResultProps<Summary>) {
  if (!result) return null

  const posted = postedRows.length
  const skipped = result.skipped.length
  const failed = result.failed.length
  const excluded = result.exclusions.length

  return (
    <div className='flex flex-col'>
      <ScrollArea viewportClassName='max-h-[70vh]' allowScrollChaining>
        <div className='flex flex-col gap-3 p-4 text-sm'>
          <p>
            <strong className='font-medium'>{posted}</strong>{' '}
            {posted === 1 ? 'entry was' : 'entries were'} posted, covering{' '}
            {countLabel(membersPosted)}.
          </p>

          {posted > 0 && (
            <ul className='ps-4 text-muted-foreground text-xs tabular-nums'>
              {postedRows.slice(0, ROWS_SHOWN).map((row) => (
                <li key={row.groupKey}>
                  <span className='font-mono'>{row.docNumber}</span> · {row.groupKey} · {row.note}
                </li>
              ))}
              {posted > ROWS_SHOWN && <li>and {posted - ROWS_SHOWN} more</li>}
            </ul>
          )}

          {optionNote}

          {skipped > 0 && (
            <div>
              <p>
                {skipped} {skipped === 1 ? 'group was' : 'groups were'} skipped. Nothing was written
                for {skipped === 1 ? 'it' : 'them'}, and nothing is wrong.
              </p>
              <ul className='mt-1 ps-4 text-muted-foreground text-xs'>
                {result.skipped.slice(0, ROWS_SHOWN).map((row) => (
                  <li key={row.groupKey}>
                    {row.groupKey}: {row.status}, {row.reason}
                  </li>
                ))}
                {skipped > ROWS_SHOWN && <li>and {skipped - ROWS_SHOWN} more</li>}
              </ul>
            </div>
          )}

          {failed > 0 && (
            <div>
              <p className='flex items-start gap-1.5'>
                <TriangleAlert className='mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-500' />
                <span>
                  {failed} {failed === 1 ? 'group' : 'groups'} wrote nothing at all. They stay
                  unposted and come back in the next preview.
                </span>
              </p>
              <ul className='mt-1 ps-6 text-muted-foreground text-xs'>
                {result.failed.slice(0, ROWS_SHOWN).map((row) => (
                  <li key={row.groupKey}>
                    {row.groupKey}: {row.reason}
                  </li>
                ))}
                {failed > ROWS_SHOWN && <li>and {failed - ROWS_SHOWN} more</li>}
              </ul>
            </div>
          )}

          {excluded > 0 && (
            <p className='text-muted-foreground text-xs'>
              {excluded}{' '}
              {excluded === 1 ? `${excludedNoun.singular} was` : `${excludedNoun.plural} were`}{' '}
              excluded from this run. They are listed with their reasons on the preview.
            </p>
          )}
        </div>
      </ScrollArea>

      <div className='flex shrink-0 items-center justify-end gap-2 border-t px-4 py-2.5'>
        <Button type='button' variant='ghost' size='sm' onClick={onBack}>
          Back to the preview
        </Button>
        <Button variant='outline' size='sm' onClick={onClose} data-dialog-submit>
          Done <KbdSubmit variant='outline' size='sm' />
        </Button>
      </div>
    </div>
  )
}
