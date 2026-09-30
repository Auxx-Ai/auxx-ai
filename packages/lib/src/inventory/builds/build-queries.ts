// packages/lib/src/inventory/builds/build-queries.ts

/**
 * Every READ over the build event: the list and detail surfaces, the
 * transaction-only locking read the write paths open with, and
 * {@link explodeBuildComponents}, the priced component plan a completion form
 * shows before anything is written. Writes live in `build-writes.ts`.
 *
 * No permission checks anywhere in this file (`docs/lib-module-guide.md` section 6).
 */

import type { Transaction } from '@auxx/database'
import { type Database, schema } from '@auxx/database'
import { and, desc, eq, inArray, isNotNull, isNull, type SQL } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { ConflictError, NotFoundError, UnprocessableEntityError } from '../../errors'
import { batchGetRelatedDisplayNames } from '../../field-values/field-value-helpers'
import { readFieldScalars } from '../../field-values/read-field-scalars'
import { chunkArray } from '../../import/utils/chunk-array'
import { StockMovementCostBasis } from '../../resources/registry/enum-values'
import { PART_FIELDS } from '../../resources/registry/resources/part-fields'
import { pickSystemAttributes } from '../../resources/registry/system-attributes'
import { toRecordId } from '../../resources/resource-id'
import { systemDefId, systemFieldMap } from '../../resources/system-records'
import { loadDirectSubparts } from '../bom/subpart-graph'
import { loadStandardCostFields, readStandardCost } from '../costing/standard-cost-queries'
import type { AbsorptionRates, PartStandardCost } from '../costing/types'
import { computeExtendedCost, resolveInventoryRoleForPartKind } from '../movements/client'
import { readMovementsByBuilds } from '../movements/reads'
import { toBuildRecord } from './build-row'
import { type BuildStatusValue, componentConsumption, unitsStarted } from './client'
import { guard } from './guard'
import type {
  BuildComponentLine,
  BuildComponentOverride,
  BuildComponentPlan,
  BuildMovementRow,
  BuildRecord,
  ListBuildsFilters,
} from './types'

type Db = Database | Transaction

const DEFAULT_LIMIT = 50
const ID_CHUNK = 1000

// ─── Detail and list ────────────────────────────────────────────────────

/** One build, or `null` when it does not exist or is another org's. */
export async function getBuild(
  db: Database,
  organizationId: string,
  buildId: string
): Promise<Result<BuildRecord | null, Error>> {
  return guard(
    async () => (await readBuild(db, organizationId, buildId)) ?? null,
    'Failed to read build',
    { organizationId, buildId }
  )
}

/**
 * List builds, newest first, filtered and paged in SQL. Ordered on `createdAt`, not
 * `completedAt`: a planned build has no completion date.
 */
export async function listBuilds(
  db: Database,
  organizationId: string,
  filters: ListBuildsFilters = {}
): Promise<Result<BuildRecord[], Error>> {
  return guard(async () => queryBuilds(db, organizationId, filters), 'Failed to list builds', {
    organizationId,
    filters,
  })
}

/** Completed builds with no `postedAt`. A convenience column; the GL posting is the authority. */
export async function listUnpostedBuilds(
  db: Database,
  organizationId: string,
  filters: Pick<ListBuildsFilters, 'limit' | 'offset'> = {}
): Promise<Result<BuildRecord[], Error>> {
  return guard(
    async () =>
      queryBuilds(
        db,
        organizationId,
        { ...filters, status: 'completed' },
        isNull(schema.Build.postedAt)
      ),
    'Failed to list unposted builds',
    { organizationId }
  )
}

async function queryBuilds(
  db: Db,
  organizationId: string,
  filters: ListBuildsFilters,
  extra?: SQL
): Promise<BuildRecord[]> {
  const t = schema.Build
  const where: Array<SQL | undefined> = [
    eq(t.organizationId, organizationId),
    filters.status ? eq(t.status, filters.status) : undefined,
    filters.source ? eq(t.source, filters.source) : undefined,
    filters.partId ? eq(t.partId, filters.partId) : undefined,
    filters.orderId ? eq(t.orderId, filters.orderId) : undefined,
    filters.batchRun !== undefined ? eq(t.batchRun, filters.batchRun) : undefined,
    extra,
  ]
  const rows = await db
    .select()
    .from(t)
    .where(and(...where))
    .orderBy(desc(t.createdAt), desc(t.id))
    .limit(filters.limit ?? DEFAULT_LIMIT)
    .offset(filters.offset ?? 0)
  return rows.map(toBuildRecord)
}

