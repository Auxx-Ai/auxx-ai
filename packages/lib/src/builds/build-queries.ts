// packages/lib/src/builds/build-queries.ts

/**
 * Every READ over the build event: the list and detail surfaces, the
 * transaction-only locking read the write paths open with, and
 * {@link explodeBuildComponents} — the priced component plan a completion form
 * shows before anything is written.
 *
 * plans/products/build/01-build-plan.md section 3.4.
 *
 * Reads only. The writes live in `build-mutations.ts`, `complete-build.ts` and
 * `reverse-build.ts`, because a file that both queries and mutates is the first
 * step back toward a service class (`docs/lib-module-guide.md` section 5).
 *
 * No permission checks anywhere in this file. The router asserts and hands the
 * narrowed filters down (`docs/lib-module-guide.md` section 6).
 */

import type { Transaction } from '@auxx/database'
import { type Database, schema } from '@auxx/database'
import { and, desc, eq, inArray, isNotNull, isNull, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Result } from 'neverthrow'
import { loadDirectSubparts } from '../bom/subpart-graph'
import { getCachedEntityDefId, getOrgCache } from '../cache'
import { ConflictError, NotFoundError, UnprocessableEntityError } from '../errors'
import { computeExtendedCost, resolveInventoryRoleForPartKind } from '../receiving/client'
import { toRecordId } from '../resources/resource-id'
import {
  type BuildStatusValue,
  componentConsumption,
  resolveBuildStatus,
  unitsStarted,
} from './client'
import { guard } from './guard'
import { readStandardCost } from './standard-cost-queries'
import type {
  BuildComponentLine,
  BuildComponentOverride,
  BuildComponentPlan,
  BuildMovementRow,
  BuildRecord,
  ListBuildsFilters,
  PartStandardCost,
} from './types'

/**
 * Every attribute a {@link BuildRecord} is assembled from.
 *
 * All optional below: entity migration 109 provisions them, and an org that has
 * not run it must read an empty list rather than 500.
 */
const BUILD_ATTRIBUTES = [
  'build_number',
  'build_part',
  'build_status',
  'build_quantity_planned',
  'build_quantity_produced',
  'build_quantity_scrapped',
  'build_started_at',
  'build_completed_at',
  'build_material_cost',
  'build_labor_cost',
  'build_overhead_cost',
  'build_produced_value',
  'build_variance_amount',
  'build_posted_at',
  'build_notes',
  'build_order',
  'build_source',
  'build_reversal_of',
  'build_order_revision',
] as const

type BuildAttribute = (typeof BUILD_ATTRIBUTES)[number]

/** The movement attributes a build writes and a reversal reads back. */
const BUILD_MOVEMENT_ATTRIBUTES = [
  'stock_movement_build',
  'stock_movement_part',
  'stock_movement_type',
  'stock_movement_quantity',
  'stock_movement_unit_cost',
  'stock_movement_extended_cost',
  'stock_movement_gl_account',
  'stock_movement_qty_per_unit',
  'stock_movement_cost_basis',
] as const

type BuildMovementAttribute = (typeof BUILD_MOVEMENT_ATTRIBUTES)[number]

const DEFAULT_LIMIT = 50

/** `systemAttribute` -> the materialised `CustomField`, or `null`. */
type BuildFields = Record<BuildAttribute, { id: string } | null>
type BuildMovementFields = Record<BuildMovementAttribute, { id: string } | null>

/** The resolved ids the build reads need. */
export interface BuildFieldContext {
  buildDefId: string
  fields: BuildFields
}

/** The resolved ids the movement reads and writes need. */
export interface BuildMovementFieldContext {
  movementDefId: string
  partDefId: string
  fields: BuildMovementFields
}

/**
 * Resolve the `build` def and its fields, or `null` when the org has no build
 * entity yet.
 *
 * `null` rather than a throw so a list surface on an unmigrated org renders
 * empty. The WRITE paths use {@link requireBuildFieldContext} instead, because
 * a write that silently did nothing would be worse than a refusal.
 */
