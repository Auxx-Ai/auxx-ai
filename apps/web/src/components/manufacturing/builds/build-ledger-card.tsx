// apps/web/src/components/manufacturing/builds/build-ledger-card.tsx
'use client'

// `build:ledger` — the stock movements this build wrote
// (plans/products/build/01-build-plan.md §1.6: "`build_movements` — has_many; a
// card lists them").
//
// `build_movements` is declared `showInPanel: false`, so this card is its only
// surface. `stock_movement_qty_per_unit` is `showInPanel: false` too, and
// deliberately so — §1.6: "exposing it invites someone to 'correct' the as-built
// snapshot, which destroys its only purpose". This card therefore renders what
// that snapshot MEANS, not the number: a consume row with no per-unit quantity
// is an off-BOM substitution, and it says so.
//
// The rows are read through the generic record list rather than through a lib
// query, because they are ordinary `stock_movement` records and the mail/record
// scope predicates that apply to every other movement list must apply here too.

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { ACCOUNT_ROLE_LABELS } from '@auxx/lib/postings/client'
import { StockMovementType } from '@auxx/lib/resources/client'
import type { ResourceFieldId } from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'
import { Badge, type Variant } from '@auxx/ui/components/badge'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { formatCurrency } from '@auxx/utils/currency'
import { PackageMinus, PackagePlus } from 'lucide-react'
import { useMemo } from 'react'
import { EmptyRow } from '~/components/drawers/cards/related-record-row'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { toRecordId, useRecord, useRecordList, useResourceProperty } from '~/components/resources'
import { useSystemValuesForRecords } from '~/components/resources/hooks/use-system-values-for-records'
import { useSettings } from '~/hooks/use-settings'

/** Movement type value → badge colour, straight from the registry's own enum. */
const TYPE_VARIANT: Record<string, Variant> = Object.fromEntries(
  StockMovementType.values.map((value) => [value.value, value.color as Variant])
)

/**
 * Movement type value → badge text, straight from the registry.
 *
 * `build_consume` / `build_produce` read "Consumed" / "Produced" — renamed in
 * `enum-values.ts` itself, so this card and the two part-inventory surfaces
 * share one vocabulary. ⚠️ Orgs installed before that rename still hold the old
 * "Build (consume)" label in their materialized `CustomField.options`, so the
 * movements GRID and its filters can disagree with this badge until a migration
 * rewrites them. Known and accepted, not a bug to "fix" by hardcoding here.
 */
const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  StockMovementType.values.map((value) => [value.value, value.label])
)

/**
 * `stock_movement_gl_account` holds an auxx posting ROLE, not an account number
 * (decision `G8`) — the chart of accounts is an org-editable default, so a
 * number frozen onto an append-only movement would be silently reinterpreted by
 * a renumber. The field name predates the decision and cannot be changed
 * without reshaping a materialised field in every org.
 *
 * The labels come from `postings/client` rather than the resource registry:
 * decision `G19` deleted the `GlAccountRole` registry enum along with the
 * `gl_account.role` field it existed to populate, leaving `ACCOUNT_ROLES` and
 * its label map as the single home of the vocabulary.
 */
const INVENTORY_ROLE_LABEL: Record<string, string> = ACCOUNT_ROLE_LABELS

const MOVEMENT_ATTRIBUTES = [
  // The part IS a movement row's identity here — a build's ledger is read as
  // "what went in and what came out", not as a list of movement ids.
  'stock_movement_part',
  'stock_movement_type',
  'stock_movement_quantity',
  'stock_movement_unit_cost',
  'stock_movement_extended_cost',
  'stock_movement_gl_account',
  // Read to detect the OFF-BOM case, never rendered as a number — see the header.
  'stock_movement_qty_per_unit',
] as const

/** How many movements render before the list stops. A build writes one row per component. */
const MOVEMENT_LIMIT = 200

/** Placeholder rows while the ids and their values land. */
const SKELETON_ROWS = 3

export function BuildLedgerCard({ entityInstanceId }: DrawerTabProps) {
  const { getSetting } = useSettings({})
  const currencyCode = (getSetting('organization.currency') as string | null) ?? 'USD'

  const movementDefId = useResourceProperty('stock_movement', 'id')

  const filters: ConditionGroup[] = useMemo(
    () => [
      {
        id: 'build-filter',
        logicalOperator: 'AND' as const,
        conditions: [
          {
            id: 'build-match',
            fieldId: 'stock_movement:build' as ResourceFieldId,
            operator: 'is' as const,
            value: entityInstanceId,
          },
        ],
      },
    ],
    [entityInstanceId]
  )

  const {
    records,
    recordIds: movementIds,
    isLoading,
    isLoadingRecords,
  } = useRecordList({
    entityDefinitionId: movementDefId ?? '',
    filters,
    limit: MOVEMENT_LIMIT,
    enabled: !!entityInstanceId && !!movementDefId,
  })

  const recordIds = useMemo(
    () => (movementDefId ? records.map((record) => toRecordId(movementDefId, record.id)) : []),
    [records, movementDefId]
  )

  const { valuesById } = useSystemValuesForRecords(recordIds, MOVEMENT_ATTRIBUTES, {
    autoFetch: true,
    enabled: recordIds.length > 0,
  })

  // 🛑 Both halves. Rows read `RecordMeta` (`displayName`), which resolves in a
  // SECOND wave after the ids — and a list served from the store cache reports
  // `isLoading: false` with `records` still empty. Without `isLoadingRecords`
  // the empty row below claims a completed build posted nothing, which is
  // exactly the statement it exists to make about a `planned` one.
  const loading = isLoading || isLoadingRecords

  if (!loading && movementIds.length === 0) {
    // Not an error and not a gap: a `planned` build writes no movements at all
    // (B2), which is the safety property the whole phasing rests on.
    return <EmptyRow label='Nothing posted yet (A build writes its ledger when it completes)' />
  }

  return (
    <TreeRowList
      items={records}
      loading={loading}
      skeletonCount={SKELETON_ROWS}
      getKey={(record) => record.id}
      renderRow={(record, index) => (
        <MovementRow
          fallbackLabel={record.displayName}
          values={valuesById[recordIds[index] ?? ''] ?? {}}
          currencyCode={currencyCode}
        />
      )}
    />
  )
}

