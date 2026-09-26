// apps/web/src/components/manufacturing/parts/roll-standard-cost-popover.tsx
'use client'

// The standard-cost roll (plans/products/build/01-build-plan.md §2.4).
//
// 🛑 **A roll restates the balance sheet, so this is never a button that just
// fires.** The whole component is the preview: `builds.previewRoll` runs the
// same plan the mutation will run and reports the revaluation delta per part
// and summed, plus every part that cannot be valued at all. Confirming is the
// second step, and it is deliberately below the numbers rather than beside the
// trigger.
//
// Scoped to one part, and **widened server-side to every ancestor of it** — a
// finished good whose subassembly's standard just moved is carrying a standard
// built from the old number, so rolling the child alone would leave the two
// disagreeing. That is why the preview usually lists more parts than the one
// this popover was opened from.

import { FieldType } from '@auxx/database/enums'
import { calendarDayKey, toCalendarDayIso } from '@auxx/lib/field-values/client'
import { skipReasonLabel } from '@auxx/lib/inventory/builds/client'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { formatCurrency } from '@auxx/utils/currency'
import { keepPreviousData } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
import { useOrgCurrency } from '~/hooks/use-org-currency'
import { api } from '~/trpc/react'

/** "Oct 1" for a `YYYY-MM-DD` book day, read as that calendar day in every zone. */
function formatDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

interface RollStandardCostPopoverProps {
  /** The part's entityInstanceId. */
  partId: string
  onSuccess?: () => void
  children: React.ReactNode
}

