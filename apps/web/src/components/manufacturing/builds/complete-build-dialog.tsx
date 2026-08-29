// apps/web/src/components/manufacturing/builds/complete-build-dialog.tsx
'use client'

// The completion form (plans/products/build/01-build-plan.md §3.6) — the run's
// only irreversible action, and the reason this whole phase is UI rather than a
// procedure somebody calls.
//
// 🛑 **This is never a save.** `completeBuild` writes one `build_consume` per
// component and one `build_produce`, all onto `updatable: false` rows, and the
// only correction is a second build that negates them (B6). It also refuses a
// second attempt outright — one completion per build (B8), so a run finished in
// tranches is a different build, not a second press of this button. So the form
// shows what it will write, at what cost, and what the variance will be, and it
// says all three before the button is reachable.
//
// ## The three things it carries that a report would not
//
// 1. **Per-component quantity overrides.** The floor does not always follow the
//    bill of materials. An untouched line is derived server-side from the BOM at
//    the current produced/scrapped quantities and moves when they move; a line
//    somebody typed is an absolute quantity for the WHOLE run and stays put.
//    Zero is a legal answer — the line is dropped, not written at zero.
// 2. **Off-BOM additions.** A part that is not on the bill of materials at all
//    can be added, and its movement carries `stock_movement_qty_per_unit = NULL`
//    — the documented marker for a floor substitution, so the usage cross-check
//    can see it later instead of it being silent. The rows say so on screen too.
// 3. **Scrap, priced.** B7: scrapped units consume material and produce no
//    movement. Their whole standard cost falls out in `varianceAmount` and lands
//    in account 5090. A person typing `2` into Scrapped is booking a variance,
//    and the form says so at the input AND under the number.
//
// ## Why the numbers here are the numbers that get stored
//
// `builds.previewCompletion` runs the SAME `explodeBuildComponents` the write
// runs, over the same overrides, and re-runs on every edit. The five cost
// figures come from `summarizeBuildCompletion` in `@auxx/lib/builds/client`,
// which is literally the function `completeBuild` calls. There is no second
// implementation of the variance to drift.

import { FieldType } from '@auxx/database/enums'
import { absorbedRunCost, summarizeBuildCompletion } from '@auxx/lib/builds/client'
import { getInstanceId, type RecordId } from '@auxx/lib/resources/client'
import type { RelationshipConfig } from '@auxx/types/custom-field'
import { toResourceFieldId } from '@auxx/types/field'
import { Badge } from '@auxx/ui/components/badge'
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
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { formatCurrency } from '@auxx/utils/currency'
import { keepPreviousData } from '@tanstack/react-query'
import { RotateCcw, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { toRecordId, useResourceProperty } from '~/components/resources'
import { BaseType } from '~/components/workflow/types'
import { useDebounce } from '~/hooks/use-debounced-value'
import { useSettings } from '~/hooks/use-settings'
import { api } from '~/trpc/react'
import {
  buildComponentOverrides,
  type ComponentRow,
  type KnownComponent,
  mergeComponentRows,
  rememberComponents,
} from './completion-input'

/** Synthetic relationship config for the ad-hoc off-BOM part picker (no backing field). */
const OFF_BOM_PART_RELATIONSHIP: RelationshipConfig = {
  inverseResourceFieldId: toResourceFieldId('part', 'id'),
  relationshipType: 'belongs_to',
  isInverse: false,
}

/**
 * How long a typed quantity is held back before it becomes a preview request.
 *
 * Typing `120` is three keystrokes, and without this it is three explosions of
 * the whole bill of materials. Only what feeds the query waits — the inputs
 * themselves stay instant, so nothing on screen lags behind the keyboard.
 */
const PREVIEW_DEBOUNCE_MS = 250

interface CompleteBuildDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** `EntityInstance.id` of the build being completed. */
  buildId: string
  /** `EntityInstance.id` of the part it produces. Drives the component explosion. */
  partId: string
  /** Prefills "Produced" — most runs make what they planned to make. */
  quantityPlanned: number | null
  /** `B-0001`, or null on a build raised before the numbering hook. */
  number: string | null
  onCompleted?: () => void
}