function MovementRow({
  fallbackLabel,
  values,
  currencyCode,
}: {
  fallbackLabel: string | null | undefined
  values: Record<string, unknown>
  currencyCode: string
}) {
  const partRecordId = unwrap(values.stock_movement_part) as RecordId | undefined
  const { record: part } = useRecord({ recordId: partRecordId!, enabled: !!partRecordId })
  const label = part?.displayName ?? fallbackLabel

  const type = unwrap(values.stock_movement_type) as string | undefined
  const quantity = numberOrNull(values.stock_movement_quantity)
  const unitCost = numberOrNull(values.stock_movement_unit_cost)
  const extendedCost = numberOrNull(values.stock_movement_extended_cost)
  // A ROLE, not an account number (decision `G8`) — the field name predates the
  // decision. Rendered through its label, because `inventory_raw_materials` is
  // a storage key and not something to show a person.
  const inventoryRole = unwrap(values.stock_movement_gl_account) as string | undefined
  const inventoryRoleLabel = INVENTORY_ROLE_LABEL[inventoryRole ?? ''] ?? inventoryRole
  const qtyPerUnit = numberOrNull(values.stock_movement_qty_per_unit)

  // 🛑 The off-BOM marker, read as the marker it is. NULL `qtyPerUnit` on a
  // CONSUME row means the component was not on the bill of materials — a floor
  // substitution, made visible instead of silent (Gap C §4.1). It is NULL on
  // every other movement type by definition, so the produce row must not be
  // labelled a substitution.
  const isConsume = type === 'build_consume'
  const offBom = isConsume && qtyPerUnit == null

  // What the row cost and where it posted, as one string for `description`.
  // ⚠️ `description` is a TOOLTIP, not a subtitle — TreeRow renders it as a
  // `HelpCircle` beside the title (`tooltip.tsx` `TooltipExplanation`), so this
  // text is only readable on hover. Deliberate: it keeps the row to a name, a
  // badge and two numbers. Move it back into `actions` to make it always visible.
  const costDescription = [
    unitCost == null ? 'no cost' : `${formatCurrency(unitCost, { currencyCode })} each`,
    inventoryRoleLabel,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    // `TREE_SECONDARY_NOTRUNCATE`: the `secondary` slot truncates by default,
    // which would clip a two-badge cluster into an ellipsis on a narrow drawer.
    // The part name is the one thing here that should absorb the squeeze.
    <TreeRow
      className={TREE_SECONDARY_NOTRUNCATE}
      icon={isConsume ? <PackageMinus className='size-4' /> : <PackagePlus className='size-4' />}
      title={<span className='truncate text-sm'>{label || 'Movement'}</span>}
      description={costDescription}
      secondary={
        <span className='flex items-center gap-1.5'>
          {type && (
            <Badge variant={TYPE_VARIANT[type] ?? 'secondary'} size='xs'>
              {TYPE_LABEL[type] ?? type}
            </Badge>
          )}
          {offBom && (
            <Badge variant='amber' size='xs'>
              Off BOM
            </Badge>
          )}
        </span>
      }
      actions={
        <div className='flex shrink-0 items-center gap-3 pr-1 text-sm tabular-nums'>
          <span>{quantity == null ? '—' : formatSignedQuantity(quantity)}</span>
          <span className='w-24 text-right'>
            {extendedCost == null ? '—' : formatCurrency(extendedCost, { currencyCode })}
          </span>
        </div>
      }
    />
  )
}

/** SINGLE_SELECT and RELATIONSHIP reads come back as arrays; everything else scalar. */
function unwrap(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value
}

/** A NUMBER system value, with absence kept distinct from zero. */
function numberOrNull(value: unknown): number | null {
  const raw = unwrap(value)
  const parsed = typeof raw === 'string' ? Number(raw) : raw
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null
}

/** A movement quantity keeps its sign — consume is negative, produce is positive. */
function formatSignedQuantity(value: number): string {
  const trimmed = Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)))
  return value > 0 ? `+${trimmed}` : trimmed
}