export async function loadBuildFieldContext(
  organizationId: string
): Promise<BuildFieldContext | null> {
  const buildDefId = await getCachedEntityDefId(organizationId, 'build')
  if (!buildDefId) return null
  const fields = (await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...BUILD_ATTRIBUTES])) as BuildFields
  // Without `status` there is no lifecycle at all, and every write gate below
  // reduces to "yes". An org in that state must not be written to.
  if (!fields.build_status || !fields.build_part) return null
  return { buildDefId, fields }
}

/** {@link loadBuildFieldContext}, as the refusal a write path needs. */
export async function requireBuildFieldContext(organizationId: string): Promise<BuildFieldContext> {
  const ctx = await loadBuildFieldContext(organizationId)
  if (!ctx) {
    throw new UnprocessableEntityError(
      'Builds are not available until the build entity and its fields are provisioned'
    )
  }
  return ctx
}

/**
 * Resolve the `stock_movement` def and the fields a build stamps onto its rows.
 *
 * The two migration-109 additions — `stock_movement_build` and
 * `stock_movement_qty_per_unit` — are REQUIRED here rather than optional. A
 * build whose movements cannot name the build that wrote them is a ledger with
 * no provenance, and `reverseBuild` has nothing to read back.
 */
export async function requireBuildMovementFieldContext(
  organizationId: string
): Promise<BuildMovementFieldContext> {
  const movementDefId = await getCachedEntityDefId(organizationId, 'stock_movement')
  const partDefId = await getCachedEntityDefId(organizationId, 'part')
  if (!movementDefId || !partDefId) {
    throw new UnprocessableEntityError(
      'This organization has no stock movement or part entity definition yet'
    )
  }
  const fields = (await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...BUILD_MOVEMENT_ATTRIBUTES])) as BuildMovementFields

  if (
    !fields.stock_movement_build ||
    !fields.stock_movement_part ||
    !fields.stock_movement_type ||
    !fields.stock_movement_quantity ||
    !fields.stock_movement_unit_cost ||
    !fields.stock_movement_qty_per_unit
  ) {
    throw new UnprocessableEntityError(
      'Writing a build is not available until the stock movement build fields are provisioned'
    )
  }
  return { movementDefId, partDefId, fields }
}

// ─── Detail and list ────────────────────────────────────────────────────

/** One build, or `null` when it does not exist, is archived, or is another org's. */
export async function getBuild(
  db: Database,
  organizationId: string,
  buildId: string
): Promise<Result<BuildRecord | null, Error>> {
  return guard(
    async () => {
      const ctx = await loadBuildFieldContext(organizationId)
      if (!ctx) return null

      const [instance] = await db
        .select({ id: schema.EntityInstance.id, createdAt: schema.EntityInstance.createdAt })
        .from(schema.EntityInstance)
        .where(
          and(
            eq(schema.EntityInstance.id, buildId),
            eq(schema.EntityInstance.organizationId, organizationId),
            eq(schema.EntityInstance.entityDefinitionId, ctx.buildDefId),
            isNull(schema.EntityInstance.archivedAt)
          )
        )
        .limit(1)

      if (!instance) return null
      const [record] = await hydrateBuilds(db, organizationId, ctx, [instance])
      return record ?? null
    },
    'Failed to read build',
    { organizationId, buildId }
  )
}

/**
 * List builds, newest first.
 *
 * Ordering is `createdAt` and not `completedAt`: a planned build has no
 * completion date at all, and ordering on it would sort every open run to one
 * end of the list — which is the half of the list a shop floor is looking at.
 * Filters are applied in SQL, so a caller asking for page two gets page two of
 * the filtered set.
 */
export async function listBuilds(
  db: Database,
  organizationId: string,
  filters: ListBuildsFilters = {}
): Promise<Result<BuildRecord[], Error>> {
  return guard(
    async () => {
      const ctx = await loadBuildFieldContext(organizationId)
      if (!ctx) return []
      return queryBuilds(db, organizationId, ctx, filters, [])
    },
    'Failed to list builds',
    { organizationId, filters }
  )
}

/**
 * Completed builds that carry no `postedAt` — what a GL export would pick up.
 *
 * ⚠️ **`postedAt` is a denormalized convenience, not the authority** (section
 * 1.1). GL posting is out of scope for this directory (README B9), so nothing
 * writes it yet and this returns every completed build. When the posting ledger
 * lands, the authority becomes a `gl_posting` row referencing the build, and
 * this function's predicate moves there — the shape of the answer does not
 * change, so callers do not.
 */
