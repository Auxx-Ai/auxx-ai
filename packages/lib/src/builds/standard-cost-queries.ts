// packages/lib/src/builds/standard-cost-queries.ts

/**
 * Every READ the standard-cost roll needs, plus the two read-only public
 * surfaces: {@link previewStandardCostRoll} and {@link readStandardCost}.
 *
 * Split from `standard-cost.ts` because that file writes — a module where one
 * file both queries and mutates is the first step back toward a service class
 * (`docs/lib-module-guide.md` section 5).
 *
 * No permission checks anywhere in this file. The router asserts
 * (`docs/lib-module-guide.md` section 6).
 */

import { type Database, schema } from '@auxx/database'
import type { CustomFieldEntity } from '@auxx/database/types'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { buildParentGraph, buildSubpartGraph, loadOrgPricingData } from '../bom/cost-calculator'
import { getOrgCache, requireCachedEntityDefId } from '../cache'
import { UnprocessableEntityError } from '../errors'
import { getOrganizationSetting } from '../settings/settings-service'
import { type PartKindValue, resolvePartKind } from './client'
import { guard } from './guard'
import {
  computeStandardCosts,
  type StandardCostRollComputation,
  type SubpartEdge,
  widenToAncestors,
  widenToUnvaluedDescendants,
} from './standard-cost-roll'
import type {
  AbsorptionRates,
  PartStandardCost,
  RollStandardCostInput,
  StandardCostRollLine,
  StandardCostRollPlan,
} from './types'

/** The five fields entity migration 109 added, plus the three the roll reads. */
const ROLL_ATTRIBUTES = [
  'part_kind',
  'part_cost',
  'part_quantity_on_hand',
  'part_standard_material_cost',
  'part_standard_labor_cost',
  'part_standard_overhead_cost',
  'part_standard_cost',
  'part_standard_cost_effective_at',
] as const

/** The five `part_standard_*` fields the roll owns. `rollStandardCost` is their only writer. */
export interface StandardCostFields {
  material: CustomFieldEntity
  labor: CustomFieldEntity
  overhead: CustomFieldEntity
  standard: CustomFieldEntity
  effectiveAt: CustomFieldEntity
  /** Read-only inputs. Absent on an org whose earlier migrations have not run. */
  partKind: CustomFieldEntity | null
  liveCost: CustomFieldEntity | null
  quantityOnHand: CustomFieldEntity | null
}

/**
 * Resolve the fields the roll reads and writes, or refuse.
 *
 * The five `part_standard_*` fields are REQUIRED: without them the roll would
 * appear to succeed and freeze nothing, which is worse than a clear refusal.
 * The three inputs are optional — an org missing `part_kind` simply reads every
 * part as a `component`, which is the documented NULL behaviour anyway.
 */
export async function loadStandardCostFields(organizationId: string): Promise<StandardCostFields> {
  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...ROLL_ATTRIBUTES])

  const material = fields.part_standard_material_cost
  const labor = fields.part_standard_labor_cost
  const overhead = fields.part_standard_overhead_cost
  const standard = fields.part_standard_cost
  const effectiveAt = fields.part_standard_cost_effective_at

  if (!material || !labor || !overhead || !standard || !effectiveAt) {
    throw new UnprocessableEntityError(
      'Standard cost is not available until the part standard cost fields are provisioned'
    )
  }

  return {
    material,
    labor,
    overhead,
    standard,
    effectiveAt,
    partKind: fields.part_kind,
    liveCost: fields.part_cost,
    quantityOnHand: fields.part_quantity_on_hand,
  }
}

/**
 * The two `manufacturing.*` absorption rates.
 *
 * 🛑 They ship unset, and a `null` here must never collapse to `0` — the two are
 * numerically indistinguishable once summed, so the distinction is kept in the
 * type and carried into storage. See {@link absorbedRate}.
 */
export async function loadAbsorptionRates(organizationId: string): Promise<AbsorptionRates> {
  const [labor, overhead] = await Promise.all([
    getOrganizationSetting({ organizationId, key: 'manufacturing.assemblyLaborCostPerUnit' }),
    getOrganizationSetting({ organizationId, key: 'manufacturing.overheadCostPerUnit' }),
  ])
  return {
    laborCostPerUnit: typeof labor === 'number' ? labor : null,
    overheadCostPerUnit: typeof overhead === 'number' ? overhead : null,
  }
}

/** Every non-archived `part` in the org, with the name error messages use. */
async function loadPartRows(
  db: Database,
  organizationId: string,
  partDefId: string
): Promise<{ id: string; displayName: string | null }[]> {
  return db
    .select({ id: schema.EntityInstance.id, displayName: schema.EntityInstance.displayName })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, partDefId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
}

