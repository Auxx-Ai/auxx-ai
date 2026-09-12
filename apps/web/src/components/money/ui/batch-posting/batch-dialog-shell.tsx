// apps/web/src/components/money/ui/batch-posting/batch-dialog-shell.tsx
'use client'

// The CHROME every batch dialog wears: the two-page shell, the footer bar and
// the result page's scroll-and-actions wrapper.
//
// (plans/accounting/tasks/25-batch-posting-and-credit-memos.md §5.1 - *"the
// whole dialog"* - and §5.2's warning about where that stops.)
//
// ## Why this is separate from `BatchPostingSource`
//
// Three dialogs have this shape: `manufacturing/builds/backfill-dialog.tsx`
// (the progenitor), and the two posting sources that copied it. Only the latter
// two share a *contract* - same wire range, same grouping vocabulary, same
// `posted / skipped / failed / exclusions` summary - so only they can be one
// descriptor-driven dialog.
//
// The builds backfill shares none of that: its range is two `Date`s bounded by
// the auto-build cutoff, its groupings are five and are filtered by another
// answer on the same screen, its exclusions table counts quantities rather than
// listing documents by date, and its result reports builds raised and left in
// progress rather than entries posted. Pushing it through the descriptor would
// mean a pluggable range, a dynamic grouping list, an overridable exclusions
// block, an overridable result page and a source-supplied run predicate - five
// slots, four of which exactly one source would ever set. §5.2 names that
// failure mode by hand.
//
// 🛑 **So what is shared here is the chrome and nothing else.** Everything below
// is markup that was byte-for-byte identical in all three files. If a prop shows
// up here that only one caller passes a meaningful value for, it belongs in that
// caller instead.

import { Button } from '@auxx/ui/components/button'
import { Dialog, DialogContent } from '@auxx/ui/components/dialog'
import { DialogNav, DialogNavPage, DialogNavPages } from '@auxx/ui/components/dialog-nav'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

/** Which of the two pages a batch dialog is showing. */
export type BatchDialogPage = 'plan' | 'result'

interface BatchDialogShellProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * True while the run is in flight.
   *
   * 🛑 It closes the dialog's own escape hatch, not just the buttons: a run is
   * non-atomic, so dismissing mid-flight would lose the only report of what it
   * managed to write.
   */
  busy: boolean
  /** Also the first crumb. */
  title: string
  description: string
  page: BatchDialogPage
  /** Makes the first crumb a jump back, but only from the result page. */
  onBackToPlan: () => void
  /** The preview page's rows, notes and tables. Wrapped in the scroller here. */
  planBody: ReactNode
  /** A {@link BatchDialogFooter}, pinned under the scroller. */
  planFooter: ReactNode
  /** The result page, which owns its own scroller - see {@link BatchDialogResultPage}. */
  result: ReactNode
}

/**
 * Dialog, breadcrumb header, and the plan/result page pair.
 *
 * Both pages declare `3xl`, so the card keeps its width across the transition
 * instead of springing between two sizes on a screen that is mostly a table.
 */
export function BatchDialogShell({
  open,
  onOpenChange,
  busy,
  title,
  description,
  page,
  onBackToPlan,
  planBody,
  planFooter,
  result,
}: BatchDialogShellProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent size='content' position='tc' innerClassName='p-0'>
        <DialogNav
          title={title}
          description={description}
          crumbs={[
            { label: title, onClick: page === 'result' ? onBackToPlan : undefined },
            ...(page === 'result' ? [{ label: 'Result' }] : []),
          ]}
        />

        <DialogNavPages value={page}>
          <DialogNavPage value='plan' size='3xl'>
            <div className='flex flex-col'>
              <ScrollArea viewportClassName='max-h-[70vh]' allowScrollChaining>
                <div className='flex flex-col gap-4 p-4'>{planBody}</div>
              </ScrollArea>
              {planFooter}
            </div>
          </DialogNavPage>

          <DialogNavPage value='result' size='3xl'>
            {result}
          </DialogNavPage>
        </DialogNavPages>
      </DialogContent>
    </Dialog>
  )
}

interface BatchDialogFooterProps {
  /**
   * What this run will do BEYOND the counts, said above them.
   *
   * The footer is the last thing read before the button, so an option that
   * writes to documents says so here and not only in its own caption.
   */
  warning?: ReactNode
  /**
   * The count line, in this dialog's nouns. Callers pass `'No preview yet'` when
   * there is no plan.
   */
  counts: ReactNode
  onCancel: () => void
  onSubmit: () => void
  submitLabel: ReactNode
  loading: boolean
  loadingText: string
  disabled: boolean
}

/**
 * The pinned footer.
 *
 * 🛑 **It is the feature, not decoration.** Watching the counts go from 613 to
 * 62 to 2 as the frequency changes is how the tradeoff becomes visible instead
 * of baked into a constant nobody can see (49 §2.3 item 2, 44 §7.2).
 */
export function BatchDialogFooter({
  warning,
  counts,
  onCancel,
  onSubmit,
  submitLabel,
  loading,
  loadingText,
  disabled,
}: BatchDialogFooterProps) {
  return (
    <div className='shrink-0 border-t'>
      {warning && (
        <p className='flex items-start gap-1.5 border-b bg-amber-50/60 px-4 py-2 text-sm dark:bg-amber-950/30'>
          <TriangleAlert className='mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-500' />
          <span>{warning}</span>
        </p>
      )}
      <div className='flex flex-wrap items-center justify-between gap-2 px-4 py-2.5'>
        <p className='text-muted-foreground text-sm tabular-nums'>{counts}</p>

        <div className='flex items-center gap-2'>
          <Button type='button' variant='ghost' size='sm' onClick={onCancel} disabled={loading}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            variant='outline'
            size='sm'
            onClick={onSubmit}
            loading={loading}
            loadingText={loadingText}
            disabled={disabled}
            data-dialog-submit>
            {submitLabel} <KbdSubmit variant='outline' size='sm' />
          </Button>
        </div>
      </div>
    </div>
  )
}

interface BatchDialogResultPageProps {
  children: ReactNode
  onBack: () => void
  onClose: () => void
}

/**
 * The result page's scroller and its two actions.
 *
 * "Back to the preview" rather than a close-only page: the preview is still the
 * answer to *"what did it leave behind?"*, and a run that skipped or refused
 * part of its plan is read there, not here.
 */
export function BatchDialogResultPage({ children, onBack, onClose }: BatchDialogResultPageProps) {
  return (
    <div className='flex flex-col'>
      <ScrollArea viewportClassName='max-h-[70vh]' allowScrollChaining>
        <div className='flex flex-col gap-3 p-4 text-sm'>{children}</div>
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