export async function listUnpostedBuilds(
  db: Database,
  organizationId: string,
  filters: Pick<ListBuildsFilters, 'limit' | 'offset'> = {}
): Promise<Result<BuildRecord[], Error>> {
  return guard(
    async () => {
      const ctx = await loadBuildFieldContext(organizationId)
      if (!ctx) return []

      // A LEFT JOIN plus `IS NULL` on the joined column, so a build with no
      // `postedAt` ROW at all is included alongside one whose row is present and
      // empty. An inner join would drop the first group, which today is every
      // completed build there is.
      const postedField = ctx.fields.build_posted_at
      const unposted: AbsentValueJoin[] = postedField
        ? [{ fieldId: postedField.id, name: 'build_unposted' }]
        : []

      return queryBuilds(db, organizationId, ctx, { ...filters, status: 'completed' }, unposted)
    },
    'Failed to list unposted builds',
    { organizationId }
  )
}

/** An aliased `FieldValue` table, as `alias()` returns it. */
type FieldValueAlias = ReturnType<typeof alias<typeof schema.FieldValue, string>>

/** A LEFT JOIN whose joined row must be absent or empty. See {@link listUnpostedBuilds}. */
interface AbsentValueJoin {
  fieldId: string
  name: string
}

async function queryBuilds(
  db: Database,
  organizationId: string,
  ctx: BuildFieldContext,
  filters: ListBuildsFilters,
  absent: AbsentValueJoin[]
): Promise<BuildRecord[]> {
  const limit = filters.limit ?? DEFAULT_LIMIT
  const offset = filters.offset ?? 0

  const where: SQL[] = [
    eq(schema.EntityInstance.organizationId, organizationId),
    eq(schema.EntityInstance.entityDefinitionId, ctx.buildDefId),
    isNull(schema.EntityInstance.archivedAt),
  ]

  let query = db
    .select({ id: schema.EntityInstance.id, createdAt: schema.EntityInstance.createdAt })
    .from(schema.EntityInstance)
    .$dynamic()

  if (filters.status && ctx.fields.build_status) {
    const statusValue = alias(schema.FieldValue, 'build_status_v')
    query = query.innerJoin(
      statusValue,
      and(
        valueJoin(statusValue, ctx.fields.build_status.id),
        eq(statusValue.optionId, filters.status)
      )
    )
  }

  if (filters.source && ctx.fields.build_source) {
    const sourceValue = alias(schema.FieldValue, 'build_source_v')
    query = query.innerJoin(
      sourceValue,
      and(
        valueJoin(sourceValue, ctx.fields.build_source.id),
        eq(sourceValue.optionId, filters.source)
      )
    )
  }

  if (filters.partId && ctx.fields.build_part) {
    const partValue = alias(schema.FieldValue, 'build_part_v')
    query = query.innerJoin(
      partValue,
      and(
        valueJoin(partValue, ctx.fields.build_part.id),
        eq(partValue.relatedEntityId, filters.partId)
      )
    )
  }

  if (filters.orderId && ctx.fields.build_order) {
    const orderValue = alias(schema.FieldValue, 'build_order_v')
    query = query.innerJoin(
      orderValue,
      and(
        valueJoin(orderValue, ctx.fields.build_order.id),
        eq(orderValue.relatedEntityId, filters.orderId)
      )
    )
  }

  for (const join of absent) {
    const absentValue = alias(schema.FieldValue, join.name)
    query = query.leftJoin(absentValue, valueJoin(absentValue, join.fieldId))
    where.push(isNull(absentValue.valueDate))
  }

  const rows = await query
    .where(and(...where))
    .orderBy(desc(schema.EntityInstance.createdAt))
    .limit(limit)
    .offset(offset)

  if (rows.length === 0) return []
  return hydrateBuilds(db, organizationId, ctx, rows)
}

/**
 * Join predicate for "this instance's value of <field>".
 *
 * Takes the alias OBJECT and composes with `eq`, so drizzle emits the table as
 * an identifier. A hand-written `sql` fragment interpolating a table binds it as
 * a parameter instead, which is a mistake this codebase has already paid for.
 */