/** Every stored value of every field the roll touches, in one query. */
export interface StoredPartValues {
  partKinds: Map<string, PartKindValue>
  liveCosts: Map<string, number>
  quantitiesOnHand: Map<string, number>
  standardMaterialCosts: Map<string, number>
  standardLaborCosts: Map<string, number>
  standardOverheadCosts: Map<string, number>
  standardCosts: Map<string, number>
  effectiveDates: Map<string, string>
}

async function loadStoredPartValues(
  db: Database,
  organizationId: string,
  fields: StandardCostFields
): Promise<StoredPartValues> {
  const values: StoredPartValues = {
    partKinds: new Map(),
    liveCosts: new Map(),
    quantitiesOnHand: new Map(),
    standardMaterialCosts: new Map(),
    standardLaborCosts: new Map(),
    standardOverheadCosts: new Map(),
    standardCosts: new Map(),
    effectiveDates: new Map(),
  }

  const fieldIds = [
    fields.partKind?.id,
    fields.liveCost?.id,
    fields.quantityOnHand?.id,
    fields.material.id,
    fields.labor.id,
    fields.overhead.id,
    fields.standard.id,
    fields.effectiveAt.id,
  ].filter((id): id is string => Boolean(id))

  const rows = await db
    .select({
      entityId: schema.FieldValue.entityId,
      fieldId: schema.FieldValue.fieldId,
      valueNumber: schema.FieldValue.valueNumber,
      valueDate: schema.FieldValue.valueDate,
      optionId: schema.FieldValue.optionId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        inArray(schema.FieldValue.fieldId, fieldIds),
        eq(schema.FieldValue.organizationId, organizationId)
      )
    )

  for (const row of rows) {
    if (fields.partKind && row.fieldId === fields.partKind.id) {
      // A SINGLE_SELECT lives in `optionId` — the registry's option rows carry
      // no id, so the stored key is the raw option value.
      values.partKinds.set(row.entityId, resolvePartKind(row.optionId))
    } else if (fields.liveCost && row.fieldId === fields.liveCost.id) {
      if (row.valueNumber != null) values.liveCosts.set(row.entityId, row.valueNumber)
    } else if (fields.quantityOnHand && row.fieldId === fields.quantityOnHand.id) {
      if (row.valueNumber != null) values.quantitiesOnHand.set(row.entityId, row.valueNumber)
    } else if (row.fieldId === fields.material.id) {
      if (row.valueNumber != null) values.standardMaterialCosts.set(row.entityId, row.valueNumber)
    } else if (row.fieldId === fields.labor.id) {
      if (row.valueNumber != null) values.standardLaborCosts.set(row.entityId, row.valueNumber)
    } else if (row.fieldId === fields.overhead.id) {
      if (row.valueNumber != null) values.standardOverheadCosts.set(row.entityId, row.valueNumber)
    } else if (row.fieldId === fields.standard.id) {
      if (row.valueNumber != null) values.standardCosts.set(row.entityId, row.valueNumber)
    } else if (row.fieldId === fields.effectiveAt.id) {
      if (row.valueDate != null) values.effectiveDates.set(row.entityId, row.valueDate)
    }
  }

  return values
}

/** Everything `rollStandardCost` needs to turn a plan into writes. */
export interface StandardCostRollContext {
  partDefId: string
  fields: StandardCostFields
  plan: StandardCostRollPlan
  stored: StoredPartValues
  computation: StandardCostRollComputation
  /**
   * Every non-archived `part` in the org.
   *
   * Exposed so a caller writing a FIRST standard outside the plan (see
   * `ensureStandardCost`) can tell "this id does not exist" from "this id has
   * no cost", without a second round trip.
   */
  allPartIds: Set<string>
}

/**
 * Build the plan: what a roll WOULD write, and what it would do to the balance
 * sheet.
 *
 * 🛑 **Reads only.** `rollStandardCost` refreshes `part_cost` before calling
 * this; the preview deliberately does not, so a preview never writes. In
 * practice `part_cost` is already current — `recalculateAffectedParts` rewrites
 * it on every vendor-price and bill-of-materials change — and the refresh in the
 * roll is a repair step, not the source of the number.
 */
