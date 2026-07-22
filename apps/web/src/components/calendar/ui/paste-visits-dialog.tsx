// apps/web/src/components/calendar/ui/paste-visits-dialog.tsx
//
// Paste-options dialog (plan 37c §4.3) — moved here in Phase 6 (§8) so both the dispatch board
// and the schedule surface can share one dialog instead of duplicating it; the board keeps
// importing it from this shared location.

'use client'

import { FieldType } from '@auxx/database/enums'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { RadioGroup, RadioGroupItem } from '@auxx/ui/components/radio-group'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { format } from 'date-fns'
import { useEffect, useMemo, useState } from 'react'
import { computePasteTimes, hoursToDate } from '~/components/calendar/core/clipboard-offset'
import type { CopiedVisitItem } from '~/components/calendar/core/clipboard-store'
import type { PasteAnchor } from '~/components/calendar/core/use-calendar-clipboard'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import type { api } from '~/trpc/react'

/** The synthetic "Unassigned" resource-column id — mirrors `board/types.ts`'s
 * `UNASSIGNED_RESOURCE_ID`, duplicated here (not imported) so this shared dialog doesn't reach
 * into the dispatch feature tree for one string constant. A paste target whose `resourceId`
 * equals this is treated the same as no resource column at all (no retarget option). */
const UNASSIGNED_RESOURCE_ID = 'unassigned'

/** Minimal worker shape the "assign all to <worker>" retarget option needs — duck-typed so any
 * consumer's own worker list (the board's richer `BoardWorker`) satisfies it structurally without
 * this shared dialog importing a feature-specific type. Keyed by `id` (`DispatchWorker.id`, the
 * column identity — teams have no `userId`); `user` is absent for a team, which falls back to
 * `name` (its display label). */
export interface PasteWorkerOption {
  id: string
  name?: string | null
  user?: { name: string | null; email: string | null } | null
}

export interface PasteVisitsDialogProps {
  /** `null` = closed. Set by a clipboard hook's Cmd+V handler or a context menu's "Paste here" —
   * always the anchor at the moment the paste was invoked. */
  target: PasteAnchor | null
  onOpenChange: (open: boolean) => void
  items: CopiedVisitItem[]
  /** Worker rows the retarget option can offer — empty when the surface has no per-worker
   * columns at all (schedule's week/day/month views never do, so it always passes `[]`). */
  workers: PasteWorkerOption[]
  pasteVisits: ReturnType<typeof api.dispatch.pasteVisits.useMutation>
}

type AssigneeMode = 'keep' | 'clear' | 'assign'
type TimesMode = 'keep' | 'slot'

function workerLabel(worker: PasteWorkerOption): string {
  return worker.name ?? worker.user?.name ?? worker.user?.email ?? 'Worker'
}

/**
 * Paste-options dialog (plan 37c §4.3) — the confirm for BOTH invocation routes (Cmd+V and the
 * context menu's "Paste here"). One `Dialog` + `FieldPanel`, modeled on the route planner's
 * `ApplyTimesDialog` (live preview list + one editable field + a single confirm mutation).
 * `dispatch.pasteVisits` is the one deliberate batch endpoint (§4.4) — this dialog's confirm is
 * its only caller.
 */
