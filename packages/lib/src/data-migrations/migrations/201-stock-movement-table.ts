// packages/lib/src/data-migrations/migrations/201-stock-movement-table.ts
// Moves the EAV `stock_movement` entity into the `StockMovement` table, keeping ids, then deletes
// the entity. See plans/mrp/20-stock-movement-table.md §4.1.

import { type Database, schema, type Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { deleteEntityDefinitionDeep } from '../../entity-definitions/delete-entity-definition'
import { batchRecalculateQoH } from '../../inventory/costing/qoh'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:201')

/** String literals, not the registry: the registry entries are deleted with this release. */
const MOVEMENT_ATTRIBUTES = {
  part: 'stock_movement_part',
  type: 'stock_movement_type',
  quantity: 'stock_movement_quantity',
  reason: 'stock_movement_reason',
  reference: 'stock_movement_reference',
  adjustSubparts: 'stock_movement_adjust_subparts',
  parentMovement: 'stock_movement_parent_movement',
  unitCost: 'stock_movement_unit_cost',
  extendedCost: 'stock_movement_extended_cost',
  costBasis: 'stock_movement_cost_basis',
  glAccount: 'stock_movement_gl_account',
  occurredAt: 'stock_movement_occurred_at',
  vendorPart: 'stock_movement_vendor_part',
  vendorUnitPrice: 'stock_movement_vendor_unit_price',
  freightAccrued: 'stock_movement_freight_accrued',
  dutiesAccrued: 'stock_movement_duties_accrued',
  tariffRate: 'stock_movement_tariff_rate',
  purchaseOrderLine: 'stock_movement_purchase_order_line',
  reversesMovement: 'stock_movement_reverses_movement',
  build: 'stock_movement_build',
  qtyPerUnit: 'stock_movement_qty_per_unit',
  fulfillmentLine: 'stock_movement_fulfillment_line',
  countQuantity: 'stock_movement_count_quantity',
  countDate: 'stock_movement_count_date',
} as const

type MovementKey = keyof typeof MOVEMENT_ATTRIBUTES

/** The relationship fields on other defs that point at movements; they go with the def. */
export const MIRROR_ATTRIBUTES = [
  'part_stock_movements',
  'build_movements',
  'purchase_order_line_stock_movements',
  'fulfillment_line_stock_movements',
  'vendor_part_stock_movements',
  'return_part_line_movement',
] as const

const QOH_CHUNK = 500

export interface Migration201Result extends PerOrgMigrationResult {
  movementsCopied: number
  /** Movements whose part no longer exists: no reader could see them, so they are dropped. */
  orphansDropped: number
  partsRecomputed: number
}

const NOTHING: Migration201Result = {
  entityDefsCreated: 0,
  fieldsCreated: 0,
  relationshipsLinked: 0,
  alreadyUpToDate: true,
  movementsCopied: 0,
  orphansDropped: 0,
  partsRecomputed: 0,
}

/** `CustomField.id` by movement key; a field an older org never materialised (175/193) is absent. */
async function movementFieldIds(
  tx: Transaction,
  organizationId: string,
  movementDefId: string
): Promise<Partial<Record<MovementKey, string>>> {
  const rows = await tx
    .select({ id: schema.CustomField.id, attribute: schema.CustomField.systemAttribute })
    .from(schema.CustomField)
    .where(
      and(
        eq(schema.CustomField.organizationId, organizationId),
        eq(schema.CustomField.entityDefinitionId, movementDefId)
      )
    )
  const byAttribute = new Map(rows.map((row) => [row.attribute, row.id]))
  const ids: Partial<Record<MovementKey, string>> = {}
  for (const [key, attribute] of Object.entries(MOVEMENT_ATTRIBUTES)) {
    const id = byAttribute.get(attribute)
    if (id) ids[key as MovementKey] = id
  }
  return ids
}

/** Copy, check, delete for one org inside `tx`. Returns the parts to recompute after the commit. */
async function moveOrg(
  tx: Transaction,
  organizationId: string,
  movementDefId: string
): Promise<{ copied: number; orphans: number; partIds: string[] }> {
  const f = await movementFieldIds(tx, organizationId, movementDefId)
  const field = (key: MovementKey) => sql`${f[key] ?? null}::text`
  const rel = (key: MovementKey) =>
    sql`max(fv."relatedEntityId") FILTER (WHERE fv."fieldId" = ${field(key)})`
  const num = (key: MovementKey) =>
    sql`max(fv."valueNumber") FILTER (WHERE fv."fieldId" = ${field(key)})`
  const text = (key: MovementKey) =>
    sql`max(fv."valueText") FILTER (WHERE fv."fieldId" = ${field(key)})`
  const option = (key: MovementKey) =>
    sql`max(fv."optionId") FILTER (WHERE fv."fieldId" = ${field(key)})`
  const date = (key: MovementKey) =>
    sql`max(fv."valueDate") FILTER (WHERE fv."fieldId" = ${field(key)})`

  // One row per movement instance, pivoted off its FieldValues. A temp table because the lossy
  // check, the insert and the count all read it.
  await tx.execute(sql`
    CREATE TEMP TABLE _m201_src ON COMMIT DROP AS
    SELECT ei.id, ei."createdAt", ei."createdById",
      ${rel('part')} AS part,
      ${option('type')} AS type,
      ${num('quantity')} AS quantity,
      ${text('reason')} AS reason,
      ${text('reference')} AS reference,
      bool_or(fv."valueBoolean") FILTER (WHERE fv."fieldId" = ${field('adjustSubparts')}) AS adjust,
      ${rel('parentMovement')} AS parent,
      ${num('unitCost')} AS unit_cost,
      ${num('extendedCost')} AS extended_cost,
      ${option('costBasis')} AS cost_basis,
      ${text('glAccount')} AS gl_role,
      ${date('occurredAt')} AS occurred_at,
      ${rel('vendorPart')} AS vendor_part,
      ${num('vendorUnitPrice')} AS vendor_price,
      ${num('freightAccrued')} AS freight,
      ${num('dutiesAccrued')} AS duties,
      ${num('tariffRate')} AS tariff_rate,
      ${rel('purchaseOrderLine')} AS po_line,
      ${rel('reversesMovement')} AS reverses,
      ${rel('build')} AS build,
      ${num('qtyPerUnit')} AS qty_per_unit,
      ${rel('fulfillmentLine')} AS fl,
      ${num('countQuantity')} AS count_quantity,
      ${date('countDate')} AS count_date
    FROM "EntityInstance" ei
    LEFT JOIN "FieldValue" fv
      ON fv."entityId" = ei.id AND fv."organizationId" = ${organizationId}
    WHERE ei."organizationId" = ${organizationId} AND ei."entityDefinitionId" = ${movementDefId}
    GROUP BY ei.id
  `)
  const returnLineField = await tx
    .select({ id: schema.CustomField.id })
    .from(schema.CustomField)
    .where(
      and(
        eq(schema.CustomField.organizationId, organizationId),
        eq(schema.CustomField.systemAttribute, 'return_part_line_movement')
      )
    )
  const returnLineFieldId = returnLineField[0]?.id ?? null

  const counts = await tx.execute<{ total: string; orphans: string; lossy: string }>(sql`
    SELECT count(*) AS total,
      count(*) FILTER (WHERE s.part IS NULL
        OR NOT EXISTS (SELECT 1 FROM "EntityInstance" p WHERE p.id = s.part)) AS orphans,
      count(*) FILTER (WHERE
           s.quantity::numeric <> round(s.quantity::numeric, 6)
        OR s.qty_per_unit::numeric <> round(s.qty_per_unit::numeric, 6)
        OR s.count_quantity::numeric <> round(s.count_quantity::numeric, 6)
        OR s.tariff_rate::numeric <> round(s.tariff_rate::numeric, 6)
        OR s.unit_cost::numeric <> round(s.unit_cost::numeric, 3)
        OR s.vendor_price::numeric <> round(s.vendor_price::numeric, 3)
        OR s.extended_cost <> round(s.extended_cost)
        OR s.freight <> round(s.freight)
        OR s.duties <> round(s.duties)) AS lossy
    FROM _m201_src s
  `)
  const total = Number(counts.rows[0]?.total ?? 0)
  const orphans = Number(counts.rows[0]?.orphans ?? 0)
  const lossy = Number(counts.rows[0]?.lossy ?? 0)
  if (lossy > 0) {
    throw new Error(`${lossy} stock movement(s) hold a value the table's column types would round`)
  }

  // A cost basis that contradicts its cost becomes null, the pre-cost-basis state the checks
  // leave unconstrained, so no amount is dropped. A link to a record that is gone becomes null.
  const live = (column: string) =>
    sql`CASE WHEN EXISTS (SELECT 1 FROM "EntityInstance" x WHERE x.id = ${sql.raw(`s.${column}`)})
      THEN ${sql.raw(`s.${column}`)} END`
  const moved = (column: string) =>
    sql`CASE WHEN EXISTS (SELECT 1 FROM _m201_src y WHERE y.id = ${sql.raw(`s.${column}`)})
      THEN ${sql.raw(`s.${column}`)} END`
  await tx.execute(sql`
    INSERT INTO "StockMovement" (
      id, "organizationId", "partId", type, quantity, reason, reference, "adjustSubparts",
      "parentMovementId", "unitCostMinor", "extendedCostMinor", "costBasis", "glRole", "occurredAt",
      "vendorPartId", "vendorUnitPriceMinor", "freightAccruedMinor", "dutiesAccruedMinor",
      "tariffRate", "purchaseOrderLineId", "reversesMovementId", "buildId", "qtyPerUnit",
      "fulfillmentLineId", "returnPartLineId", "countQuantity", "countDate", "createdAt",
      "createdById"
    )
    SELECT s.id, ${organizationId}, s.part, s.type::"StockMovementType",
      round(COALESCE(s.quantity, 0)::numeric, 6), s.reason, s.reference,
      COALESCE(s.adjust, false), ${moved('parent')},
      round(s.unit_cost::numeric, 3), round(s.extended_cost)::bigint,
      CASE
        WHEN s.cost_basis = 'pending' AND s.unit_cost IS NULL AND s.extended_cost IS NULL
          THEN 'pending'
        WHEN s.cost_basis IN ('standard', 'actual') AND s.unit_cost IS NOT NULL
          THEN s.cost_basis
      END::"StockMovementCostBasis",
      s.gl_role, s.occurred_at, ${live('vendor_part')},
      round(s.vendor_price::numeric, 3), round(s.freight)::bigint, round(s.duties)::bigint,
      round(s.tariff_rate::numeric, 6), ${live('po_line')}, ${moved('reverses')},
      ${live('build')}, round(s.qty_per_unit::numeric, 6), ${live('fl')},
      (SELECT min(r."entityId") FROM "FieldValue" r
        WHERE r."fieldId" = ${returnLineFieldId}::text AND r."relatedEntityId" = s.id
          AND EXISTS (SELECT 1 FROM "EntityInstance" x WHERE x.id = r."entityId")),
      round(s.count_quantity::numeric, 6), (s.count_date AT TIME ZONE 'UTC')::date,
      s."createdAt", s."createdById"
    FROM _m201_src s
    WHERE s.part IS NOT NULL AND EXISTS (SELECT 1 FROM "EntityInstance" p WHERE p.id = s.part)
    ON CONFLICT (id) DO NOTHING
  `)

  const copiedRows = await tx.execute<{ copied: string }>(sql`
    SELECT count(*) AS copied FROM "StockMovement" m JOIN _m201_src s ON s.id = m.id
    WHERE m."organizationId" = ${organizationId}
  `)
  const copied = Number(copiedRows.rows[0]?.copied ?? 0)
  if (copied !== total - orphans) {
    throw new Error(
      `Copied ${copied} stock movements but the entity holds ${total - orphans} (plus ${orphans} orphans)`
    )
  }

  const partRows = await tx.execute<{ partId: string }>(sql`
    SELECT DISTINCT m."partId" FROM "StockMovement" m JOIN _m201_src s ON s.id = m.id
  `)

  // The mirror fields first, by attribute: a system field's stored inverse id is not reliably a
  // `CustomField.id`, so the deep delete's partner lookup cannot be trusted to find them.
  const mirrors = await tx
    .select({ id: schema.CustomField.id })
    .from(schema.CustomField)
    .where(
      and(
        eq(schema.CustomField.organizationId, organizationId),
        inArray(schema.CustomField.systemAttribute, [...MIRROR_ATTRIBUTES])
      )
    )
  const mirrorIds = mirrors.map((row) => row.id)
  if (mirrorIds.length > 0) {
    await tx.delete(schema.FieldValue).where(inArray(schema.FieldValue.fieldId, mirrorIds))
    await tx.delete(schema.CustomField).where(inArray(schema.CustomField.id, mirrorIds))
  }
  // Own values before the def, so the def's cascade is instances and fields only.
  await tx
    .delete(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.entityDefinitionId, movementDefId)
      )
    )
  await deleteEntityDefinitionDeep({
    id: movementDefId,
    organizationId,
    db: tx as unknown as Database,
    allowSystemEntity: true,
  })

  return { copied, orphans, partIds: partRows.rows.map((row) => row.partId) }
}