/** One build by id, unwrapped, on a pool or a transaction; `undefined` when absent. */
export async function readBuild(
  db: Db,
  organizationId: string,
  buildId: string
): Promise<BuildRecord | undefined> {
  const [row] = await db
    .select()
    .from(schema.Build)
    .where(and(eq(schema.Build.organizationId, organizationId), eq(schema.Build.id, buildId)))
  return row ? toBuildRecord(row) : undefined
}

/** Builds by id, chunked; ids that do not exist are simply absent. Order is not the input's. */
export async function readBuildsByIds(
  db: Db,
  organizationId: string,
  buildIds: readonly string[]
): Promise<BuildRecord[]> {
  const out: BuildRecord[] = []
  for (const chunk of chunkArray([...new Set(buildIds)], ID_CHUNK)) {
    const rows = await db
      .select()
      .from(schema.Build)
      .where(and(eq(schema.Build.organizationId, organizationId), inArray(schema.Build.id, chunk)))
    out.push(...rows.map(toBuildRecord))
  }
  return out
}

// ─── The transaction-only reads ─────────────────────────────────────────

/**
 * Re-read a build `FOR UPDATE` inside the caller's transaction. This lock is B8's whole
 * enforcement: two concurrent completions serialise here and the loser sees the winner's status.
 */
export async function lockBuild(
  tx: Transaction,
  organizationId: string,
  buildId: string
): Promise<BuildRecord> {
  const [row] = await tx
    .select()
    .from(schema.Build)
    .where(and(eq(schema.Build.organizationId, organizationId), eq(schema.Build.id, buildId)))
    .for('update')
  if (!row) throw new NotFoundError(`Build ${buildId} not found`)
  return toBuildRecord(row)
}

/** Assert a build is in one of the statuses an action accepts, else `ConflictError`. */
export function assertBuildStatus(
  build: BuildRecord,
  allowed: (status: BuildStatusValue | null) => boolean,
  message: string
): void {
  if (!allowed(build.status)) throw new ConflictError(message)
}

/**
 * Whether a reversal already points at this build. A friendly pre-check only: the unique index
 * `Build_reversalOfBuildId_key` is the guard, and `insertBuilds` turns its violation into a 409.
 */
export async function hasBuildReversal(
  db: Db,
  organizationId: string,
  buildId: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.Build.id })
    .from(schema.Build)
    .where(
      and(
        eq(schema.Build.organizationId, organizationId),
        eq(schema.Build.reversalOfBuildId, buildId)
      )
    )
    .limit(1)
  return !!row
}

/** The build that reverses `buildId`, or `undefined` when it has not been reversed. */
export async function readBuildReversal(
  db: Db,
  organizationId: string,
  buildId: string
): Promise<BuildRecord | undefined> {
  const [row] = await db
    .select()
    .from(schema.Build)
    .where(
      and(
        eq(schema.Build.organizationId, organizationId),
        eq(schema.Build.reversalOfBuildId, buildId)
      )
    )
    .limit(1)
  return row ? toBuildRecord(row) : undefined
}

/**
 * Every movement this build wrote, with its FROZEN costs. They come back verbatim and are never
 * re-priced: a reversal valued at today's standard nets a build and its undo to non-zero (B6).
 */
export async function readBuildMovements(
  db: Database | Transaction,
  organizationId: string,
  buildId: string
): Promise<BuildMovementRow[]> {
  const movements = await readMovementsByBuilds(db, organizationId, [buildId])
  return movements.map((movement) => {
    const pending = movement.costBasis === StockMovementCostBasis.PENDING
    if (movement.quantity === 0 || (movement.unitCostMinor == null && !pending)) {
      // Not written by `completeBuild`; negating it would invent a cost.
      throw new UnprocessableEntityError(
        `Stock movement ${movement.id} on this build has no quantity or frozen cost and cannot be reversed`
      )
    }
    return {
      movementId: movement.id,
      partId: movement.partId,
      type: movement.type,
      quantity: movement.quantity,
      unitCost: pending ? null : movement.unitCostMinor,
      extendedCost: pending ? null : movement.extendedCostMinor,
      glRole: movement.glRole,
      qtyPerUnit: movement.qtyPerUnit,
      costBasis: movement.costBasis,
    }
  })
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
  const edges = await loadDirectSubparts(db, organizationId, input.partId)
  const lines = planComponentLines(input, edges)
  const componentIds = lines.map((line) => line.partId)
  const [standards, kinds, names] = await Promise.all([
    readStandardCostMap(db, organizationId, [input.partId, ...componentIds]),
    readPartKinds(db, organizationId, componentIds),
    readPartNames(db, organizationId, componentIds),
  ])
  return priceComponentPlan(input, lines, { standards, kinds, names })
}