export function CompleteBuildDialog({
  open,
  onOpenChange,
  buildId,
  partId,
  quantityPlanned,
  number,
  onCompleted,
}: CompleteBuildDialogProps) {
  const [quantityProduced, setQuantityProduced] = useState<number | null>(null)
  const [quantityScrapped, setQuantityScrapped] = useState<number>(0)
  const [overrides, setOverrides] = useState<Record<string, number>>({})
  // Every component the form has ever seen for this run — see `rememberComponents`.
  const [known, setKnown] = useState<readonly KnownComponent[]>([])
  // `null` means "take the org rate"; a number is what this run actually absorbed.
  const [laborCost, setLaborCost] = useState<number | null>(null)
  const [overheadCost, setOverheadCost] = useState<number | null>(null)
  const [completedAt, setCompletedAt] = useState<string>(() => new Date().toISOString())
  const [notes, setNotes] = useState('')

  const partDefId = useResourceProperty('part', 'id')
  const { getSetting } = useSettings({})
  const currencyCode = (getSetting('organization.currency') as string | null) ?? 'USD'

  // A fresh form on every open. A stale completion date left over from a dialog
  // somebody abandoned yesterday would silently backdate the whole ledger, and
  // stale overrides would apply one run's substitutions to the next.
  useEffect(() => {
    if (!open) return
    setQuantityProduced(quantityPlanned ?? null)
    setQuantityScrapped(0)
    setOverrides({})
    setKnown([])
    setLaborCost(null)
    setOverheadCost(null)
    setCompletedAt(new Date().toISOString())
    setNotes('')
  }, [open, quantityPlanned])

  const produced = quantityProduced ?? 0
  const scrapped = quantityScrapped ?? 0
  const componentOverrides = useMemo(() => buildComponentOverrides(overrides), [overrides])

  // What the preview is actually asked about. Held back so `1` -> `12` -> `120`
  // is one explosion rather than three; the inputs above render the untouched
  // state, so the keyboard never waits on the network.
  const previewProduced = useDebounce(produced, PREVIEW_DEBOUNCE_MS)
  const previewScrapped = useDebounce(scrapped, PREVIEW_DEBOUNCE_MS)
  const previewOverrides = useDebounce(componentOverrides, PREVIEW_DEBOUNCE_MS)

  // The preview IS the form. It re-runs on every quantity and every override, so
  // what is on screen is always what the write would freeze.
  //
  // 🛑 `keepPreviousData` is load-bearing, not polish. Without it every keystroke
  // changes the query key, `data` goes undefined, and the summary, the absorbed
  // amounts, the unpriced warning and the submit button all blank together —
  // which reads as "the numbers just went away" on the one form in this
  // subsystem whose write cannot be undone.
  const preview = api.builds.previewCompletion.useQuery(
    {
      partId,
      quantityProduced: previewProduced,
      quantityScrapped: previewScrapped,
      componentOverrides: previewOverrides,
    },
    {
      enabled: open && previewProduced > 0,
      retry: false,
      refetchOnWindowFocus: false,
      placeholderData: keepPreviousData,
    }
  )

  const plan = preview.data?.plan
  const rates = preview.data?.rates

  /**
   * The numbers on screen do not yet answer the quantities in the inputs.
   *
   * True through the debounce window as well as the request, so the summary dims
   * from the first keystroke instead of a beat later, and so the submit button
   * can refuse a run whose figures nobody has actually seen.
   */
  const previewStale =
    preview.isFetching ||
    previewProduced !== produced ||
    previewScrapped !== scrapped ||
    previewOverrides !== componentOverrides

  // Accumulate rather than replace: a line overridden to zero is not in the
  // plan's `components`, and dropping it from the row list would take the input
  // that produced it off screen.
  useEffect(() => {
    if (!plan) return
    setKnown((current) => rememberComponents(current, plan.components))
  }, [plan])

  const rows = useMemo(
    () => mergeComponentRows(known, plan?.components ?? [], overrides),
    [known, plan, overrides]
  )

  // The five numbers, from the same function the server runs. `producedUnitCost`
  // is null until the produced part has a standard, and there is deliberately no
  // fallback: a completion at zero cost is what this whole subsystem exists to
  // prevent, so the summary shows nothing rather than a confident zero.
  //
  // Built from the quantities the PLAN was exploded at, not the ones in the
  // inputs: pairing a fresh `quantityProduced` with a stale component list would
  // print a variance that no single state of the form ever produced.
  const summary = useMemo(() => {
    if (!plan || plan.producedUnitCost == null || !rates) return null
    return summarizeBuildCompletion({
      components: plan.components,
      producedUnitCost: plan.producedUnitCost,
      quantityProduced: previewProduced,
      quantityScrapped: previewScrapped,
      laborCost,
      overheadCost,
      rates,
    })
  }, [plan, rates, previewProduced, previewScrapped, laborCost, overheadCost])

  // The org-rate prefill for the two absorption inputs, derived from `rates`
  // rather than from `summary` so it survives a refetch: `summary` is null
  // whenever the produced part has no standard, and chaining the displayed
  // default off it is what emptied both inputs on every keystroke.
  //
  // 🛑 An UNDECLARED rate shows nothing, not `$0.00`. `absorbedRunCost` answers
  // `0` for a null rate on purpose (a run under no rate absorbed nothing), but a
  // confident zero in the input would tell somebody the rates are set when they
  // are not — the same distinction `absorptionHint` makes just below.
  const startedNow = produced + scrapped
  const laborDefault =
    rates?.laborCostPerUnit == null
      ? null
      : absorbedRunCost(null, rates.laborCostPerUnit, startedNow)
  const overheadDefault =
    rates?.overheadCostPerUnit == null
      ? null
      : absorbedRunCost(null, rates.overheadCostPerUnit, startedNow)

  const utils = api.useUtils()
  const buildDefId = useResourceProperty('build', 'id')

  const completeBuild = api.builds.complete.useMutation({
    onError: (error) =>
      toastError({ title: 'Failed to complete build', description: error.message }),
  })

  const handleComplete = async () => {
    if (!summary || produced <= 0) return
    try {
      await completeBuild.mutateAsync({
        buildId,
        quantityProduced: produced,
        quantityScrapped: scrapped,
        componentOverrides,
        laborCost: laborCost ?? undefined,
        overheadCost: overheadCost ?? undefined,
        completedAt: new Date(completedAt),
        notes: notes || undefined,
      })
      // `completeBuild` publishes its own field-value frame for the build row, so
      // OTHER tabs repaint on their own. The acting tab is excluded from its own
      // realtime events, and the movements were written on the quiet lane and
      // announce nothing anywhere — so the ledger card's list has to be told.
      await Promise.all([
        utils.builds.get.invalidate({ buildId }),
        utils.builds.list.invalidate(),
        buildDefId
          ? utils.record.listFiltered.invalidate({ entityDefinitionId: buildDefId })
          : Promise.resolve(),
      ])
      onCompleted?.()
      onOpenChange(false)
    } catch {
      // onError above already surfaced the toast.
    }
  }

  const unpriced = plan?.missingStandardPartIds ?? []
  const blocked = unpriced.length > 0 || rows.every((row) => row.dropped)
  // 🛑 `!previewStale` is part of the gate, not a spinner nicety. The button
  // posts the quantities in the INPUTS, so accepting a press while the summary
  // still answers the previous ones would freeze an irreversible ledger entry
  // whose variance nobody was ever shown.
  const canSubmit =
    !!summary && produced > 0 && !blocked && !previewStale && !completeBuild.isPending

  const writtenRows = rows.filter((row) => !row.dropped).length

  return (
    <Dialog open={open} onOpenChange={(next) => !completeBuild.isPending && onOpenChange(next)}>
      <DialogContent size='xl'>
        <DialogHeader>
          <DialogTitle>Complete {number ?? 'build'}</DialogTitle>
          <DialogDescription>
            Consumes the components and puts the finished units into stock at their standard cost. A
            completed build is never edited or deleted (it is corrected by a reversing build).
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className='max-h-[60vh]' allowScrollChaining>
          <div className='space-y-4 pe-2'>
            <FieldPanel className='p-0' breakpoint='md' resizeId='complete-build'>
              <FieldPanelRow
                title='Produced'
                type={BaseType.NUMBER}
                showIcon
                isRequired
                description='Good units that enter stock'>
                <FieldInputAdapter
                  fieldType={FieldType.NUMBER}
                  value={quantityProduced}
                  onChange={(val) => setQuantityProduced((val as number) ?? null)}
                  placeholder='0'
                  disabled={completeBuild.isPending}
                />
              </FieldPanelRow>

              <FieldPanelRow
                title='Scrapped'
                type={BaseType.NUMBER}
                showIcon
                description='Started and lost'>
                <FieldInputAdapter
                  fieldType={FieldType.NUMBER}
                  value={quantityScrapped}
                  onChange={(val) => setQuantityScrapped((val as number) ?? 0)}
                  placeholder='0'
                  disabled={completeBuild.isPending}
                />
                {/* B7, said where the number is typed rather than only in a
                    footnote: scrap is not free, and somebody entering 2 here is
                    booking a variance, not recording a rounding detail. */}
                {scrapped > 0 && (
                  <p className='mt-1 flex items-start gap-1.5 text-amber-600 text-xs dark:text-amber-500'>
                    <TriangleAlert className='mt-0.5 size-3 shrink-0' />
                    <span>
                      These {formatQuantity(scrapped)} units still consume components and produce no
                      stock. Their whole cost is booked as a variance to account 5090.
                    </span>
                  </p>
                )}
              </FieldPanelRow>

              <FieldPanelRow
                title='Completed on'
                type={BaseType.DATE}
                showIcon
                isRequired
                description='The accounting date, which is not when it was keyed'>
                <FieldInputAdapter
                  fieldType={FieldType.DATETIME}
                  value={completedAt}
                  onChange={(val) => setCompletedAt((val as string) ?? new Date().toISOString())}
                  disabled={completeBuild.isPending}
                />
              </FieldPanelRow>

              <FieldPanelRow
                title='Labour'
                type={BaseType.CURRENCY}
                showIcon
                description={absorptionHint(rates?.laborCostPerUnit, currencyCode)}
                onClear={laborCost == null ? undefined : () => setLaborCost(null)}>
                <FieldInputAdapter
                  fieldType={FieldType.CURRENCY}
                  fieldOptions={{ currencyCode, decimals: 2, useGrouping: true }}
                  value={laborCost ?? laborDefault}
                  onChange={(val) => setLaborCost((val as number) ?? null)}
                  disabled={completeBuild.isPending}
                />
                <AbsorptionOrigin
                  explicit={laborCost}
                  rate={rates?.laborCostPerUnit}
                  started={startedNow}
                  currencyCode={currencyCode}
                />
              </FieldPanelRow>

              <FieldPanelRow
                title='Overhead'
                type={BaseType.CURRENCY}
                showIcon
                description={absorptionHint(rates?.overheadCostPerUnit, currencyCode)}
                onClear={overheadCost == null ? undefined : () => setOverheadCost(null)}>
                <FieldInputAdapter
                  fieldType={FieldType.CURRENCY}
                  fieldOptions={{ currencyCode, decimals: 2, useGrouping: true }}
                  value={overheadCost ?? overheadDefault}
                  onChange={(val) => setOverheadCost((val as number) ?? null)}
                  disabled={completeBuild.isPending}
                />
                <AbsorptionOrigin
                  explicit={overheadCost}
                  rate={rates?.overheadCostPerUnit}
                  started={startedNow}
                  currencyCode={currencyCode}
                />
              </FieldPanelRow>

              <FieldPanelRow title='Notes' type={BaseType.STRING} showIcon>
                <FieldInputAdapter
                  fieldType={FieldType.TEXT}
                  value={notes}
                  onChange={(val) => setNotes((val as string) ?? '')}
                  placeholder='e.g. Substituted the 12V motor, none in stock'
                  disabled={completeBuild.isPending}
                />
              </FieldPanelRow>
            </FieldPanel>

            <ComponentsSection
              rows={rows}
              hasPlan={!!plan}
              loading={preview.isPending && produced > 0}
              error={preview.error?.message ?? null}
              currencyCode={currencyCode}
              disabled={completeBuild.isPending}
              unitsStarted={previewProduced + previewScrapped}
              onOverride={(rowPartId, quantity) =>
                setOverrides((current) => ({ ...current, [rowPartId]: quantity }))
              }
              onResetOverride={(rowPartId) =>
                setOverrides((current) => {
                  const next = { ...current }
                  delete next[rowPartId]
                  return next
                })
              }
              onAddOffBom={(rowPartId) =>
                setOverrides((current) =>
                  // Seed at one unit per started unit — a substitution usually
                  // stands in for something, so zero would be a worse guess than
                  // one and would drop the line the person just added.
                  rowPartId in current
                    ? current
                    : { ...current, [rowPartId]: Math.max(1, produced + scrapped) }
                )
              }
              partDefId={partDefId}
              knownPartIds={rows.map((row) => row.partId)}
            />

            {unpriced.length > 0 && (
              <UnpricedWarning partIds={unpriced} rows={rows} producedPartId={partId} />
            )}

            {/* Dimmed while the figures are catching up, never unmounted: a
                block that disappears reads as "there is no answer", and a person
                looking at an irreversible variance should see the previous
                answer greying out rather than the space it used to occupy. */}
            {summary && (
              <div
                className={previewStale ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
                <CostSummary
                  summary={summary}
                  currencyCode={currencyCode}
                  quantityProduced={previewProduced}
                  quantityScrapped={previewScrapped}
                  producedUnitCost={plan?.producedUnitCost ?? null}
                />
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Said once, plainly, immediately above the button: what will be written
            and that it cannot be taken back by editing. */}
        {canSubmit && (
          <p className='text-muted-foreground text-xs'>
            Writes {writtenRows} consume {writtenRows === 1 ? 'movement' : 'movements'} and 1
            produce movement, dated {new Date(completedAt).toLocaleDateString()}. This build cannot
            be completed a second time.
          </p>
        )}

        <DialogFooter>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => onOpenChange(false)}
            disabled={completeBuild.isPending}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            variant='outline'
            size='sm'
            onClick={handleComplete}
            loading={completeBuild.isPending}
            loadingText='Posting...'
            disabled={!canSubmit}
            data-dialog-submit>
            Complete and post <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Components ────────────────────────────────────────────────────────

interface ComponentsSectionProps {
  rows: ComponentRow[]
  /** The explosion has arrived. Until it has there is nothing honest to render. */
  hasPlan: boolean
  loading: boolean
  error: string | null
  currencyCode: string
  disabled: boolean
  unitsStarted: number
  onOverride: (partId: string, quantity: number) => void
  onResetOverride: (partId: string) => void
  onAddOffBom: (partId: string) => void
  partDefId: string | undefined
  knownPartIds: string[]
}

/**
 * The per-component override table, and the off-BOM picker beneath it.
 *
 * Quantities are for the WHOLE run, not per unit — that is what the header says
 * and what the server stores. Per-unit would have to be re-derived every time
 * "produced" moved, and the floor counts what it pulled from the shelf, not what
 * it pulled per unit.
 */
function ComponentsSection({
  rows,
  hasPlan,
  loading,
  error,
  currencyCode,
  disabled,
  unitsStarted,
  onOverride,
  onResetOverride,
  onAddOffBom,
  partDefId,
  knownPartIds,
}: ComponentsSectionProps) {
  if (error) {
    return <p className='rounded-md bg-destructive/10 p-2 text-destructive text-xs'>{error}</p>
  }

  if (loading && rows.length === 0) {
    return (
      <div className='space-y-2'>
        <Skeleton className='h-6 w-full' />
        <Skeleton className='h-6 w-full' />
        <Skeleton className='h-6 w-full' />
      </div>
    )
  }

  if (!hasPlan) return null

  return (
    <div className='space-y-2'>
      <div className='flex items-baseline justify-between gap-2'>
        <h4 className='font-semibold text-sm'>Components consumed</h4>
        <span className='text-muted-foreground text-xs'>
          for {formatQuantity(unitsStarted)} units started
        </span>
      </div>

      <div className='divide-y divide-border/50 rounded-md border'>
        {rows.map((row) => (
          <ComponentRowInput
            key={row.partId}
            row={row}
            currencyCode={currencyCode}
            disabled={disabled}
            onOverride={onOverride}
            onResetOverride={onResetOverride}
          />
        ))}
        {rows.length === 0 && (
          <p className='px-3 py-2 text-muted-foreground text-xs'>
            This part has no bill of materials, so there is nothing to consume.
          </p>
        )}
      </div>

      <div className='flex items-center gap-2'>
        <span className='shrink-0 text-muted-foreground text-xs'>Add off-BOM part</span>
        <div className='flex-1'>
          <FieldInputAdapter
            fieldType={FieldType.RELATIONSHIP}
            value={[]}
            onChange={(value) => {
              const first = (value as RecordId[])[0]
              if (first) onAddOffBom(getInstanceId(first))
            }}
            triggerProps={{ className: 'w-full' }}
            placeholder='Search parts...'
            disabled={disabled || !partDefId}
            fieldOptions={{
              relationship: OFF_BOM_PART_RELATIONSHIP,
              excludeIds: partDefId
                ? knownPartIds.map((id) => toRecordId(partDefId, id))
                : undefined,
              showDefinitionIcon: true,
              showSecondary: true,
            }}
          />
        </div>
      </div>
      <p className='text-muted-foreground text-xs'>
        A part that is not on the bill of materials is recorded as a substitution — its movement
        carries no per-unit quantity, so the swap stays visible instead of looking like the recipe.
      </p>
    </div>
  )
}

/** One component line: what it is, how much of it, and what that costs. */
function ComponentRowInput({
  row,
  currencyCode,
  disabled,
  onOverride,
  onResetOverride,
}: {
  row: ComponentRow
  currencyCode: string
  disabled: boolean
  onOverride: (partId: string, quantity: number) => void
  onResetOverride: (partId: string) => void
}) {
  return (
    <div className='flex items-center gap-2 px-3 py-2'>
      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-1.5'>
          <span className='truncate text-sm'>{row.partName ?? row.partId}</span>
          {/* The off-BOM marker, said in the UI exactly as it is stored: this
              line carries no `qtyPerUnit`, which is what makes it findable later
              as a substitution rather than as part of the recipe. */}
          {row.offBom && (
            <Badge variant='amber' size='xs'>
              Off BOM
            </Badge>
          )}
          {row.dropped && (
            <Badge variant='secondary' size='xs'>
              Not used
            </Badge>
          )}
        </div>
        <span className='text-muted-foreground text-xs tabular-nums'>
          {row.qtyPerUnit == null ? 'substitution' : `${formatQuantity(row.qtyPerUnit)} per unit`}
          {row.unitCost != null && ` · ${formatCurrency(row.unitCost, { currencyCode })} each`}
        </span>
      </div>

      <div className='w-24 shrink-0'>
        <FieldInputAdapter
          fieldType={FieldType.NUMBER}
          value={row.quantityConsumed}
          onChange={(val) => onOverride(row.partId, (val as number) ?? 0)}
          placeholder='0'
          disabled={disabled}
        />
      </div>

      <div className='w-24 shrink-0 text-right text-sm tabular-nums'>
        {row.extendedCost == null ? (
          <span className='text-destructive text-xs'>no standard</span>
        ) : (
          formatCurrency(row.extendedCost, { currencyCode })
        )}
      </div>

      {/* Only for a line somebody typed — going back to the bill of materials is
          otherwise not an available idea, and a reset on an untouched line would
          suggest the BOM quantity is itself an override. */}
      <Button
        variant='ghost'
        size='xs'
        title='Use the bill of materials quantity'
        className={row.overridden && !row.offBom ? undefined : 'invisible'}
        disabled={disabled || !row.overridden || row.offBom}
        onClick={() => onResetOverride(row.partId)}>
        <RotateCcw />
      </Button>
    </div>
  )
}

/**
 * Where the amount in an absorption input came from.
 *
 * The input holds `null` while it is showing the org rate's arithmetic, and
 * `null` is what gets SENT — the server owns the multiplication. So the number
 * on screen would otherwise be unattributable: a person cannot tell a prefilled
 * figure from one somebody typed, and the difference decides whether editing the
 * rate later changes anything. This line says which it is.
 */
function AbsorptionOrigin({
  explicit,
  rate,
  started,
  currencyCode,
}: {
  explicit: number | null
  rate: number | null | undefined
  started: number
  currencyCode: string
}) {
  if (explicit != null) {
    return <p className='mt-1 text-muted-foreground text-xs'>Entered for this run.</p>
  }
  if (rate == null) return null
  return (
    <p className='mt-1 text-muted-foreground text-xs tabular-nums'>
      {formatCurrency(rate, { currencyCode })} × {formatQuantity(started)} units started (org rate)
    </p>
  )
}

/**
 * The parts that block the write.
 *
 * `completeBuild` refuses rather than posting these at zero: a zero-cost consume
 * row understates COGS, drags every downstream average toward zero, and is
 * frozen onto an `updatable: false` row forever. Naming them here is what makes
 * that refusal actionable instead of a wall.
 */
function UnpricedWarning({
  partIds,
  rows,
  producedPartId,
}: {
  partIds: string[]
  rows: ComponentRow[]
  producedPartId: string
}) {
  // The produced part is never one of the component rows, so it has no name to
  // look up here — naming it by its role is more use than printing its id.
  const nameFor = (id: string) => {
    if (id === producedPartId) return 'the finished part this build produces'
    return rows.find((row) => row.partId === id)?.partName ?? id
  }
  return (
    <div className='rounded-md bg-destructive/10 p-2 text-destructive text-xs'>
      <p className='font-medium'>Cannot post: these parts have no standard cost:</p>
      <ul className='mt-1 space-y-0.5'>
        {partIds.map((id) => (
          <li key={id} className='truncate'>
            {nameFor(id)}
          </li>
        ))}
      </ul>
      <p className='mt-1'>
        Roll the standard cost from the part&apos;s Costing card first. A build is never posted at
        zero cost.
      </p>
    </div>
  )
}

/**
 * The five numbers, with the arithmetic that produced them spelled out.
 *
 * The variance is the one a person actually reads on a build, and it is the last
 * line for that reason. With no scrap and a standard that agrees with the bill
 * of materials it comes out at zero exactly; anything else is the run telling
 * you something.
 */
function CostSummary({
  summary,
  currencyCode,
  quantityProduced,
  quantityScrapped,
  producedUnitCost,
}: {
  summary: {
    materialCost: number
    laborCost: number
    overheadCost: number
    producedValue: number
    varianceAmount: number
  }
  currencyCode: string
  quantityProduced: number
  quantityScrapped: number
  producedUnitCost: number | null
}) {
  const money = (value: number) => formatCurrency(value, { currencyCode })

  return (
    <div className='space-y-1 rounded-md border p-3 text-xs tabular-nums'>
      <SummaryLine label='Material' value={money(summary.materialCost)} />
      <SummaryLine label='Labour' value={money(summary.laborCost)} />
      <SummaryLine label='Overhead' value={money(summary.overheadCost)} />
      <SummaryLine
        label='Produced value'
        hint={
          producedUnitCost == null
            ? undefined
            : `${formatQuantity(quantityProduced)} × ${money(producedUnitCost)}`
        }
        value={money(summary.producedValue)}
        className='border-border/50 border-t pt-1'
      />
      <SummaryLine
        label='Variance → 5090'
        value={`${summary.varianceAmount > 0 ? '+' : ''}${money(summary.varianceAmount)}`}
        className='border-border/50 border-t pt-1 font-medium'
      />
      {quantityScrapped > 0 && (
        <p className='text-muted-foreground'>
          Includes the whole standard cost of {formatQuantity(quantityScrapped)} scrapped{' '}
          {quantityScrapped === 1 ? 'unit' : 'units'}, which is not absorbed into the units that
          survived.
        </p>
      )}
    </div>
  )
}

function SummaryLine({
  label,
  hint,
  value,
  className,
}: {
  label: string
  hint?: string
  value: string
  className?: string
}) {
  return (
    <div className={`flex items-baseline justify-between gap-2 ${className ?? ''}`}>
      <span className='text-muted-foreground'>
        {label}
        {hint && <span className='ms-1 text-[10px]'>{hint}</span>}
      </span>
      <span>{value}</span>
    </div>
  )
}

// ─── Helpers ───────────────────────────────────────────────────────────

/**
 * What the field's placeholder says about where the default comes from.
 *
 * 🛑 A NULL rate absorbs zero on a completion, and the hint says "none declared"
 * rather than "$0.00" — the two are numerically identical here but they are
 * different claims, and a person who sees a confident zero has no reason to go
 * and set the rate.
 */
function absorptionHint(rate: number | null | undefined, currencyCode: string): string {
  if (rate == null) return 'No rate declared: absorbs nothing unless you enter an amount'
  return `${formatCurrency(rate, { currencyCode })} per unit started`
}

/** Trim a quantity's trailing zeros — `10` not `10.00`, `2.5` kept. */
function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)))
}
