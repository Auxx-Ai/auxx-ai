// apps/web/src/components/manufacturing/ui/settings/standard-cost-section.tsx
'use client'

// The standard-cost section of Parts > Manage > General (money 52-parts-costing-page.md §2.2):
// the caller's setting rows, then the org-wide roll.
//
// 🛑 A roll restates the balance sheet, so the preview (`builds.previewRoll`, the same plan the
// mutation runs) is shown first and Confirm sits below the numbers.
//
// The page gates on `settingsManage`; the roll asserts edit on the `part` def, so it only renders
// for an actor who can edit parts.

import { FieldType } from '@auxx/database/enums'
import { calendarDayKey, toCalendarDayIso } from '@auxx/lib/field-values/client'
import { skipReasonLabel } from '@auxx/lib/inventory/builds/client'
import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { formatCurrency } from '@auxx/utils/currency'
import { keepPreviousData } from '@tanstack/react-query'
import { Calculator } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { SettingsSection } from '~/components/global/settings-page'
import { useResourceProperty } from '~/components/resources'
import { BaseType } from '~/components/workflow/types'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'

/** How many skipped parts to name before summarising the rest. */
const SKIPPED_VISIBLE = 8

export function StandardCostSection({ children }: { children?: ReactNode }) {
  const partDefId = useResourceProperty('part', 'id')
  const { canEditEntity } = useAccess()
  const canRoll = partDefId ? canEditEntity(partDefId) : false

  const [effectiveAt, setEffectiveAt] = useState<string>(() => toCalendarDayIso(new Date()))

  // A fresh effective date whenever the section regains the ability to roll, a
  // stale one left over from a tab somebody abandoned yesterday would silently
  // backdate the roll.
  useEffect(() => {
    if (canRoll) setEffectiveAt(new Date().toISOString())
  }, [canRoll])

  // `keepPreviousData` because the effective date is part of the query key:
  // without it every change to it blanks the whole preview (15 §4a), and this
  // one is org-wide, so the list that unmounts mid-keystroke is every part.
  const preview = api.builds.previewRoll.useQuery(
    { day: calendarDayKey(effectiveAt) ?? undefined },
    {
      enabled: canRoll,
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

  const plan = preview.data
  const changed = plan?.lines.filter((line) => line.changed) ?? []

  async function handleRoll() {
    try {
      await roll.mutateAsync({ day: calendarDayKey(effectiveAt) ?? undefined })
      await utils.builds.previewRoll.invalidate()
    } catch {
      // onError above already surfaced the toast.
    }
  }

  return (
    <SettingsSection
      icon={Calculator}
      title='Standard cost'
      description="Freeze today's cost as the value every stock movement is stamped with, across every part. Roll the standard first: a revaluation is the change in standard times the quantity on hand, so it costs nothing until stock exists, and it is never free again afterwards.">
      <div className='space-y-4'>
        <FieldPanel
          className='mt-1 p-0'
          resizeId='parts-general-auto-build'
          defaultLabelWidth={220}>
          {children}
          {canRoll && (
            <FieldPanelRow
              title='Effective'
              type={BaseType.DATE}
              showIcon
              description='When the new standards take effect.'>
              <FieldInputAdapter
                fieldType={FieldType.DATE}
                value={effectiveAt}
                onChange={(val) => setEffectiveAt((val as string) ?? new Date().toISOString())}
                disabled={roll.isPending}
              />
            </FieldPanelRow>
          )}
        </FieldPanel>

        <p className='text-muted-foreground text-xs'>
          Labor and overhead rates are set per part and absorbed only by a subassembly or finished
          good. A first standard never overwrites an existing one, so a supplier's price change
          moves the part's cost and leaves its standard; re-valuing is what the roll is for.
        </p>

        {!canRoll ? null : preview.isPending ? (
          <div className='space-y-2'>
            <Skeleton className='h-5 w-full' />
            <Skeleton className='h-5 w-full' />
            <Skeleton className='h-5 w-2/3' />
          </div>
        ) : preview.error ? (
          // An unpriced component surfaces HERE rather than half-way through a
          // write: the server refuses to value a parent whose child has no
          // standard, because treating it as zero understates the finished good.
          <p className='rounded-md bg-destructive/10 p-2 text-destructive text-xs'>
            {preview.error.message}
          </p>
        ) : plan ? (
          <div className='space-y-3 rounded-xl border p-3'>
            {changed.length === 0 ? (
              // Two different empty states, and calling the second one the first
              // is a lie: "already matches" claims every part carries a current
              // standard, when in fact not one of them could be valued. Only say
              // it when there genuinely were valuable lines and none moved. The
              // other case has its reasons listed right below.
              <p className='text-muted-foreground text-xs'>
                {plan.lines.length === 0 && plan.skipped.length > 0
                  ? 'Nothing to roll. No part can be valued yet, see why below.'
                  : 'Nothing to roll. Every part’s standard already matches today’s cost.'}
              </p>
            ) : (
              <div className='space-y-1'>
                <p className='text-muted-foreground text-xs'>
                  {changed.length} part{changed.length === 1 ? '' : 's'} would be revalued:
                </p>
                <ScrollArea className='max-h-56' allowScrollChaining>
                  <div className='divide-y divide-border/50'>
                    {changed.map((line) => (
                      <div
                        key={line.partId}
                        className='flex items-baseline gap-2 py-1.5 text-xs tabular-nums'>
                        <span className='flex-1 truncate'>{line.partName ?? line.partId}</span>
                        <span className='text-muted-foreground'>
                          {line.previousStandardCost == null
                            ? 'not rolled'
                            : formatCurrency(line.previousStandardCost)}
                        </span>
                        <span className='text-muted-foreground'>&rarr;</span>
                        <span className='font-medium'>{formatCurrency(line.standardCost)}</span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            {/* How much of the chart is a guess nobody has paid yet (73 §6.4). A
              provisional standard is replaced by its part's first receipt, not
              varied against, so the roll's delta is smaller than it looks while
              this number is short of the total. */}
            {plan.standardCount > 0 && (
              <p className='border-border/50 border-t pt-2 text-muted-foreground text-xs'>
                {plan.confirmedStandardCount} of {plan.standardCount} parts have a confirmed
                standard.
                {plan.confirmedStandardCount < plan.standardCount &&
                  ' The rest are provisional — a typed guess, replaced by the part’s first receipt.'}
              </p>
            )}

            {/* The number this whole preview exists for. */}
            <div className='space-y-1 border-t border-border/50 pt-2 text-xs tabular-nums'>
              <SummaryRow
                label='Inventory revaluation'
                hint='(new standard minus old) x qty on hand'
                value={plan.revaluationDelta}
                signed
              />
              {plan.initialValue !== 0 && (
                <SummaryRow
                  label='First valuation'
                  hint='parts that had no standard before, so not a revaluation'
                  value={plan.initialValue}
                />
              )}
            </div>

            {plan.skipped.length > 0 && (
              <div className='space-y-1 border-t border-border/50 pt-2 text-xs'>
                <p className='text-muted-foreground'>
                  Not valued ({plan.skipped.length}). Left untouched, never written as zero:
                </p>
                <ul className='space-y-0.5'>
                  {plan.skipped.slice(0, SKIPPED_VISIBLE).map((skip) => (
                    <li key={skip.partId} className='truncate text-muted-foreground'>
                      {skip.partName ?? skip.partId} &mdash; {skipReasonLabel(skip)}
                    </li>
                  ))}
                </ul>
                {plan.skipped.length > SKIPPED_VISIBLE && (
                  <p className='text-muted-foreground'>
                    and {plan.skipped.length - SKIPPED_VISIBLE} more.
                  </p>
                )}
              </div>
            )}

            {/* Confirm sits below the numbers it confirms, deliberately. */}
            <div className='flex justify-end border-t border-border/50 pt-3'>
              <Button
                variant='outline'
                size='sm'
                loading={roll.isPending}
                loadingText='Rolling...'
                disabled={changed.length === 0 || roll.isPending}
                onClick={handleRoll}>
                Roll standard cost
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </SettingsSection>
  )
}

/** One summed number with the arithmetic that produced it spelled out. */
function SummaryRow({
  label,
  hint,
  value,
  signed,
}: {
  label: string
  hint: string
  value: number
  signed?: boolean
}) {
  const sign = signed && value > 0 ? '+' : ''
  return (
    <div className='flex items-baseline justify-between gap-2'>
      <span className='text-muted-foreground'>
        {label} <span className='text-[10px]'>{hint}</span>
      </span>
      <span className='font-medium'>
        {sign}
        {formatCurrency(value)}
      </span>
    </div>
  )
}
