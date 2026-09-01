// apps/web/src/components/manufacturing/parts/build-part-form.tsx
'use client'

// Build a part from its own drawer (plans/money/tasks/23-build-from-the-part.md §3).
//
// A part drawer could already move stock two ways — Receive and Adjust — and not
// the third. This is the third, and it is a sibling of those two rather than a
// mode of either.
//
// 🛑 **The breakdown underneath is not decoration.** `receive-stock-popover.tsx`
// states the rule this follows: the figure that gets frozen forever must be
// visible before it is frozen, because a number nobody can check is a number
// nobody catches. Here it does double duty — it is also how a person sees that a
// component has no standard cost before pressing a button that will refuse.
//
// ✅ It costs no new read path. `builds.previewCompletion` takes `{ partId,
// quantityProduced }` and NEVER loads a build row, so this shows the exact
// consumption plan, produced value and variance the run would post, from the
// same query the completion dialog already trusts. A second read path over the
// same arithmetic is how a preview and a write come to disagree.

import { FieldType } from '@auxx/database/enums'
import { summarizeBuildCompletion } from '@auxx/lib/builds/client'
import type { RecordId } from '@auxx/lib/resources/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { formatCurrency } from '@auxx/utils/currency'
import { keepPreviousData } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { useOpenRecord } from '~/components/records/record-drill-panels'
import { useResourceProperty } from '~/components/resources'
import { BaseType } from '~/components/workflow/types'
import { useSettings } from '~/hooks/use-settings'
import { api } from '~/trpc/react'

const PREVIEW_DEBOUNCE_MS = 250

/**
 * What every write on this surface invalidates afterwards.
 *
 * 🛑 `completeBuild` writes on the QUIET lane, so it emits no `record:created`
 * frame and no open build list learns about it. The same set `build-run-card`
 * invalidates, for the same reason.
 *
 * The part's own QoH is NOT here on purpose: `batchRecalculateQoH` ends in
 * `publishFieldValueUpdates` with no `excludeSocketId`, and the client merges
 * that frame with no self-filter, so the number at the top of the card repaints
 * itself. Invalidating the part record would DELETE every cached field value on
 * it — the pattern two purchasing surfaces removed after it visibly reset their
 * open forms.
 *
 * Exported because the completion dialog `Plan and open...` raises is mounted by
 * the CALLER, and it must land on the same invalidations as the form's own
 * buttons.
 */
export function useBuildRefresh(onSuccess?: () => void): () => Promise<void> {
  const utils = api.useUtils()
  const buildDefId = useResourceProperty('build', 'id')

  return useCallback(async () => {
    await Promise.all([
      utils.builds.list.invalidate(),
      buildDefId
        ? utils.record.listFiltered.invalidate({ entityDefinitionId: buildDefId })
        : Promise.resolve(),
    ])
    onSuccess?.()
  }, [utils, buildDefId, onSuccess])
}

/** A run `Plan and open...` has raised, handed up for the completion dialog. */
export interface PlannedBuild {
  buildId: string
  quantityPlanned: number
  number: string | null
}

interface BuildPartFormProps {
  /** The part's entityInstanceId. */
  partId: string
  /** Whether this member may post a ledger — gates `Build now`, never `Plan` (B2). */
  canPostLedger: boolean
  /** Called after anything that changed the part's stock or its builds. */
  onSuccess?: () => void
  /** Dismiss whatever surface this form is mounted in. */
  onDone: () => void
  /**
   * Hand a raised run to the caller so IT can open the completion dialog.
   *
   * 🛑 The dialog cannot live in here. This form unmounts the moment the run is
   * raised — that is what dismissing the surface means — and a dialog rendered
   * as its sibling would go with it before anybody saw it.
   */
  onPlanAndOpen: (planned: PlannedBuild) => void
}