function valueJoin(table: FieldValueAlias, fieldId: string): SQL | undefined {
  return and(
    eq(table.entityId, schema.EntityInstance.id),
    eq(table.organizationId, schema.EntityInstance.organizationId),
    eq(table.fieldId, fieldId)
  )
}

/**
 * Turn a page of build ids into full rows with ONE additional query.
 *
 * The alternative — a join per attribute on the paging query — multiplies the
 * row count and makes `LIMIT` mean something other than "this many builds".
 */
async function hydrateBuilds(
  db: Database,
  organizationId: string,
  ctx: BuildFieldContext,
  page: { id: string; createdAt: Date }[]
): Promise<BuildRecord[]> {
  const ids = page.map((row) => row.id)
  const fieldIds = Object.values(ctx.fields)
    .filter((field): field is { id: string } => field != null)
    .map((field) => field.id)

  const values = await db
    .select({
      entityId: schema.FieldValue.entityId,
      fieldId: schema.FieldValue.fieldId,
      valueText: schema.FieldValue.valueText,
      valueNumber: schema.FieldValue.valueNumber,
      valueDate: schema.FieldValue.valueDate,
      optionId: schema.FieldValue.optionId,
      relatedEntityId: schema.FieldValue.relatedEntityId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.FieldValue.entityId, ids),
        inArray(schema.FieldValue.fieldId, fieldIds)
      )
    )

  const byInstance = new Map<string, Map<string, (typeof values)[number]>>()
  for (const value of values) {
    let bucket = byInstance.get(value.entityId)
    if (!bucket) {
      bucket = new Map()
      byInstance.set(value.entityId, bucket)
    }
    bucket.set(value.fieldId, value)
  }

  return page.map((row) => toBuildRecord(ctx, row, byInstance.get(row.id)))
}

function toBuildRecord(
  ctx: BuildFieldContext,
  row: { id: string; createdAt: Date },
  bucket:
    | Map<
        string,
        {
          valueText: string | null
          valueNumber: number | null
          valueDate: string | null
          optionId: string | null
          relatedEntityId: string | null
        }
      >
    | undefined
): BuildRecord {
  const read = (attr: BuildAttribute) => {
    const id = ctx.fields[attr]?.id
    return id ? (bucket?.get(id) ?? null) : null
  }
  const date = (attr: BuildAttribute) => {
    const raw = read(attr)?.valueDate
    return raw ? new Date(raw) : null
  }

  return {
    buildId: row.id,
    recordId: toRecordId(ctx.buildDefId, row.id),
    number: read('build_number')?.valueText ?? null,
    partId: read('build_part')?.relatedEntityId ?? null,
    status: resolveBuildStatus(read('build_status')?.optionId),
    quantityPlanned: read('build_quantity_planned')?.valueNumber ?? null,
    quantityProduced: read('build_quantity_produced')?.valueNumber ?? null,
    quantityScrapped: read('build_quantity_scrapped')?.valueNumber ?? null,
    startedAt: date('build_started_at'),
    completedAt: date('build_completed_at'),
    materialCost: read('build_material_cost')?.valueNumber ?? null,
    laborCost: read('build_labor_cost')?.valueNumber ?? null,
    overheadCost: read('build_overhead_cost')?.valueNumber ?? null,
    producedValue: read('build_produced_value')?.valueNumber ?? null,
    varianceAmount: read('build_variance_amount')?.valueNumber ?? null,
    postedAt: date('build_posted_at'),
    notes: read('build_notes')?.valueText ?? null,
    orderId: read('build_order')?.relatedEntityId ?? null,
    source: read('build_source')?.optionId ?? null,
    reversalOfBuildId: read('build_reversal_of')?.relatedEntityId ?? null,
    orderRevision: read('build_order_revision')?.valueText ?? null,
    createdAt: row.createdAt,
  }
}

// ─── The transaction-only reads ─────────────────────────────────────────

/**
 * Re-read a build `FOR UPDATE`, inside the caller's transaction.
 *
 * 🛑 **This is the whole of B8's enforcement.** Two concurrent completions both
 * reach here; the row lock serialises them, the loser reads the status the
 * winner committed, and `canCompleteBuild` refuses it. Reading the status
 * BEFORE taking the lock — or taking no lock — makes "one completion per build"
 * a race, and the losing side would write a second full set of movements that
 * nothing downstream can tell from the first.
 *
 * `tx` is positional-first and typed as {@link Transaction}, not `Database`, so
 * a connection pool cannot typecheck into the slot
 * (`docs/lib-module-guide.md` section 4).
 */