export function PasteVisitsDialog({
  target,
  onOpenChange,
  items,
  workers,
  pasteVisits,
}: PasteVisitsDialogProps) {
  const open = target !== null

  const [targetDay, setTargetDay] = useState<Date>(() => target?.day ?? new Date())
  const [assigneeMode, setAssigneeMode] = useState<AssigneeMode>('keep')
  const [timesMode, setTimesMode] = useState<TimesMode>('keep')

  // Re-seed every time the dialog opens for a NEW target — never while it's open (an option
  // toggle shouldn't stomp the dispatcher's own edits mid-dialog). Options reset to their
  // defaults too, so a stale "assign all to <worker>" from a previous open can't silently
  // apply to a different target.
  useEffect(() => {
    if (target) {
      setTargetDay(target.day)
      setAssigneeMode('keep')
      setTimesMode('keep')
    }
  }, [target])

  // The retarget option (§4.3) only exists when the target slot carries a real worker row —
  // week/month views and the synthetic "Unassigned" column never offer it.
  const targetWorker = useMemo(
    () =>
      target?.resourceId && target.resourceId !== UNASSIGNED_RESOURCE_ID
        ? (workers.find((w) => w.id === target.resourceId) ?? null)
        : null,
    [target?.resourceId, workers]
  )
  const hasSlotTime = target?.time !== undefined

  const results = useMemo(() => {
    if (!target) return []
    const slotTime =
      timesMode === 'slot' && target.time !== undefined
        ? hoursToDate(targetDay, target.time)
        : undefined
    return computePasteTimes(
      items,
      { day: targetDay, time: slotTime },
      {
        startAtSlot: timesMode === 'slot' && slotTime !== undefined,
      }
    )
  }, [items, target, targetDay, timesMode])

  const handleConfirm = () => {
    if (results.length === 0) return
    pasteVisits.mutate(
      {
        items: results.map((r) => ({
          workOrderRecordId: r.item.workOrderRecordId,
          startTime: r.startTime,
          endTime: r.endTime,
          assigneeWorkerId:
            assigneeMode === 'keep'
              ? r.item.assigneeWorkerId
              : assigneeMode === 'clear'
                ? null
                : (targetWorker?.id ?? null),
        })),
      },
      {
        onSuccess: () => onOpenChange(false),
        onError: (error) =>
          toastError({ title: 'Error pasting visits', description: error.message }),
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent position='tc'>
        <DialogHeader>
          <DialogTitle>
            Paste {items.length} visit{items.length === 1 ? '' : 's'}
          </DialogTitle>
          <DialogDescription>
            Creates a new visit on the same work order for each copied item — never moves or clones
            the original.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4'>
          <FieldPanel className='p-0' breakpoint='md'>
            <FieldPanelRow title='Target date'>
              <FieldInputAdapter
                fieldType={FieldType.DATE}
                value={targetDay.toISOString()}
                onChange={(val) => {
                  if (val) setTargetDay(new Date(val as string))
                }}
                disabled={pasteVisits.isPending}
              />
            </FieldPanelRow>
          </FieldPanel>

          <div className='space-y-1.5'>
            <span className='text-xs text-muted-foreground'>Times</span>
            <RadioGroup
              value={timesMode}
              onValueChange={(v) => setTimesMode(v as TimesMode)}
              className='gap-1.5'>
              <label className='flex items-center gap-2 text-sm'>
                <RadioGroupItem value='keep' size='sm' /> Keep original times
              </label>
              <label
                className={cn(
                  'flex items-center gap-2 text-sm',
                  !hasSlotTime && 'text-muted-foreground'
                )}>
                <RadioGroupItem value='slot' size='sm' disabled={!hasSlotTime} /> Start at clicked
                slot
              </label>
            </RadioGroup>
          </div>

          <div className='space-y-1.5'>
            <span className='text-xs text-muted-foreground'>Assignee</span>
            <RadioGroup
              value={assigneeMode}
              onValueChange={(v) => setAssigneeMode(v as AssigneeMode)}
              className='gap-1.5'>
              <label className='flex items-center gap-2 text-sm'>
                <RadioGroupItem value='keep' size='sm' /> Keep original assignee
              </label>
              <label className='flex items-center gap-2 text-sm'>
                <RadioGroupItem value='clear' size='sm' /> Clear (unassigned)
              </label>
              {targetWorker && (
                <label className='flex items-center gap-2 text-sm'>
                  <RadioGroupItem value='assign' size='sm' /> Assign all to{' '}
                  {workerLabel(targetWorker)}
                </label>
              )}
            </RadioGroup>
          </div>

          <div className='max-h-72 space-y-1.5 overflow-y-auto rounded-2xl border py-2 px-3'>
            {results.length === 0 ? (
              <p className='text-muted-foreground px-1 py-2 text-xs'>Nothing to paste.</p>
            ) : (
              results.map((r) => (
                <div key={r.item.visitId} className='flex items-center gap-2 text-xs'>
                  <span className='min-w-0 flex-1 truncate'>{r.item.title}</span>
                  <span className='shrink-0 text-muted-foreground'>
                    {format(r.item.start, 'MMM d, p')} → {format(r.startTime, 'MMM d, p')}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => onOpenChange(false)}
            disabled={pasteVisits.isPending}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            onClick={handleConfirm}
            variant='outline'
            size='sm'
            loading={pasteVisits.isPending}
            loadingText='Pasting...'
            disabled={results.length === 0}
            data-dialog-submit>
            Paste <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
