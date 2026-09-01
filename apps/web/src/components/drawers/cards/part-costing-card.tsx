// apps/web/src/components/drawers/cards/part-costing-card.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { absorbsConversionCost, resolvePartKind, standardCostDrift } from '@auxx/lib/builds/client'
import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { CostSource, parseRecordId } from '@auxx/lib/resources/client'
import type { ResourceFieldId } from '@auxx/types/field'
import { Badge, type Variant } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { formatCurrency } from '@auxx/utils/currency'
import Link from 'next/link'
import { useCallback, useMemo } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { Tooltip } from '~/components/global/tooltip'
import { RollStandardCostPopover } from '~/components/manufacturing/parts/roll-standard-cost-popover'
import { useRecordList, useResourceProperty } from '~/components/resources'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { useResourceStore } from '~/components/resources/store/resource-store'
import { resolveSystemAttributeForRecord } from '~/components/resources/utils/resolve-system-attribute'
import { useSettings } from '~/hooks/use-settings'
import { useAccess } from '~/providers/capabilities-provider'
import type { DrawerTabProps } from '../drawer-tab-registry'

/**
 * The three provenance fields migration 100 added under `part_cost`, plus the
 * cost itself — and the frozen standard migration 109 added beside it.
 *
 * All six are computed; this card is read-only and the roll is the only writer
 * of the standard. The five `part_standard_*` fields are declared
 * `showInPanel: false` / `showInDialogs: false` precisely so they surface HERE
 * rather than burying the part's Details panel under five uneditable cost rows
 * (plans/products/build/01-build-plan.md §1.6, §2.5).
 */
const PART_COSTING_ATTRIBUTES = [
  'part_cost',
  'part_purchase_cost',
  'part_rollup_cost',
  'part_cost_source',
  'part_standard_cost',
  'part_standard_material_cost',
  'part_standard_labor_cost',
  'part_standard_overhead_cost',
  'part_standard_cost_effective_at',
  'part_kind',
  // The two EDITABLE ones. Also `showInPanel: false`, and for a sharper reason
  // than the frozen block: on a `component` the roll never reads them, and 82%
  // of parts are components. They render here, gated on `part_kind`, so the
  // inputs exist exactly where they mean something.
  'part_labor_cost_per_unit',
  'part_overhead_cost_per_unit',
] as const

/** "12 Aug 2026" — the day the current standard took effect. */
function formatEffectiveDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

/** `CostSource.values` keyed by option value, for badge label + color. */
const COST_SOURCE_BY_VALUE = Object.fromEntries(CostSource.values.map((v) => [v.value, v]))

/**
 * The winning number gets this marker: `part_cost` is a copy of whichever of
 * the two candidates `part_cost_source` names, and the badge makes that
 * visible without asking the user to compare digits.
 */
function PartCostBadge({ source }: { source: string }) {
  const meta = COST_SOURCE_BY_VALUE[source]
  return (
    <Tooltip content={`The part's cost carries this value (cost source: ${meta?.label ?? source})`}>
      <Badge variant={(meta?.color ?? 'gray') as Variant} size='xs'>
        Part cost
      </Badge>
    </Tooltip>
  )
}