export async function lockBuild(
  tx: Transaction,
  organizationId: string,
  ctx: BuildFieldContext,
  buildId: string
): Promise<BuildRecord> {
  const [instance] = await tx
    .select({ id: schema.EntityInstance.id, createdAt: schema.EntityInstance.createdAt })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.id, buildId),
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, ctx.buildDefId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .for('update')

  if (!instance) throw new NotFoundError(`Build ${buildId} not found`)

  const [record] = await hydrateBuilds(tx as unknown as Database, organizationId, ctx, [instance])
  if (!record) throw new NotFoundError(`Build ${buildId} not found`)
  return record
}

/**
 * Assert a build is in one of the statuses an action accepts.
 *
 * A `null` status is refused with the same `ConflictError`: see
 * {@link resolveBuildStatus} for why an absent status is never defaulted on a
 * path that writes.
 */
export function assertBuildStatus(
  build: BuildRecord,
  allowed: (status: BuildStatusValue | null) => boolean,
  message: string
): void {
  if (!allowed(build.status)) throw new ConflictError(message)
}

/**
 * Does a live build already point its `reversalOf` at this one?
 *
 * Joins `EntityInstance` so an ARCHIVED reversal does not block a legitimate
 * second attempt — an archived build contributes nothing to any roll-up, so
 * treating it as a standing reversal would leave the mistake uncorrectable.
 * Same rule, and the same reason, as `reverse-movement.ts`'s `hasReversal`.
 */
export async function hasBuildReversal(
  db: Database,
  organizationId: string,
  ctx: BuildFieldContext,
  buildId: string
): Promise<boolean> {
  const reversalField = ctx.fields.build_reversal_of
  if (!reversalField) return false

  const [existing] = await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.FieldValue)
    .innerJoin(
      schema.EntityInstance,
      and(
        eq(schema.EntityInstance.id, schema.FieldValue.entityId),
        eq(schema.EntityInstance.organizationId, schema.FieldValue.organizationId)
      )
    )
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, reversalField.id),
        eq(schema.FieldValue.relatedEntityId, buildId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .limit(1)

  return Boolean(existing)
}

/**
 * Every live `stock_movement` this build wrote, with its FROZEN costs.
 *
 * 🛑 The costs come back verbatim and are never re-priced. A reversal valued at
 * today's standard nets a build and its undo to a non-zero amount of inventory
 * value out of nothing, which is the exact costing bug this subsystem exists to
 * prevent (B6).
 */