export async function planStandardCostRoll(
  db: Database,
  organizationId: string,
  input: RollStandardCostInput
): Promise<StandardCostRollContext> {
  const partDefId = await requireCachedEntityDefId(organizationId, 'part')
  const fields = await loadStandardCostFields(organizationId)
  const [rates, partRows, stored, pricing] = await Promise.all([
    loadAbsorptionRates(organizationId),
    loadPartRows(db, organizationId, partDefId),
    loadStoredPartValues(db, organizationId, fields),
    loadOrgPricingData(organizationId),
  ])

  const allPartIds = new Set(partRows.map((row) => row.id))
  // Only real names go in: `computeStandardCosts` falls back to the id for an
  // error message, and a report would rather say "unnamed" than echo a cuid.
  const partNames = new Map<string, string>()
  for (const row of partRows) {
    if (row.displayName) partNames.set(row.id, row.displayName)
  }

  const subpartGraph: ReadonlyMap<string, SubpartEdge[]> = buildSubpartGraph(pricing.subparts)
  const parentGraph = buildParentGraph(pricing.subparts)

  // Scoped -> widen UP to every ancestor, then DOWN to the descendants of that
  // widened set that have no stored standard, then intersect with the parts that
  // actually exist, so a stale id from the caller cannot invent a write target.
  //
  // The downward half is not symmetric with the upward half: it takes only the
  // parts with nothing to re-value (`widenToUnvaluedDescendants`). It is also
  // computed from the ANCESTOR-widened set rather than from `requested`,
  // because an ancestor pulled in by the upward walk has its own unvalued
  // children, and leaving those out reproduces the same abort one level up.
  const requested = input.partIds?.filter((id) => allPartIds.has(id)) ?? []
  let scope: Set<string>
  if (input.partIds && input.partIds.length > 0) {
    const upward = widenToAncestors(requested, parentGraph)
    const downward = widenToUnvaluedDescendants(upward, subpartGraph, stored.standardCosts)
    scope = new Set([...upward, ...downward].filter((id) => allPartIds.has(id)))
  } else {
    scope = allPartIds
  }

  const computation = computeStandardCosts({
    scope,
    partKinds: stored.partKinds,
    liveCosts: stored.liveCosts,
    subpartGraph,
    storedStandardCosts: stored.standardCosts,
    rates,
    partNames,
  })

  const effectiveAtIso = input.effectiveAt.toISOString()
  const lines: StandardCostRollLine[] = []
  let revaluationDelta = 0
  let initialValue = 0

  // `computation.order` is the bottom-up walk order, so a caller rendering the
  // plan sees components before the assemblies built from them.
  for (const partId of computation.order) {
    const next = computation.costs.get(partId)
    if (!next) continue

    const previousStandardCost = stored.standardCosts.get(partId) ?? null
    const quantityOnHand = stored.quantitiesOnHand.get(partId) ?? 0
    const isInitial = previousStandardCost == null
    const lineDelta = isInitial ? 0 : (next.standardCost - previousStandardCost) * quantityOnHand
    const lineInitial = isInitial ? next.standardCost * quantityOnHand : 0

    revaluationDelta += lineDelta
    initialValue += lineInitial

    lines.push({
      partId,
      partName: partNames.get(partId) ?? null,
      partKind: stored.partKinds.get(partId) ?? 'component',
      ...next,
      previousStandardCost,
      quantityOnHand,
      revaluationDelta: lineDelta,
      isInitial,
      initialValue: lineInitial,
      changed:
        next.standardMaterialCost !== (stored.standardMaterialCosts.get(partId) ?? null) ||
        next.standardLaborCost !== (stored.standardLaborCosts.get(partId) ?? null) ||
        next.standardOverheadCost !== (stored.standardOverheadCosts.get(partId) ?? null) ||
        next.standardCost !== previousStandardCost ||
        stored.effectiveDates.get(partId) == null,
    })
  }

  return {
    partDefId,
    fields,
    stored,
    computation,
    allPartIds,
    plan: {
      effectiveAt: new Date(effectiveAtIso),
      rates,
      lines,
      revaluationDelta,
      initialValue,
      skipped: computation.skipped,
    },
  }
}

/**
 * What a roll would do, without doing it.
 *
 * 🛑 **The preview is the point** (section 2.4). A roll restates the balance
 * sheet, so it must never be a button that just fires: this returns the
 * revaluation delta per part and summed, so a person can see the effect before
 * committing to it.
 *
 * It fails with the same `UnprocessableEntityError` the roll would, so an
 * unpriced component surfaces here rather than half-way through a write.
 */
export async function previewStandardCostRoll(
  db: Database,
  organizationId: string,
  input: RollStandardCostInput
): Promise<Result<StandardCostRollPlan, Error>> {
  return guard(
    async () => (await planStandardCostRoll(db, organizationId, input)).plan,
    'Failed to preview standard cost roll',
    { organizationId, partIds: input.partIds?.length ?? 'all' }
  )
}