/** A `manufacturing.*` rate off the settings record. Anything non-numeric is unset. */
function readRate(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * One editable absorption override.
 *
 * 🛑 **The empty state IS the feature.** `NULL` and a stored `0` are two
 * different claims — "use the org rate" and "this part absorbs nothing" — and a
 * bare currency input renders them identically. The trailing text is what keeps
 * them apart, and it has three cases, not two:
 *
 * | stored | shows | says |
 * | --- | --- | --- |
 * | `null`, org rate set | empty | `Org default ($20.00)` |
 * | `null`, org rate UNSET | empty | `No absorption declared` |
 * | `0` | `$0.00` | `Absorbs nothing` |
 *
 * ⚠️ The middle row is the one that gets missed. `absorbedRate` deliberately
 * keeps an undeclared org rate as `null` rather than collapsing it to zero, so
 * printing `Org default ($0.00)` in an org that has set no rates would state a
 * declared zero nobody declared.
 */
function AbsorptionOverrideRow({
  title,
  value,
  orgRate,
  onChange,
}: {
  title: string
  value: number | null | undefined
  orgRate: number | null
  onChange: (next: unknown) => void
}) {
  const hint =
    value != null
      ? value === 0
        ? 'Absorbs nothing'
        : null
      : orgRate != null
        ? `Org default (${formatCurrency(orgRate)})`
        : 'No absorption declared'

  return (
    <FieldPanelRow title={title} description='Overrides the org rate for this part only'>
      <div className='flex min-h-8 items-center gap-2'>
        <div className='w-32'>
          <FieldInputAdapter
            fieldType={FieldType.CURRENCY}
            fieldOptions={{ currencyCode: 'USD', decimals: 2, currencyDisplay: 'symbol' }}
            value={value ?? null}
            onChange={onChange}
            placeholder='Org default'
          />
        </div>
        {hint && <span className='text-muted-foreground text-xs'>{hint}</span>}
      </div>
    </FieldPanelRow>
  )
}

/**
 * Buy-vs-build and the not-costed signal for the part drawer's overview.
 *
 * Renders nothing unless it has something to say:
 *
 * - **Both `part_purchase_cost` and `part_rollup_cost` present** — the
 *   comparison: both numbers, which one `part_cost` took (the cost-source
 *   badge), and which is cheaper by how much. This is the question the old
 *   single-column model made unaskable — only the winner was ever stored.
 * - **`part_cost_source` is `none`** — the cost is blank and this says WHY:
 *   a part with a bill of materials has unpriced components (the Subparts tab
 *   counts them); a leaf has neither a supplier price nor a bill of materials.
 *
 * A part with exactly one candidate number and a cost is the common case and
 * shows nothing extra — the Details panel already carries `part_cost`.
 *
 * Values come through the same field-value store as every other drawer read
 * (`useSystemValues`); the subpart-presence check reuses the record-list the
 * Inventory card on this same tab already loads (same filter shape, limit 1),
 * so it costs no extra round trip.
 *
 * Registered as the `part:costing` overview card (`drawer-config.ts` +
 * `drawer-tab-registry.tsx`) — `TabCardSection` owns the "Costing" section
 * header and hides it when this renders nothing.
 */
export function PartCostingCard({ recordId }: DrawerTabProps) {
  const { entityInstanceId: partId } = parseRecordId(recordId)

  const { values } = useSystemValues(recordId, PART_COSTING_ATTRIBUTES, { autoFetch: true })
  const purchaseCost = values.part_purchase_cost as number | null | undefined
  const rollupCost = values.part_rollup_cost as number | null | undefined
  const costSource = values.part_cost_source as string | undefined
  const liveCost = values.part_cost as number | null | undefined
  const standardCost = values.part_standard_cost as number | null | undefined
  const standardMaterialCost = values.part_standard_material_cost as number | null | undefined
  const standardLaborCost = values.part_standard_labor_cost as number | null | undefined
  const standardOverheadCost = values.part_standard_overhead_cost as number | null | undefined
  const standardEffectiveAt = values.part_standard_cost_effective_at as string | undefined

  // 🛑 The gate for everything absorption-related on this card. A `component`
  // never absorbs conversion cost (README B11), so on one its overrides are
  // read by nothing and its composition line would say the same number twice.
  const absorbs = absorbsConversionCost(resolvePartKind(values.part_kind as string | undefined))
  const laborOverride = values.part_labor_cost_per_unit as number | null | undefined
  const overheadOverride = values.part_overhead_cost_per_unit as number | null | undefined

  const hasComparison = purchaseCost != null && rollupCost != null
  const isUncosted = costSource === CostSource.NONE
  // Has a cost, has never been rolled. THIS is the state the org-wide roll fixes,
  // and the only one worth pointing at it: a part with no live cost is skipped by
  // that roll too (`no-live-cost`), so sending someone there would be bad advice.
  // The `isUncosted` branch above already tells that part what it actually needs,
  // which is a supplier price or a priced bill of materials.
  const rollWouldValueIt = standardCost == null && liveCost != null
  // The standard block shows as soon as there is anything to say about it,
  // including "not rolled yet", which is the state that needs the action most.
  // A part with NO cost at all is deliberately not in that set: it would add a
  // second amber row saying nothing the "Not costed" row above has not said.
  const hasStandardBlock = standardCost != null || liveCost != null
  // How far the standard has drifted from reality since it was last rolled.
  //
  // 🛑 For a BUILT part the comparison is against `part_standard_material_cost`,
  // not `part_standard_cost`. `part_cost` is a pure material chain
  // (`bom/cost-calculator.ts`) and can never contain conversion cost, so
  // comparing it to a standard that carries the whole absorption stack showed a
  // permanent offset on a freshly rolled part — -$270.00 on a lift whose
  // standard was correct to the cent — under a label that says "how stale".
  // Material against material renders 0 on a fresh roll, which is what the row
  // claims to mean. For a component the two standards are equal, so nothing
  // changes there.
  const driftBasis = absorbs ? standardMaterialCost : standardCost
  const drift = standardCostDrift(liveCost, driftBasis)

  // ── The two editable absorption overrides ──────────────────────────
  //
  // Written through the same `fieldValue.set` door the generic panel uses, so
  // the optimistic store update, the rollback and the realtime publish are the
  // ones every other field write already gets.
  const { canEditEntity } = useAccess()
  // Read from the dehydrated settings the app already carries — no query. The
  // placeholder has to name the rate a blank cell will actually fall through
  // to, or "org default" tells nobody anything.
  const { getSetting } = useSettings({ scope: 'GENERAL' })
  const orgLaborRate = readRate(getSetting('manufacturing.assemblyLaborCostPerUnit'))
  const orgOverheadRate = readRate(getSetting('manufacturing.overheadCostPerUnit'))
  const partDefId = useResourceProperty('part', 'id')
  const canEdit = !!partDefId && canEditEntity(partDefId)
  const { saveFieldValue } = useSaveFieldValue()
  // Selected one at a time, never as an object literal — a selector returning a
  // fresh object re-renders this card on every unrelated store write.
  const systemAttributeMap = useResourceStore((state) => state.systemAttributeMap)
  const systemAttributeByDef = useResourceStore((state) => state.systemAttributeByDef)
  const ambiguousSystemAttributes = useResourceStore((state) => state.ambiguousSystemAttributes)
  const attributeMaps = useMemo(
    () => ({ systemAttributeMap, systemAttributeByDef, ambiguousSystemAttributes }),
    [systemAttributeMap, systemAttributeByDef, ambiguousSystemAttributes]
  )

  const saveOverride = useCallback(
    (attribute: 'part_labor_cost_per_unit' | 'part_overhead_cost_per_unit', value: unknown) => {
      const fieldId = resolveSystemAttributeForRecord(attributeMaps, attribute, recordId)
      if (!fieldId) return
      // 🛑 An empty input writes `null`, which CLEARS the cell and returns the
      // part to the org rate. A typed `0` writes `0`, which is the different
      // claim "this part absorbs nothing" — the two must not collapse, so this
      // normalises only the empty string and passes a real 0 straight through.
      const normalized = value === '' || value === undefined ? null : value
      saveFieldValue(recordId, fieldId, normalized, FieldType.CURRENCY)
    },
    [attributeMaps, recordId, saveFieldValue]
  )

  // Whether the part has a bill of materials at all — decides which "why" the
  // uncosted state shows. Same filter shape as PartInventoryCard's hasSubparts
  // check on this tab, so the list read is shared, not repeated.
  const subpartDefId = useResourceProperty('subpart', 'id')
  const subpartFilters: ConditionGroup[] = useMemo(
    () => [
      {
        id: 'parent-filter',
        logicalOperator: 'AND' as const,
        conditions: [
          {
            id: 'parent-match',
            fieldId: 'subpart:parentPart' as ResourceFieldId,
            operator: 'is' as const,
            value: partId,
          },
        ],
      },
    ],
    [partId]
  )
  const { records: subpartRecords, isLoading: isLoadingSubparts } = useRecordList({
    entityDefinitionId: subpartDefId ?? '',
    filters: subpartFilters,
    limit: 1,
    enabled: isUncosted && !!partId && !!subpartDefId,
  })
  const hasSubparts = subpartRecords.length > 0

  if (!hasComparison && !isUncosted && !hasStandardBlock) return null

  const noneMeta = COST_SOURCE_BY_VALUE[CostSource.NONE]

  return (
    <FieldPanel resizeId='part-costing' defaultLabelWidth={130}>
      {hasComparison ? (
        <>
          <FieldPanelRow title='Buy (supplier)'>
            <div className='flex min-h-8 items-center gap-2 text-sm tabular-nums'>
              {formatCurrency(purchaseCost)}
              {costSource === CostSource.VENDOR && <PartCostBadge source={costSource} />}
            </div>
          </FieldPanelRow>
          <FieldPanelRow title='Build (BOM)'>
            <div className='flex min-h-8 items-center gap-2 text-sm tabular-nums'>
              {formatCurrency(rollupCost)}
              {costSource === CostSource.BOM && <PartCostBadge source={costSource} />}
            </div>
          </FieldPanelRow>
          <FieldPanelRow title='Comparison'>
            <div className='flex min-h-8 items-center text-sm text-muted-foreground'>
              {formatComparison(purchaseCost, rollupCost)}
            </div>
          </FieldPanelRow>
        </>
      ) : isUncosted ? (
        <FieldPanelRow title='Cost'>
          <div className='flex min-h-8 flex-wrap items-center gap-2 text-sm'>
            <Badge variant={(noneMeta?.color ?? 'amber') as Variant} size='xs'>
              {noneMeta?.label ?? 'Not costed'}
            </Badge>
            {/* The reason waits for the subpart-presence read so it can never
                  flash "no bill of materials" at an assembly. */}
            {!isLoadingSubparts && (
              <span className='text-xs text-muted-foreground'>
                {hasSubparts
                  ? 'The bill of materials has unpriced components, the Subparts tab lists them.'
                  : 'No supplier price and no bill of materials.'}
              </span>
            )}
          </div>
        </FieldPanelRow>
      ) : null}

      {hasStandardBlock && (
        <>
          <FieldPanelRow
            title='Standard'
            description='The frozen value every stock movement is stamped with'>
            {/* The value and the action share ONE non-wrapping line, so the Roll
                button sits at the same right edge whatever the left side says.
                The bulk-roll hint is a separate block beneath it: inside the flex
                row it wrapped, and `ms-auto` then pushed the button to the end of
                whichever line it happened to land on. */}
            <div className='space-y-1'>
              <div className='flex min-h-8 items-center gap-2 text-sm tabular-nums'>
                {standardCost == null ? (
                  <Badge variant='amber' size='xs'>
                    Not rolled
                  </Badge>
                ) : (
                  <>
                    {formatCurrency(standardCost)}
                    {standardEffectiveAt && (
                      <span className='text-muted-foreground text-xs'>
                        set {formatEffectiveDate(standardEffectiveAt)}
                      </span>
                    )}
                  </>
                )}
                <RollStandardCostPopover partId={partId}>
                  <Button variant='outline' size='xs' className='ms-auto'>
                    Roll
                  </Button>
                </RollStandardCostPopover>
              </div>

              {/* 🛑 The composition, and it is the reason this row exists. A built
                  part's standard carries its own absorption AND every
                  subassembly's underneath it, so on the real lift $270.00 of a
                  $441.07 standard was conversion cost against $171.07 of
                  material — and the single figure above made that invisible.
                  Rendered only for a part that absorbs: on a component the
                  material cost IS the standard cost and this would print the
                  same number twice followed by two zeroes. */}
              {absorbs && standardCost != null && standardMaterialCost != null && (
                <p className='text-muted-foreground text-xs tabular-nums'>
                  Material {formatCurrency(standardMaterialCost)}
                  {standardLaborCost != null && <> · Labour {formatCurrency(standardLaborCost)}</>}
                  {standardOverheadCost != null && (
                    <> · Overhead {formatCurrency(standardOverheadCost)}</>
                  )}
                </p>
              )}

              {/* No "roll it here" — the button is one line up. This says only the
                  thing the button cannot: that 205 parts do not need 205 clicks. */}
              {rollWouldValueIt && (
                <p className='text-muted-foreground text-xs'>
                  <Link
                    href='/app/accounting/settings/general'
                    className='underline underline-offset-2 hover:text-foreground'>
                    Settings &rsaquo; Accounting &rsaquo; General
                  </Link>{' '}
                  rolls every part at once.
                </p>
              )}
            </div>
          </FieldPanelRow>

          {/* ── The two absorption inputs ────────────────────────────────
              Gated on `absorbs` AND on edit authority: hidden rather than
              disabled, the same call every other editable card row here makes.
              Placed under the composition they produce, so the input and its
              frozen output read as one thing. */}
          {absorbs && canEdit && (
            <>
              <AbsorptionOverrideRow
                title='Labor per unit'
                value={laborOverride}
                orgRate={orgLaborRate}
                onChange={(next) => saveOverride('part_labor_cost_per_unit', next)}
              />
              <AbsorptionOverrideRow
                title='Overhead per unit'
                value={overheadOverride}
                orgRate={orgOverheadRate}
                onChange={(next) => saveOverride('part_overhead_cost_per_unit', next)}
              />
            </>
          )}

          {drift != null && (
            <FieldPanelRow
              title='Drift'
              description="Today's cost minus the standard — how stale the standard is">
              <div className='flex min-h-8 items-center text-sm text-muted-foreground tabular-nums'>
                {drift === 0
                  ? 'None — the standard matches today\u2019s cost'
                  : `${drift > 0 ? '+' : ''}${formatCurrency(drift)}`}
              </div>
            </FieldPanelRow>
          )}
        </>
      )}
    </FieldPanel>
  )
}

/**
 * "Buying is $310.00 cheaper (86%)" — the percentage is the saving relative to
 * the more expensive option, so it reads as "what you save by not picking the
 * other one". Equal costs are a real (if rare) answer, not an error.
 */
function formatComparison(purchaseCost: number, rollupCost: number): string {
  if (purchaseCost === rollupCost) return 'Buying and building cost the same'
  const cheaperLabel = purchaseCost < rollupCost ? 'Buying' : 'Building'
  const delta = Math.abs(purchaseCost - rollupCost)
  const expensive = Math.max(purchaseCost, rollupCost)
  const pct = expensive > 0 ? Math.round((delta / expensive) * 100) : 0
  return `${cheaperLabel} is ${formatCurrency(delta)} cheaper${pct > 0 ? ` (${pct}%)` : ''}`
}