export async function readBuildMovements(
  db: Database,
  organizationId: string,
  movementCtx: BuildMovementFieldContext,
  buildId: string
): Promise<BuildMovementRow[]> {
  const { fields } = movementCtx
  const buildValue = alias(schema.FieldValue, 'mv_build')

  const instances = await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .innerJoin(
      buildValue,
      and(
        eq(buildValue.entityId, schema.EntityInstance.id),
        eq(buildValue.organizationId, schema.EntityInstance.organizationId),
        eq(buildValue.fieldId, fields.stock_movement_build!.id),
        eq(buildValue.relatedEntityId, buildId)
      )
    )
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, movementCtx.movementDefId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .orderBy(schema.EntityInstance.createdAt)

  if (instances.length === 0) return []

  const fieldIds = Object.values(fields)
    .filter((field): field is { id: string } => field != null)
    .map((field) => field.id)

  const values = await db
    .select({
      entityId: schema.FieldValue.entityId,
      fieldId: schema.FieldValue.fieldId,
      valueText: schema.FieldValue.valueText,
      valueNumber: schema.FieldValue.valueNumber,
      optionId: schema.FieldValue.optionId,
      relatedEntityId: schema.FieldValue.relatedEntityId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(
          schema.FieldValue.entityId,
          instances.map((row) => row.id)
        ),
        inArray(schema.FieldValue.fieldId, fieldIds)
      )
    )

  const byInstance = new Map<string, Map<string, (typeof values)[number]>>()
  for (const value of values) {
    let bucket = byInstance.get(value.entityId)
    if (!bucket) {
      bucket = new Map()
      byInstance.set(value.entityId, bucket)
    }
    bucket.set(value.fieldId, value)
  }

  const rows: BuildMovementRow[] = []
  for (const instance of instances) {
    const bucket = byInstance.get(instance.id)
    const read = (attr: BuildMovementAttribute) => {
      const id = fields[attr]?.id
      return id ? (bucket?.get(id) ?? null) : null
    }
    const partId = read('stock_movement_part')?.relatedEntityId ?? null
    const type = read('stock_movement_type')?.optionId ?? null
    const quantity = read('stock_movement_quantity')?.valueNumber ?? null
    const unitCost = read('stock_movement_unit_cost')?.valueNumber ?? null

    if (!partId || !type || quantity == null || quantity === 0 || unitCost == null) {
      // Every row a build writes carries all four. One that does not was not
      // written by `completeBuild`, and negating it would invent a cost.
      throw new UnprocessableEntityError(
        `Stock movement ${instance.id} on this build has no part, type, quantity or frozen cost and cannot be reversed`
      )
    }

    rows.push({
      movementId: instance.id,
      partId,
      type,
      quantity,
      unitCost,
      extendedCost: read('stock_movement_extended_cost')?.valueNumber ?? null,
      glAccount: read('stock_movement_gl_account')?.valueText ?? null,
      qtyPerUnit: read('stock_movement_qty_per_unit')?.valueNumber ?? null,
      costBasis: read('stock_movement_cost_basis')?.optionId ?? null,
    })
  }

  return rows
}

// ─── The component plan ─────────────────────────────────────────────────

/** What {@link planBuildComponents} needs to price a run. */
export interface BuildComponentPlanInput {
  /** `EntityInstance.id` of the `part` being produced. */
  partId: string
  quantityProduced: number
  quantityScrapped?: number
  componentOverrides?: BuildComponentOverride[]
}

/**
 * The priced component plan, with the standards a completion would freeze.
 *
 * 🛑 **`loadDirectSubparts`, never `getDeductionTargets`** (B4). The multi-level
 * walk deducts every descendant *including intermediates*, which is defensible
 * for backflush-at-sale and wrong the moment a subassembly has its own on-hand
 * balance — which is exactly what build-to-stock creates. A build consumes one
 * level; the subassembly beneath it is produced by its own build and carries its
 * own standard, so exploding through it would consume the same material twice
 * and value the run at a number no ledger can reconcile.
 *
 * Reads, never writes. `completeBuild` calls this and then refuses if
 * `missingStandardPartIds` is non-empty.
 */