export function RollStandardCostPopover({
  partId,
  onSuccess,
  children,
}: RollStandardCostPopoverProps) {
  const [open, setOpen] = useState(false)
  const [effectiveAt, setEffectiveAt] = useState<string>(() => toCalendarDayIso(new Date()))
  const currencyCode = useOrgCurrency()

  // A fresh effective date every time it opens — a stale one left over from a
  // popover somebody abandoned yesterday would silently backdate the roll.
  useEffect(() => {
    if (open) setEffectiveAt(toCalendarDayIso(new Date()))
  }, [open])

  // `keepPreviousData` because the effective date is part of the query key:
  // without it every change to it blanks the whole preview (15 §4a). The lines,
  // the revaluation summary and the skipped list all unmount and the confirm
  // button disables, mid-keystroke, on a surface whose entire job is showing
  // numbers before a write.
  const preview = api.builds.previewRoll.useQuery(
    { partIds: [partId], day: calendarDayKey(effectiveAt) ?? undefined },
    {
      enabled: open,
      retry: false,
      refetchOnWindowFocus: false,
      placeholderData: keepPreviousData,
    }
  )

  const utils = api.useUtils()
  const roll = api.builds.roll.useMutation({
    onError: (error) =>
      toastError({ title: 'Failed to roll standard cost', description: error.message }),
  })

  const handleRoll = async () => {
    try {
      await roll.mutateAsync({ partIds: [partId], day: calendarDayKey(effectiveAt) ?? undefined })
      await utils.builds.previewRoll.invalidate()
      onSuccess?.()
      setOpen(false)
    } catch {
      // onError above already surfaced the toast.
    }
  }

  const plan = preview.data
  const changed = plan?.lines.filter((line) => line.changed) ?? []
  // The preview reports the range, only the roll refuses (D-SC5); a placeholder plan is another day's.
  const range = plan?.dateRange
  const outOfRange =
    !!plan &&
    !!range &&
    ((range.earliestAt != null && plan.effectiveAt < range.earliestAt) ||
      plan.effectiveAt > range.latestAt)
  const money = (minor: number) => formatCurrency(minor, { currencyCode })

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className='w-[26rem]' align='end'>
        <div className='space-y-3'>
          <div>
            <h4 className='font-semibold text-sm'>Roll standard cost</h4>
            {/* The mechanism AND the consequence: the second sentence is why
                anyone would press this, and it is what "Not rolled" costs. */}
            <p className='mt-0.5 text-muted-foreground text-xs'>
              Freezes today&apos;s cost as the value every stock movement will be stamped with. This
              part and everything built from it. Without a standard this part cannot be built,
              adjusted, received, or counted into a month-end close.
            </p>
          </div>

          <FieldPanel className='p-0'>
            <FieldPanelRow
              title='Effective'
              type={BaseType.DATE}
              showIcon
              description='When the new standard takes effect'>
              <FieldInputAdapter
                fieldType={FieldType.DATE}
                value={effectiveAt}
                onChange={(val) => setEffectiveAt((val as string) ?? toCalendarDayIso(new Date()))}
                disabled={roll.isPending}
              />
            </FieldPanelRow>
          </FieldPanel>

          {range?.earliestDay && (
            <p
              className={outOfRange ? 'text-destructive text-xs' : 'text-muted-foreground text-xs'}>
              Earliest {formatDay(range.earliestDay)}:{' '}
              {range.earliestSetBy?.partName ?? 'a part it revalues'} moved{' '}
              {formatDay(range.earliestDay)}
            </p>
          )}
          {outOfRange && !range?.earliestDay && (
            <p className='text-destructive text-xs'>A roll can&apos;t be dated in the future.</p>
          )}

          {preview.isPending ? (
            <div className='space-y-2'>
              <Skeleton className='h-5 w-full' />
              <Skeleton className='h-5 w-full' />
            </div>
          ) : preview.error ? (
            // An unpriced component surfaces HERE rather than half-way through a
            // write: the server refuses to value a parent whose child has no
            // standard, because treating it as zero understates the finished good.
            <p className='rounded-md bg-destructive/10 p-2 text-destructive text-xs'>
              {preview.error.message}
            </p>
          ) : plan ? (
            <div className='space-y-2'>
              {changed.length === 0 ? (
                // Two different empty states, and calling the second one the
                // first is a lie: "already matches" claims a standard exists and
                // is current, when in fact nothing could be valued at all. Only
                // say it when there genuinely were valuable lines and none moved.
                // The "cannot be valued" case has its reasons listed right below.
                <p className='text-muted-foreground text-xs'>
                  {plan.lines.length === 0 && plan.skipped.length > 0
                    ? 'Nothing to roll: no part here can be valued yet. See why below.'
                    : 'Nothing to roll: the standard already matches today’s cost.'}
                </p>
              ) : (
                <ScrollArea className='max-h-48' allowScrollChaining>
                  <div className='divide-y divide-border/50'>
                    {changed.map((line) => (
                      <div
                        key={line.partId}
                        className='flex items-baseline gap-2 py-1.5 text-xs tabular-nums'>
                        <span className='flex-1 truncate'>{line.partName ?? line.partId}</span>
                        <span className='text-muted-foreground'>
                          {line.previousStandardCost == null
                            ? '—'
                            : money(line.previousStandardCost)}
                        </span>
                        <span className='text-muted-foreground'>&rarr;</span>
                        <span className='font-medium'>{money(line.standardCost)}</span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}

              {/* The number this whole preview exists for. */}
              <div className='space-y-1 border-t border-border/50 pt-2 text-xs tabular-nums'>
                <p className='font-medium'>
                  Posts {formatDay(plan.dateRange.effectiveDay)} · revalues {plan.revaluedQuantity}{' '}
                  on hand · {plan.revaluationDelta > 0 ? '+' : ''}
                  {money(plan.revaluationDelta)}
                </p>
                {plan.initialValue !== 0 && (
                  <p className='text-muted-foreground'>
                    First valuation {money(plan.initialValue)}: parts with no standard before, not a
                    revaluation
                  </p>
                )}
              </div>

              {plan.keptManual.length > 0 && (
                <p className='border-t border-border/50 pt-2 text-muted-foreground text-xs'>
                  Kept (set by hand):{' '}
                  {plan.keptManual
                    .map((part) => `${part.partName ?? part.partId} ${money(part.standardCost)}`)
                    .join(', ')}
                </p>
              )}

              {plan.skipped.length > 0 && (
                <div className='border-t border-border/50 pt-2 text-xs'>
                  <p className='text-muted-foreground'>
                    Not valued ({plan.skipped.length}) — left untouched, never written as zero:
                  </p>
                  <ul className='mt-1 space-y-0.5'>
                    {plan.skipped.slice(0, 5).map((skip) => (
                      <li key={skip.partId} className='truncate text-muted-foreground'>
                        {skip.partName ?? skip.partId} — {skipReasonLabel(skip)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : null}

          <div className='flex justify-end gap-2'>
            <Button variant='ghost' size='sm' onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size='sm'
              loading={roll.isPending}
              loadingText='Rolling...'
              disabled={
                !plan ||
                preview.isPlaceholderData ||
                changed.length === 0 ||
                outOfRange ||
                roll.isPending
              }
              onClick={handleRoll}>
              Roll standard cost
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
