// apps/web/src/components/drawers/cards/part-costing-card.tsx
'use client'

import { standardCostDrift } from '@auxx/lib/builds/client'
import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { CostSource, parseRecordId } from '@auxx/lib/resources/client'
import type { ResourceFieldId } from '@auxx/types/field'
import { Badge, type Variant } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { formatCurrency } from '@auxx/utils/currency'
import { useMemo } from 'react'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { Tooltip } from '~/components/global/tooltip'
import { RollStandardCostPopover } from '~/components/manufacturing/parts/roll-standard-cost-popover'
import { useRecordList, useResourceProperty } from '~/components/resources'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
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
  'part_standard_cost_effective_at',
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
  const standardEffectiveAt = values.part_standard_cost_effective_at as string | undefined

  const hasComparison = purchaseCost != null && rollupCost != null
  const isUncosted = costSource === CostSource.NONE
  // The standard block shows as soon as there is anything to say about it —
  // including "not rolled yet", which is the state that needs the action most.
  const hasStandardBlock = standardCost != null || liveCost != null
  // How far the standard has drifted from reality since it was last rolled.
  // Genuinely useful on its own: it is the number that tells you a roll is due.
  const drift = standardCostDrift(liveCost, standardCost)

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
            <div className='flex min-h-8 flex-wrap items-center gap-2 text-sm tabular-nums'>
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
          </FieldPanelRow>

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