export async function planBuildComponents(
  db: Database,
  organizationId: string,
  input: BuildComponentPlanInput
): Promise<BuildComponentPlan> {
  const quantityProduced = input.quantityProduced
  const quantityScrapped = input.quantityScrapped ?? 0
  const started = unitsStarted(quantityProduced, quantityScrapped)

  const edges = await loadDirectSubparts(db, organizationId, input.partId)
  const overrides = new Map<string, number>()
  for (const override of input.componentOverrides ?? []) {
    overrides.set(override.partId, override.quantityConsumed)
  }

  // BOM order first, then any off-BOM substitution, so a form renders the bill
  // of materials in its own order and the exceptions after it.
  const bomPartIds = new Set(edges.map((edge) => edge.childId))
  const planned: { partId: string; qtyPerUnit: number | null; quantityConsumed: number }[] = []

  for (const edge of edges) {
    const overridden = overrides.get(edge.childId)
    planned.push({
      partId: edge.childId,
      // The BOM edge is the AS-BUILT snapshot and survives an override: the
      // floor used a different quantity of a component that IS on the bill,
      // which is not the same claim as "this component is off-BOM".
      qtyPerUnit: edge.qty,
      quantityConsumed: overridden ?? componentConsumption(edge.qty, started),
    })
  }

  for (const [partId, quantityConsumed] of overrides) {
    if (bomPartIds.has(partId)) continue
    // NULL `qtyPerUnit` is the off-BOM marker the field exists for: a floor
    // substitution, made visible instead of silent.
    planned.push({ partId, qtyPerUnit: null, quantityConsumed })
  }

  // A zero-quantity line is dropped rather than written. A movement of zero is a
  // row in an append-only ledger that changes nothing and can never be removed;
  // `adjustStock` refuses one for the same reason.
  const lines = planned.filter((line) => line.quantityConsumed !== 0)

  const partIds = [input.partId, ...lines.map((line) => line.partId)]
  const [standards, kinds, names] = await Promise.all([
    readStandardCostMap(db, organizationId, partIds),
    readPartKinds(
      db,
      organizationId,
      lines.map((line) => line.partId)
    ),
    readPartNames(
      db,
      organizationId,
      lines.map((line) => line.partId)
    ),
  ])

  const missingStandardPartIds: string[] = []
  if (!standards.has(input.partId)) missingStandardPartIds.push(input.partId)

  const components: BuildComponentLine[] = lines.map((line) => {
    const standard = standards.get(line.partId) ?? null
    if (!standard) missingStandardPartIds.push(line.partId)
    return {
      partId: line.partId,
      partName: names.get(line.partId) ?? null,
      qtyPerUnit: line.qtyPerUnit,
      quantityConsumed: line.quantityConsumed,
      unitCost: standard?.standardCost ?? null,
      // Rounded AFTER multiplying, never as a sum of rounded units: rounding
      // first scales the error by the quantity.
      extendedCost: standard
        ? computeExtendedCost(standard.standardCost, line.quantityConsumed)
        : null,
      glAccount: resolveInventoryRoleForPartKind(kinds.get(line.partId) ?? null),
      offBom: line.qtyPerUnit == null,
    }
  })

  return {
    partId: input.partId,
    quantityProduced,
    quantityScrapped,
    unitsStarted: started,
    producedUnitCost: standards.get(input.partId)?.standardCost ?? null,
    components,
    missingStandardPartIds,
  }
}

/**
 * What a completion would consume, and at what cost, without consuming it.
 *
 * The public read behind the completion form's per-component quantity
 * overrides. It fails with nothing — a component with no standard comes back in
 * `missingStandardPartIds` so the form can name the part to go roll, rather than
 * surfacing at the moment of writing.
 */
export async function explodeBuildComponents(
  db: Database,
  organizationId: string,
  input: BuildComponentPlanInput
): Promise<Result<BuildComponentPlan, Error>> {
  return guard(
    async () => planBuildComponents(db, organizationId, input),
    'Failed to explode build components',
    { organizationId, partId: input.partId }
  )
}

/** {@link readStandardCost}, unwrapped — the plan is already inside a `guard`. */
async function readStandardCostMap(
  db: Database,
  organizationId: string,
  partIds: string[]
): Promise<Map<string, PartStandardCost>> {
  const result = await readStandardCost(db, organizationId, [...new Set(partIds)])
  if (result.isErr()) throw result.error
  return result.value
}

/** `part_kind` for several parts in one query. A part with no row reads absent. */
export async function readPartKinds(
  db: Database,
  organizationId: string,
  partIds: string[]
): Promise<Map<string, string>> {
  const kinds = new Map<string, string>()
  if (partIds.length === 0) return kinds

  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['part_kind'] as const)
  const kindField = fields.part_kind
  if (!kindField) return kinds

  const rows = await db
    .select({ entityId: schema.FieldValue.entityId, optionId: schema.FieldValue.optionId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.FieldValue.entityId, [...new Set(partIds)]),
        eq(schema.FieldValue.fieldId, kindField.id),
        isNotNull(schema.FieldValue.optionId)
      )
    )

  for (const row of rows) {
    if (row.optionId) kinds.set(row.entityId, row.optionId)
  }
  return kinds
}

/** `EntityInstance.displayName` for several parts. A plan names parts, not cuids. */
export async function readPartNames(
  db: Database,
  organizationId: string,
  partIds: string[]
): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  if (partIds.length === 0) return names

  const rows = await db
    .select({ id: schema.EntityInstance.id, displayName: schema.EntityInstance.displayName })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        inArray(schema.EntityInstance.id, [...new Set(partIds)])
      )
    )

  for (const row of rows) {
    if (row.displayName) names.set(row.id, row.displayName)
  }
  return names
}
