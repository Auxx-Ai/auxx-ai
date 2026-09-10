// apps/web/src/components/manufacturing/ui/settings/standard-cost-section.tsx
'use client'

// The org-wide standard-cost roll, the `?s=standard` tab of Parts > Settings >
// Costing (money 52-parts-costing-page.md §2.2).
//
// 🛑 A roll restates the balance sheet, so this is never a button that just
// fires. THE PREVIEW IS THE COMPONENT: `builds.previewRoll` runs the same plan
// the mutation will run and reports the revaluation delta per part and summed,
// plus every part that cannot be valued and why, in plain words. Confirm sits
// BELOW the numbers, not beside a trigger.
//
// ⚠️ `builds.previewRoll` and `builds.roll` take `partIds` as OPTIONAL, so
// omitting it is already the org-wide roll this page wants. No new procedure.
//
// ── Why it lives here, and what that removed ─────────────────────────────────
//
// It used to be a section of Accounting > General, and it carried a bespoke
// read-only fallback because of it: both procedures are `capabilityProcedure` +
// `assertEditEntity(part def)` rather than a `ledger.*` key, so a bookkeeper
// with full ledger access and no part rights still had to reach the period and
// Finalize rows on that page, and had to be told why this one section was shut.
//
// 🛑 That fallback is GONE, and moving the section is what deleted it. On this
// page the section's gate and the page's gate are the same call - `Costing`
// itself gates on edit of the `part` def (`costing-settings-page.tsx`), which is
// exactly what these two procedures assert - so an actor who cannot roll never
// reaches this component at all. A read-only branch here would be unreachable
// by construction, and an unreachable branch that explains a permission is worse
// than none: it rots without anybody noticing it stopped being true.
//
// ⚠️ The cost of the move is that the roll is one page away from two of its
// three inputs - the `manufacturing.*` absorption rates deliberately stay on
// Accounting > General (§2.2, decision 3). Rates change rarely; the round trip
// is rare.

import { FieldType } from '@auxx/database/enums'
import { skipReasonLabel } from '@auxx/lib/builds/client'
import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { formatCurrency } from '@auxx/utils/currency'
import { keepPreviousData } from '@tanstack/react-query'
import { Calculator } from 'lucide-react'
import { useEffect, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { SettingsSection } from '~/components/global/settings-page'
import { useResourceProperty } from '~/components/resources'
import { BaseType } from '~/components/workflow/types'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'

/** How many skipped parts to name before summarising the rest. */
const SKIPPED_VISIBLE = 8

export function StandardCostSection() {
  // The roll's authority is edit on the `part` definition, so the query resolves
  // the same def id the server asserts against. The PAGE redirects on this same
  // answer; this is only what keeps the preview from firing a request the server
  // would refuse while access is still hydrating.
  const partDefId = useResourceProperty('part', 'id')
  const { canEditEntity } = useAccess()
  const canRoll = partDefId ? canEditEntity(partDefId) : false

  const [effectiveAt, setEffectiveAt] = useState<string>(() => new Date().toISOString())

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
    { effectiveAt: new Date(effectiveAt) },
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
      await roll.mutateAsync({ effectiveAt: new Date(effectiveAt) })
      await utils.builds.previewRoll.invalidate()
    } catch {
      // onError above already surfaced the toast.
    }
  }

  return (
    <SettingsSection
      icon={Calculator}
      title='Standard cost'
      description='Freeze today&apos;s cost as the value every stock movement is stamped with, across every part.'>
      <FieldPanel
        className='mt-1 p-0'
        resizeId='parts-costing-standard-cost'
        defaultLabelWidth={220}>
        <FieldPanelRow
          title='Effective'
          type={BaseType.DATE}
          showIcon
          description='When the new standards take effect.'>
          <FieldInputAdapter
            fieldType={FieldType.DATETIME}
            value={effectiveAt}
            onChange={(val) => setEffectiveAt((val as string) ?? new Date().toISOString())}
            disabled={roll.isPending}
          />
        </FieldPanelRow>
      </FieldPanel>

      {preview.isPending ? (
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