/** One BOM line of a run before it is priced. */
export interface PlannedComponentLine {
  partId: string
  qtyPerUnit: number | null
  quantityConsumed: number
}

/** What pricing a plan reads, keyed by part id; a batch loads it once for many plans. */
export interface ComponentPlanLookups {
  standards: ReadonlyMap<string, PartStandardCost>
  kinds: ReadonlyMap<string, string>
  names: ReadonlyMap<string, string>
}

/** The run's BOM lines from its direct edges and overrides; zero-quantity lines are dropped. */
export function planComponentLines(
  input: BuildComponentPlanInput,
  edges: ReadonlyArray<{ childId: string; qty: number }>
): PlannedComponentLine[] {
  const started = unitsStarted(input.quantityProduced, input.quantityScrapped ?? 0)
  const overrides = new Map<string, number>()
  for (const override of input.componentOverrides ?? []) {
    overrides.set(override.partId, override.quantityConsumed)
  }

  // BOM order first, then any off-BOM substitution, so a form renders the bill
  // of materials in its own order and the exceptions after it.
  const bomPartIds = new Set(edges.map((edge) => edge.childId))
  const planned: PlannedComponentLine[] = []

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
  return planned.filter((line) => line.quantityConsumed !== 0)
}

/** The priced plan from its lines and the standards, kinds and names they read. */
export function priceComponentPlan(
  input: BuildComponentPlanInput,
  lines: readonly PlannedComponentLine[],
  lookups: ComponentPlanLookups
): BuildComponentPlan {
  const quantityProduced = input.quantityProduced
  const quantityScrapped = input.quantityScrapped ?? 0
  const { standards, kinds, names } = lookups

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
      glRole: resolveInventoryRoleForPartKind(kinds.get(line.partId) ?? null),
      offBom: line.qtyPerUnit == null,
    }
  })

  return {
    partId: input.partId,
    quantityProduced,
    quantityScrapped,
    unitsStarted: unitsStarted(quantityProduced, quantityScrapped),
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
export async function readStandardCostMap(
  db: Database,
  organizationId: string,
  partIds: string[]
): Promise<Map<string, PartStandardCost>> {
  const result = await readStandardCost(db, organizationId, [...new Set(partIds)])
  if (result.isErr()) throw result.error
  return result.value
}

/**
 * `part_kind` for several parts in ONE query. A part with no row reads absent.
 *
 * Deliberately not on `readSystemRecords`: the part ids come off BOM edges and
 * movement rows, and this must answer for an ARCHIVED part too — the reader
 * scopes to live instances of the def and would cost a second query to do it.
 */
export async function readPartKinds(
  db: Database,
  organizationId: string,
  partIds: string[]
): Promise<Map<string, string>> {
  const kinds = new Map<string, string>()
  if (partIds.length === 0) return kinds

  // The org cache even inside a transaction: only the long-lived field's id is read, and a
  // build completion calls this several times.
  const fields = await systemFieldMap(
    undefined,
    organizationId,
    pickSystemAttributes(PART_FIELDS, ['part_kind'] as const)
  )
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

  const partDefId = await systemDefId(db, organizationId, 'part')
  if (!partDefId) return names

  const displayNames = await batchGetRelatedDisplayNames(
    db,
    organizationId,
    [...new Set(partIds)].map((partId) => toRecordId(partDefId, partId))
  )
  for (const [partId, displayName] of displayNames) {
    if (displayName) names.set(partId, displayName)
  }
  return names
}

/** `loadPartAbsorptionRates` for several parts in one query; a part with no row reads both null. */
export async function readAbsorptionRates(
  db: Database,
  organizationId: string,
  partIds: string[]
): Promise<Map<string, AbsorptionRates>> {
  const rates = new Map<string, AbsorptionRates>(
    partIds.map((partId) => [partId, { laborCostPerUnit: null, overheadCostPerUnit: null }])
  )
  const fields = await loadStandardCostFields(organizationId)
  const fieldIds = [fields.laborRate?.id, fields.overheadRate?.id].filter((id): id is string =>
    Boolean(id)
  )
  if (fieldIds.length === 0 || partIds.length === 0) return rates

  const scalars = await readFieldScalars(db, organizationId, partIds, fieldIds)
  const num = (value: unknown) => (typeof value === 'number' ? value : null)
  for (const [partId, byField] of scalars) {
    const part = rates.get(partId)
    if (!part) continue
    if (fields.laborRate) part.laborCostPerUnit = num(byField.get(fields.laborRate.id))
    if (fields.overheadRate) part.overheadCostPerUnit = num(byField.get(fields.overheadRate.id))
  }
  return rates
}