/**
 * The batch read `completeBuild` uses: the frozen standard for these parts.
 *
 * Returns an entry ONLY for a part that has a `part_standard_cost`. A part
 * missing from the map has never been rolled, and the caller must treat that as
 * a refusal — never as a zero. `completeBuild`'s "never post a zero cost" rule
 * is the same rule stated from the other side.
 */
export async function readStandardCost(
  db: Database,
  organizationId: string,
  partIds: string[]
): Promise<Result<Map<string, PartStandardCost>, Error>> {
  return guard(
    async () => {
      const result = new Map<string, PartStandardCost>()
      if (partIds.length === 0) return result

      const fields = await loadStandardCostFields(organizationId)
      type NumericKey =
        | 'standardMaterialCost'
        | 'standardLaborCost'
        | 'standardOverheadCost'
        | 'standardCost'
      const byField = new Map<string, NumericKey | 'effectiveAt'>([
        [fields.material.id, 'standardMaterialCost'],
        [fields.labor.id, 'standardLaborCost'],
        [fields.overhead.id, 'standardOverheadCost'],
        [fields.standard.id, 'standardCost'],
        [fields.effectiveAt.id, 'effectiveAt'],
      ])

      const rows = await db
        .select({
          entityId: schema.FieldValue.entityId,
          fieldId: schema.FieldValue.fieldId,
          valueNumber: schema.FieldValue.valueNumber,
          valueDate: schema.FieldValue.valueDate,
        })
        .from(schema.FieldValue)
        .where(
          and(
            eq(schema.FieldValue.organizationId, organizationId),
            inArray(schema.FieldValue.entityId, partIds),
            inArray(schema.FieldValue.fieldId, [...byField.keys()])
          )
        )

      const draft = new Map<string, Partial<PartStandardCost>>()
      for (const row of rows) {
        const key = byField.get(row.fieldId)
        if (!key) continue
        const entry = draft.get(row.entityId) ?? {}
        if (key === 'effectiveAt') {
          entry.effectiveAt = row.valueDate ? new Date(row.valueDate) : null
        } else if (row.valueNumber != null) {
          entry[key] = row.valueNumber
        }
        draft.set(row.entityId, entry)
      }

      for (const [partId, entry] of draft) {
        // No `standardCost` means the part has never been rolled. It is omitted
        // rather than defaulted, so a caller cannot mistake absence for zero.
        if (entry.standardCost == null) continue
        result.set(partId, {
          partId,
          standardMaterialCost: entry.standardMaterialCost ?? entry.standardCost,
          standardLaborCost: entry.standardLaborCost ?? null,
          standardOverheadCost: entry.standardOverheadCost ?? null,
          standardCost: entry.standardCost,
          effectiveAt: entry.effectiveAt ?? null,
        })
      }

      return result
    },
    'Failed to read standard costs',
    { organizationId, partCount: partIds.length }
  )
}

/**
 * The minimum a caller needs to write a FIRST standard cost onto a part
 * without planning a roll at all.
 *
 * {@link planStandardCostRoll} returns a superset of this, so the happy path
 * never calls it. It exists for the one case that matters at the doors in
 * plans/money/tasks/15-costing-usability.md section 2: a part created with
 * opening stock, or received for the first time, carries an EXPLICIT unit cost,
 * and that number must still be frozen even when planning the roll around it
 * aborts (an unpriced sibling under a shared parent is enough to abort it).
 */
export interface StandardCostWriteContext {
  partDefId: string
  fields: StandardCostFields
  /** Every non-archived `part`. An id outside this set is stale and never written. */
  allPartIds: Set<string>
  /** `part_standard_cost` as stored. Absence is the NULL that makes a part writable. */
  standardCosts: ReadonlyMap<string, number>
}

/** Load {@link StandardCostWriteContext}. Reads only. */
export async function loadStandardCostWriteContext(
  db: Database,
  organizationId: string
): Promise<StandardCostWriteContext> {
  const partDefId = await requireCachedEntityDefId(organizationId, 'part')
  const fields = await loadStandardCostFields(organizationId)
  const [partRows, stored] = await Promise.all([
    loadPartRows(db, organizationId, partDefId),
    loadStoredPartValues(db, organizationId, fields),
  ])
  return {
    partDefId,
    fields,
    allPartIds: new Set(partRows.map((row) => row.id)),
    standardCosts: stored.standardCosts,
  }
}