/**
 * Migration 201: copy every `stock_movement` entity instance into `StockMovement` under the same
 * id (S1), check the count, and delete the instances, their values, the mirror relationship
 * fields and the def, in one transaction per org; then re-derive QoH for the org's parts.
 * Idempotent: an org without the def is already done, and a failed org rolls back whole.
 */
export const migration201StockMovementTable: PerOrgMigration = {
  id: '201-stock-movement-table',
  description:
    'Moves stock movements from the stock_movement entity into the StockMovement table, keeping ' +
    'ids, then deletes the entity, its values and the mirror relationship fields (plans/mrp/20).',

  async up(db: Database, organizationId: string): Promise<Migration201Result> {
    const [def] = await db
      .select({ id: schema.EntityDefinition.id })
      .from(schema.EntityDefinition)
      .where(
        and(
          eq(schema.EntityDefinition.organizationId, organizationId),
          eq(schema.EntityDefinition.entityType, 'stock_movement')
        )
      )
      .limit(1)
    if (!def) return NOTHING

    const moved = await db.transaction((tx) => moveOrg(tx, organizationId, def.id))

    // After the commit: the recompute reads through the pool.
    for (let offset = 0; offset < moved.partIds.length; offset += QOH_CHUNK) {
      await batchRecalculateQoH(organizationId, moved.partIds.slice(offset, offset + QOH_CHUNK))
    }

    logger.info('Migration 201 applied', {
      organizationId,
      movementsCopied: moved.copied,
      orphansDropped: moved.orphans,
      partsRecomputed: moved.partIds.length,
    })
    return {
      ...NOTHING,
      alreadyUpToDate: false,
      movementsCopied: moved.copied,
      orphansDropped: moved.orphans,
      partsRecomputed: moved.partIds.length,
    }
  },
}