/**
 * Quantity, notes, the plan underneath, and three verbs.
 *
 * Mounted as a pane of the `Actions` popover (`part-stock-actions.tsx`), which
 * owns the surface. It resets by unmounting, like its two siblings.
 *
 * | Button | Calls | Result |
 * | --- | --- | --- |
 * | `Plan` | `builds.create` | a `planned` run; writes nothing; opens its drawer |
 * | `Plan and open...` | `builds.create` | the run, with the full completion dialog on it |
 * | `Build now` | `builds.buildNow` | create + start + complete; ledger posted |
 *
 * 🛑 **`Build now` asserts BOM-standard consumption, zero scrap and the
 * effective absorption rates.** No component overrides, no scrap, and the two
 * absorbed amounts omitted so the server resolves them. That assertion is true
 * for most small runs and false for some — `Plan and open...` is what the person
 * wants when it is false, which is why this form does not grow override inputs.
 */
export function BuildPartForm({
  partId,
  canPostLedger,
  onSuccess,
  onDone,
  onPlanAndOpen,
}: BuildPartFormProps) {
  const [quantity, setQuantity] = useState<number | null>(1)
  const [notes, setNotes] = useState('')

  const { getSetting } = useSettings({})
  const currencyCode = (getSetting('organization.currency') as string | null) ?? 'USD'
  const openRecord = useOpenRecord()

  const previewQuantity = useDebouncedPositive(quantity, PREVIEW_DEBOUNCE_MS)

  // 🛑 `keepPreviousData` for the reason the completion dialog states: without
  // it every keystroke changes the query key, `data` goes undefined, and the
  // whole plan blanks — which reads as "the numbers just went away" on a form
  // whose primary button cannot be undone.
  const preview = api.builds.previewCompletion.useQuery(
    { partId, quantityProduced: previewQuantity },
    {
      enabled: previewQuantity > 0,
      retry: false,
      refetchOnWindowFocus: false,
      placeholderData: keepPreviousData,
    }
  )

  const plan = preview.data?.plan
  const rates = preview.data?.rates
  const onHand = preview.data?.onHand

  const summary = useMemo(() => {
    if (!plan || plan.producedUnitCost == null || !rates) return null
    return summarizeBuildCompletion({
      components: plan.components,
      producedUnitCost: plan.producedUnitCost,
      quantityProduced: previewQuantity,
      quantityScrapped: 0,
      rates,
    })
  }, [plan, rates, previewQuantity])

  /**
   * The balance every component lands on, keyed by part.
   *
   * ⚠️ **A warning, never a gate.** `completeBuild` has no on-hand check at all
   * and deliberately still has none: receiving keyed late is normal in a small
   * shop, and a build refused on a stale count is a worse failure than a
   * negative that a receipt corrects an hour later.
   *
   * 🛑 The call is recorded as the weakest one in the brief, against a number:
   * three deliberate builds run from the completion dialog by somebody watching
   * produced TWELVE negative balances in DemoOrg1, lowest -11. A warning would
   * have fired three times and been ignored three times.
   *
   * So it is a COLUMN, not a block underneath. The old shape restated every
   * short part in a second list below the plan — on a BOM where eight of eight
   * go negative that is the same eight names twice, which is how a warning
   * becomes wallpaper. The resulting balance now sits on the line it belongs to,
   * red when it goes negative and green when it does not, so a plan that is fine
   * says so on every row rather than only by the absence of something.
   */
  const resultingByPart = useMemo(() => {
    if (!plan || !onHand) return null
    return Object.fromEntries(
      plan.components.map((line) => [
        line.partId,
        (onHand[line.partId] ?? 0) - line.quantityConsumed,
      ])
    ) as Record<string, number>
  }, [plan, onHand])

  const refresh = useBuildRefresh(onSuccess)

  const createBuild = api.builds.create.useMutation({
    onError: (error) => toastError({ title: 'Failed to raise build', description: error.message }),
  })

  const build = api.builds.buildNow.useMutation({
    onError: (error) => toastError({ title: 'Failed to build', description: error.message }),
  })

  const isPending = createBuild.isPending || build.isPending
  const canSubmit = quantity != null && quantity > 0 && !isPending

  const raise = async () => {
    if (quantity == null) return null
    try {
      const raised = await createBuild.mutateAsync({
        partId,
        quantityPlanned: quantity,
        ...(notes ? { notes } : {}),
      })
      await refresh()
      return raised
    } catch {
      // onError above already surfaced the toast. The two refusals a person
      // meets here are sentences from `createBuild` — a part classified as
      // purchased, and a part with no bill of materials — and they are not
      // duplicated as a disabled button, because the menu item that opened this
      // pane already applies the same two rules and this is the fallback.
      return null
    }
  }

  const handlePlan = async () => {
    const raised = await raise()
    if (!raised) return
    onDone()
    openRecord?.(raised.recordId as RecordId)
  }

  const handlePlanAndOpen = async () => {
    const raised = await raise()
    if (!raised) return
    onDone()
    onPlanAndOpen({
      buildId: raised.buildId,
      quantityPlanned: raised.quantityPlanned ?? quantity ?? 1,
      number: raised.number,
    })
  }

  const handleBuildNow = async () => {
    if (quantity == null) return
    try {
      const outcome = await build.mutateAsync({
        partId,
        quantity,
        ...(notes ? { notes } : {}),
      })
      await refresh()
      onDone()

      // 🛑 `buildNow` is not atomic, and this arm is why the failure comes back
      // at a 200 rather than as an error. The run EXISTS and is `in_progress`
      // with no movements written; saying only "failed" is what makes somebody
      // press the button again and raise a duplicate against the same
      // components. So the toast names it and the drawer opens on it.
      if (outcome.status === 'left_in_progress') {
        toastError({
          title: `${outcome.build.number ?? 'The build'} was raised but not completed`,
          description: outcome.reason,
        })
        openRecord?.(outcome.build.recordId as RecordId)
      }
    } catch {
      // onError above already surfaced the toast — this arm wrote nothing.
    }
  }

  const money = (value: number) => formatCurrency(value, { currencyCode })

  return (
    <>
      <FieldPanel className='p-0' orientation='horizontal' defaultLabelWidth={112}>
        <FieldPanelRow
          title='Quantity'
          type={BaseType.NUMBER}
          showIcon
          isRequired
          description='Good units this run produces'>
          <FieldInputAdapter
            fieldType={FieldType.NUMBER}
            value={quantity}
            onChange={(val) => setQuantity((val as number) ?? null)}
            placeholder='1'
            disabled={isPending}
          />
        </FieldPanelRow>

        <FieldPanelRow title='Notes' type={BaseType.STRING} showIcon>
          <FieldInputAdapter
            fieldType={FieldType.TEXT}
            value={notes}
            onChange={(val) => setNotes((val as string) ?? '')}
            placeholder='e.g. Bench run'
            disabled={isPending}
          />
        </FieldPanelRow>
      </FieldPanel>

      {preview.isPending && previewQuantity > 0 ? (
        <div className='space-y-2'>
          <Skeleton className='h-4 w-full' />
          <Skeleton className='h-4 w-full' />
          <Skeleton className='h-4 w-2/3' />
        </div>
      ) : plan ? (
        <div className='space-y-2'>
          {/* No scroller of its own. The pane this form is mounted in scrolls
              as a whole (`part-stock-actions.tsx`), and nesting a second one
              gives two scrollbars and a list you have to scroll TO before you
              can scroll IT. */}
          <div className='divide-y divide-border/50 text-xs tabular-nums'>
            {plan.components.map((line) => {
              const resulting = resultingByPart?.[line.partId]
              return (
                <div key={line.partId} className='flex items-center gap-2 py-1'>
                  <span className='flex-1 truncate'>{line.partName ?? line.partId}</span>
                  {resulting != null && (
                    <Badge variant={resulting < 0 ? 'red' : 'green'} size='xs' className='shrink-0'>
                      {formatQuantity(resulting)}
                    </Badge>
                  )}
                  <span className='shrink-0 text-muted-foreground'>
                    {formatQuantity(line.quantityConsumed)}
                    {line.unitCost != null && ` × ${money(line.unitCost)}`}
                  </span>
                  <span className='w-16 shrink-0 text-end'>
                    {line.extendedCost != null ? money(line.extendedCost) : '—'}
                  </span>
                </div>
              )
            })}
          </div>

          {plan.missingStandardPartIds.length > 0 && (
            <div className='rounded-md bg-destructive/10 p-2 text-destructive text-xs'>
              <p className='font-medium'>
                These parts have no standard cost, so this run cannot be completed:
              </p>
              <ul className='mt-1 space-y-0.5'>
                {plan.missingStandardPartIds.map((id) => (
                  <li key={id} className='truncate'>
                    {nameFor(plan.components, id) ?? (id === partId ? 'This part' : id)}
                  </li>
                ))}
              </ul>
              <p className='mt-1'>
                Roll the standard cost from the part&apos;s Costing card first. A build is never
                posted at zero cost.
              </p>
            </div>
          )}

          {summary && (
            <div className='space-y-1 rounded-md border p-2 text-xs tabular-nums'>
              <SummaryLine label='Material' value={money(summary.materialCost)} />
              <SummaryLine label='Labour' value={money(summary.laborCost)} />
              <SummaryLine label='Overhead' value={money(summary.overheadCost)} />
              <SummaryLine
                label='Produced value'
                value={money(summary.producedValue)}
                className='border-border/50 border-t pt-1'
              />
              <SummaryLine
                label='Variance → 5090'
                value={`${summary.varianceAmount > 0 ? '+' : ''}${money(summary.varianceAmount)}`}
                className='border-border/50 border-t pt-1 font-medium'
              />
            </div>
          )}
        </div>
      ) : null}

      <div className='flex flex-wrap justify-end gap-2'>
        <Button variant='ghost' size='xs' onClick={onDone} disabled={isPending}>
          Cancel
        </Button>
        <Button
          variant='ghost'
          size='xs'
          onClick={handlePlanAndOpen}
          disabled={!canSubmit}
          title='Raise the run and open the full completion form'>
          Plan and open…
        </Button>
        <Button
          variant='ghost'
          size='xs'
          onClick={handlePlan}
          loading={createBuild.isPending}
          loadingText='Planning...'
          disabled={!canSubmit}>
          Plan
        </Button>
        {canPostLedger && (
          <Button
            variant='outline'
            size='xs'
            onClick={handleBuildNow}
            loading={build.isPending}
            loadingText='Building...'
            disabled={!canSubmit}>
            Build now
          </Button>
        )}
      </div>
    </>
  )
}

/**
 * The quantity the preview is allowed to ask for.
 *
 * Debounced so a three-digit quantity is one request rather than three, and
 * floored at zero so a cleared input does not fire a query the server would
 * refuse — `quantityProduced` is `.positive()` on the procedure.
 */
function useDebouncedPositive(value: number | null, delayMs: number): number {
  const [settled, setSettled] = useState(() => (value != null && value > 0 ? value : 0))

  useEffect(() => {
    const next = value != null && value > 0 ? value : 0
    const timer = setTimeout(() => setSettled(next), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return settled
}

/** The name of an unpriced part, from the plan line that already carries it. */
function nameFor(
  components: readonly { partId: string; partName: string | null }[],
  partId: string
): string | null {
  return components.find((line) => line.partId === partId)?.partName ?? null
}

function SummaryLine({
  label,
  value,
  className,
}: {
  label: string
  value: string
  className?: string
}) {
  return (
    <div className={`flex items-baseline justify-between gap-2 ${className ?? ''}`}>
      <span className='text-muted-foreground'>{label}</span>
      <span>{value}</span>
    </div>
  )
}

/** Trim a quantity's trailing zeros — `10` not `10.00`, `2.5` kept. */
function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)))
}
