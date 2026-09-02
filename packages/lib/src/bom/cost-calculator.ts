// packages/lib/src/bom/cost-calculator.ts

import { database, schema } from '@auxx/database'
import type { CustomFieldEntity } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { buildFieldValueKey, type FieldId } from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'
import { toRecordId } from '@auxx/types/resource'
import { RATE_DECIMALS, roundMinor } from '@auxx/utils/currency'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { getOrgCache, requireCachedEntityDefId } from '../cache'
import { toFieldType } from '../field-values/stored-field-type'
import {
  type FieldValueUpdateEntry,
  getRealtimeService,
  publishFieldValueUpdates,
} from '../realtime'
import { type CostWrite, writeCostValues } from './cost-writer'
import { loadTariffSchedule, readBookTimeZone } from './tariff-schedule'
import {
  computeLandedCost,
  resolveOfferTariff,
  selectWinningVendor,
  type VendorCostRow,
} from './vendor-cost'

const logger = createScopedLogger('bom:cost-calculator')

// ─── Types ───────────────────────────────────────────────────────────

/**
 * A `vendor_part` row as the calculator sees it.
 *
 * Extends the shared {@link VendorCostRow} — which carries the offer's own
 * `id` and its four cost components — with the PART the offer is for, which is
 * the calculator's grouping key and means nothing to the pure winner rule.
 */
interface VendorPriceRow extends VendorCostRow {
  partInstanceId: string
}

interface VendorCostMaps {
  landedCostMap: Map<string, number>
}

interface SubpartRow {
  parentPartId: string
  childPartId: string
  quantity: number
}

interface OrgPricingData {
  vendorPrices: VendorPriceRow[]
  subparts: SubpartRow[]
}

/**
 * Which of the two stored numbers `part_cost` took. Mirrors `CostSource` in
 * `resources/registry/enum-values.ts` — the option keyspace is the raw `value`
 * string, because those option rows carry no `id` (see `optionKey`).
 */
type CostSourceValue = 'vendor' | 'bom' | 'none'

/**
 * One part's costs, with provenance.
 *
 * `purchaseCost` and `rollupCost` are the two candidate numbers; `cost` is the
 * one that won and `source` names it. Crucially `rollupCost` is recorded EVEN
 * WHEN a vendor wins — that is the whole buy-vs-build comparison, and storing
 * only the winner is what made "is this assembly cheaper to build?" unaskable.
 */
interface PartCostResult {
  cost: number | null
  purchaseCost: number | null
  rollupCost: number | null
  source: CostSourceValue
  /**
   * The parts to go price, when this one has no roll-up.
   *
   * A blank cost provokes exactly one question — *which component is missing a
   * price?* — and neither `cost: null` nor `source: 'none'` answers it. This
   * does.
   *
   * **The TRANSITIVE set of unpriced LEAVES, not the direct children.** A leaf
   * here is a part with neither a vendor price nor a bill of materials of its
   * own: the thing a human actually has to go add a supplier to. Naming the
   * intermediate subassembly instead would point at a part that is not itself
   * fixable — its cost is missing only because something below it is.
   *
   * **Descendants only — never the part itself.** An unpriced leaf reports an
   * empty set; its own `source: 'none'` already says it is the unpriced thing,
   * and repeating that as its own descendant reads as nonsense in a UI.
   *
   * **Populated even when the part IS costed**, if its roll-up is not. A part
   * bought from a vendor whose bill of materials is incomplete has a `cost` but
   * a null `rollupCost`; this is what explains the missing buy-vs-build number.
   *
   * **Derived, never persisted.** It is unbounded in length and would be a
   * fifth denormalized value to keep from going stale — the exact failure this
   * whole plan exists to stop. It rides on the in-memory return value only.
   *
   * Empty (and shared) when there is nothing to report.
   */
  unpricedDescendantIds: readonly string[]
}

/** Shared empty set — never mutated, so it is safe to hand out repeatedly. */
const NO_UNPRICED: readonly string[] = Object.freeze([])

/**
 * A part with no vendor price and no bill of materials.
 *
 * Not `cost: 0`. An unpriced part reporting a confident $0.00 is worse than a
 * blank: it rolls silently up into every assembly above it and a zero-cost COGS
 * posting is exactly what the build-event costing rules forbid.
 */
const UNCOSTED: PartCostResult = {
  cost: null,
  purchaseCost: null,
  rollupCost: null,
  source: 'none',
  unpricedDescendantIds: NO_UNPRICED,
}

// ─── Data Loading ────────────────────────────────────────────────────

/**
 * Load all vendor part and subpart pricing data for an organization.
 * Uses entity system (EntityInstance + FieldValue) instead of legacy tables.
 * Two queries: one for vendor parts, one for subparts.
 */
async function loadOrgPricingData(orgId: string): Promise<OrgPricingData> {
  const cache = getOrgCache()

  // Resolve entity definition IDs for vendor_part and subpart
  const vendorPartDefId = await requireCachedEntityDefId(orgId, 'vendor_part')
  const subpartDefId = await requireCachedEntityDefId(orgId, 'subpart')

  logger.info('Loading org pricing data', { orgId, vendorPartDefId, subpartDefId })

  // Resolve custom field IDs by systemAttribute (single pass)
  const cfFields = await cache
    .from(orgId, 'customFields')
    .bySystemAttributes([
      'vendor_part_part',
      'vendor_part_unit_price',
      'vendor_part_is_preferred',
      'vendor_part_shipping_cost',
      'vendor_part_tariff_rate',
      'vendor_part_tariff_code',
      'vendor_part_other_cost',
      'subpart_parent_part',
      'subpart_child_part',
      'subpart_quantity',
    ] as const)

  const vpPartField = cfFields.vendor_part_part
  const vpPriceField = cfFields.vendor_part_unit_price
  const vpPreferredField = cfFields.vendor_part_is_preferred
  const vpShippingField = cfFields.vendor_part_shipping_cost
  const vpTariffField = cfFields.vendor_part_tariff_rate
  const vpTariffCodeField = cfFields.vendor_part_tariff_code
  const vpOtherField = cfFields.vendor_part_other_cost
  const spParentField = cfFields.subpart_parent_part
  const spChildField = cfFields.subpart_child_part
  const spQtyField = cfFields.subpart_quantity

  logger.info('Resolved custom field IDs', {
    vpPartField: vpPartField?.id ?? null,
    vpPriceField: vpPriceField?.id ?? null,
    vpPreferredField: vpPreferredField?.id ?? null,
    vpShippingField: vpShippingField?.id ?? null,
    vpTariffField: vpTariffField?.id ?? null,
    vpOtherField: vpOtherField?.id ?? null,
    spParentField: spParentField?.id ?? null,
    spChildField: spChildField?.id ?? null,
    spQtyField: spQtyField?.id ?? null,
  })

  // ── Query 1: All vendor part field values (single JOIN) ──
  const vendorPrices: VendorPriceRow[] = []

  if (vpPartField && vpPriceField && vpPreferredField) {
    const rows = await database
      .select({
        instanceId: schema.EntityInstance.id,
        fieldId: schema.FieldValue.fieldId,
        valueNumber: schema.FieldValue.valueNumber,
        valueBoolean: schema.FieldValue.valueBoolean,
        relatedEntityId: schema.FieldValue.relatedEntityId,
      })
      .from(schema.EntityInstance)
      .innerJoin(
        schema.FieldValue,
        and(
          eq(schema.FieldValue.entityId, schema.EntityInstance.id),
          eq(schema.FieldValue.organizationId, schema.EntityInstance.organizationId)
        )
      )
      .where(
        and(
          eq(schema.EntityInstance.organizationId, orgId),
          eq(schema.EntityInstance.entityDefinitionId, vendorPartDefId),
          isNull(schema.EntityInstance.archivedAt)
        )
      )

    // Group by instance and extract relevant fields
    const byInstance = new Map<
      string,
      {
        partInstanceId: string | null
        unitPrice: number | null
        shippingCost: number | null
        tariffRate: number | null
        tariffCodeId: string | null
        otherCost: number | null
        isPreferred: boolean
      }
    >()

    for (const row of rows) {
      if (!byInstance.has(row.instanceId)) {
        byInstance.set(row.instanceId, {
          partInstanceId: null,
          unitPrice: null,
          shippingCost: null,
          tariffRate: null,
          tariffCodeId: null,
          otherCost: null,
          isPreferred: false,
        })
      }
      const entry = byInstance.get(row.instanceId)!
      if (row.fieldId === vpPartField.id) {
        entry.partInstanceId = row.relatedEntityId
      } else if (row.fieldId === vpPriceField.id) {
        entry.unitPrice = row.valueNumber
      } else if (row.fieldId === vpPreferredField.id) {
        entry.isPreferred = row.valueBoolean ?? false
      } else if (vpShippingField && row.fieldId === vpShippingField.id) {
        entry.shippingCost = row.valueNumber
      } else if (vpTariffField && row.fieldId === vpTariffField.id) {
        entry.tariffRate = row.valueNumber
      } else if (vpTariffCodeField && row.fieldId === vpTariffCodeField.id) {
        entry.tariffCodeId = row.relatedEntityId
      } else if (vpOtherField && row.fieldId === vpOtherField.id) {
        entry.otherCost = row.valueNumber
      }
    }

    // The schedule half of 29 §3.1: an offer with NO override and a tariff code
    // takes its rate from the code's dated rows, resolved at NOW in the book
    // timezone - `part_cost` is the live replacement cost by definition (29
    // §5.1). Loaded only when some offer actually needs it, so an org that has
    // never classified anything pays no extra query and no settings read.
    const classified = [...byInstance.values()].filter(
      (entry) => entry.partInstanceId && entry.tariffRate == null && entry.tariffCodeId
    )
    if (classified.length > 0) {
      const [schedule, timeZone] = await Promise.all([
        loadTariffSchedule(database, orgId),
        readBookTimeZone(orgId),
      ])
      const now = new Date()
      for (const entry of classified) {
        entry.tariffRate = resolveOfferTariff(entry, schedule, now, timeZone).rate
      }
    }

    for (const [instanceId, entry] of byInstance) {
      if (entry.partInstanceId) {
        vendorPrices.push({
          // The offer's OWN id, not the part's — it is the deterministic
          // tiebreak in `selectWinningVendor`.
          id: instanceId,
          partInstanceId: entry.partInstanceId,
          unitPrice: entry.unitPrice,
          shippingCost: entry.shippingCost,
          tariffRate: entry.tariffRate,
          otherCost: entry.otherCost,
          isPreferred: entry.isPreferred,
        })
      }
    }
  }

  // ── Query 2: All subpart field values (single JOIN) ──
  const subparts: SubpartRow[] = []

  if (spParentField && spChildField && spQtyField) {
    const rows = await database
      .select({
        instanceId: schema.EntityInstance.id,
        fieldId: schema.FieldValue.fieldId,
        valueNumber: schema.FieldValue.valueNumber,
        relatedEntityId: schema.FieldValue.relatedEntityId,
      })
      .from(schema.EntityInstance)
      .innerJoin(
        schema.FieldValue,
        and(
          eq(schema.FieldValue.entityId, schema.EntityInstance.id),
          eq(schema.FieldValue.organizationId, schema.EntityInstance.organizationId)
        )
      )
      .where(
        and(
          eq(schema.EntityInstance.organizationId, orgId),
          eq(schema.EntityInstance.entityDefinitionId, subpartDefId),
          isNull(schema.EntityInstance.archivedAt)
        )
      )

    // Group by instance and extract relevant fields
    const byInstance = new Map<
      string,
      { parentPartId: string | null; childPartId: string | null; quantity: number }
    >()

    for (const row of rows) {
      if (!byInstance.has(row.instanceId)) {
        byInstance.set(row.instanceId, { parentPartId: null, childPartId: null, quantity: 0 })
      }
      const entry = byInstance.get(row.instanceId)!
      if (row.fieldId === spParentField.id) {
        entry.parentPartId = row.relatedEntityId
      } else if (row.fieldId === spChildField.id) {
        entry.childPartId = row.relatedEntityId
      } else if (row.fieldId === spQtyField.id) {
        entry.quantity = row.valueNumber ?? 0
      }
    }

    for (const entry of byInstance.values()) {
      if (entry.parentPartId && entry.childPartId && entry.quantity > 0) {
        subparts.push({
          parentPartId: entry.parentPartId,
          childPartId: entry.childPartId,
          quantity: entry.quantity,
        })
      }
    }
  }

  return { vendorPrices, subparts }
}

/**
 * Every non-archived `part` instance in the org.
 *
 * This is the persist SCOPE for a full sweep, and it is deliberately not derived
 * from the vendor/subpart graph. A part with neither a supplier nor a bill of
 * materials appears nowhere in that graph, so a graph-derived sweep skips it —
 * which is exactly how a part that lost its last supplier before the write path
 * became authoritative could keep a frozen number that no recalculation would
 * ever reach. Scope decides what gets written; values only decide what it says.
 */
async function loadAllPartIds(orgId: string, partDefId: string): Promise<string[]> {
  const rows = await database
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, orgId),
        eq(schema.EntityInstance.entityDefinitionId, partDefId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
  return rows.map((row) => row.id)
}

// ─── Graph Building ──────────────────────────────────────────────────

/**
 * The winning supplier's landed cost, per part.
 *
 * Both halves of the rule — the landed formula and which offer wins — live in
 * `vendor-cost.ts` so the Suppliers drawer tab can mark the same row this
 * function silently reduced to a number. See {@link selectWinningVendor} for
 * the ordering, including why an exact tie now breaks on the offer's id.
 */
function buildVendorCostMaps(vendorPrices: VendorPriceRow[]): VendorCostMaps {
  const landedCostMap = new Map<string, number>()

  // Group by partInstanceId
  const byPart = new Map<string, VendorPriceRow[]>()
  for (const vp of vendorPrices) {
    if (vp.unitPrice == null) continue
    const group = byPart.get(vp.partInstanceId) ?? []
    group.push(vp)
    byPart.set(vp.partInstanceId, group)
  }

  for (const [partId, rows] of byPart) {
    const winner = selectWinningVendor(rows)
    if (!winner) continue
    const landed = computeLandedCost(winner)
    if (landed != null) {
      landedCostMap.set(partId, landed)
    }
  }

  return { landedCostMap }
}

/** Adjacency list: parent → [{ childId, qty }] */
function buildSubpartGraph(
  subparts: SubpartRow[]
): Map<string, { childId: string; qty: number }[]> {
  const map = new Map<string, { childId: string; qty: number }[]>()
  for (const sp of subparts) {
    const children = map.get(sp.parentPartId) ?? []
    children.push({ childId: sp.childPartId, qty: sp.quantity })
    map.set(sp.parentPartId, children)
  }
  return map
}

/** Reverse adjacency: child → [parentId] (for propagation) */
function buildParentGraph(subparts: SubpartRow[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const sp of subparts) {
    const parents = map.get(sp.childPartId) ?? []
    parents.push(sp.parentPartId)
    map.set(sp.childPartId, parents)
  }
  return map
}

// ─── Cost Calculation ────────────────────────────────────────────────

/**
 * Calculate costs for all parts in the graph using memoized DFS.
 *
 * Three things this does that a plain "vendor price beats BOM" walk does not:
 *
 *  1. **The roll-up is always computed**, even when a vendor price wins, so the
 *     buy price and the build price are both stored and comparable.
 *  2. **Nulls propagate.** A part with neither a vendor nor children has no
 *     cost — not a cost of zero. An assembly with any unpriced descendant has
 *     no cost either: an incomplete bill of materials cannot be priced, and a
 *     confident $0.00 hides that where a blank surfaces it.
 *  3. **Cycles are contained.** A back edge contributes 0 to its parent's
 *     roll-up rather than poisoning every ancestor with a null, because a cycle
 *     is a data defect in one place, not an unpriced part everywhere above it.
 *     The cyclic part's own cost is genuinely unknowable and records `none`.
 *  4. **A null says which parts caused it** — see
 *     {@link PartCostResult.unpricedDescendantIds}. Blanking a cost without
 *     naming the components responsible just moves the mystery.
 */
function calculateAllCosts(
  vendorLandedCosts: Map<string, number>,
  subpartGraph: Map<string, { childId: string; qty: number }[]>
): Map<string, PartCostResult> {
  const results = new Map<string, PartCostResult>()
  const inProgress = new Set<string>()
  /** Parts re-entered during the walk — their own cost is unknowable. */
  const cyclic = new Set<string>()
  /**
   * Per part: the unpriced leaves to fix AT OR BELOW it, which is what its
   * PARENT needs to union. Distinct from the public `unpricedDescendantIds`,
   * which is strictly below — an unpriced leaf's closure is itself, but it is
   * not its own descendant.
   */
  const closures = new Map<string, readonly string[]>()

  /** What a PARENT should add for this child. See point 3 above. */
  function contribution(partId: string, result: PartCostResult): number | null {
    if (cyclic.has(partId)) return 0
    return result.cost
  }

  function calc(partId: string): PartCostResult {
    const memo = results.get(partId)
    if (memo) return memo

    if (inProgress.has(partId)) {
      logger.warn('Circular reference detected in BOM, treating cost as 0', { partId })
      cyclic.add(partId)
      results.set(partId, UNCOSTED)
      // Memoized BEFORE the recursion unwinds, which is also what stops the
      // closure walk from looping. A cycle's unpriced leaves cannot be
      // enumerated, so it reports none rather than a set that depends on which
      // node the walk happened to enter from.
      closures.set(partId, NO_UNPRICED)
      return UNCOSTED
    }
    inProgress.add(partId)

    const purchaseCost = vendorLandedCosts.get(partId) ?? null

    // Every child is visited even once the roll-up is known to be incomplete,
    // so each one still gets memoized with its own answer rather than being
    // left for a later top-level pass to rediscover.
    const children = subpartGraph.get(partId) ?? []
    let rollupCost: number | null = null
    const unpriced = new Set<string>()
    if (children.length > 0) {
      let sum = 0
      let complete = true
      for (const child of children) {
        const childCost = contribution(child.childId, calc(child.childId))
        for (const id of closures.get(child.childId) ?? NO_UNPRICED) unpriced.add(id)
        if (childCost == null) complete = false
        else sum += childCost * child.qty
      }
      rollupCost = complete ? sum : null
    }

    inProgress.delete(partId)

    // A cycle closed on THIS part while its own subtree was walking. The stub
    // memoized above is the answer; do not overwrite it with a number derived
    // from a graph that contradicts itself.
    if (cyclic.has(partId)) return results.get(partId)!

    const unpricedDescendantIds = unpriced.size > 0 ? [...unpriced] : NO_UNPRICED

    let result: PartCostResult
    if (purchaseCost != null) {
      result = {
        cost: purchaseCost,
        purchaseCost,
        rollupCost,
        source: 'vendor',
        unpricedDescendantIds,
      }
    } else if (rollupCost != null) {
      result = {
        cost: rollupCost,
        purchaseCost: null,
        rollupCost,
        source: 'bom',
        unpricedDescendantIds,
      }
    } else {
      result = { ...UNCOSTED, unpricedDescendantIds }
    }

    results.set(partId, result)
    // A costed part is nothing for an ancestor to fix, whatever sits under it.
    // An uncosted LEAF is the fixable thing and names itself here (but not in
    // its own `unpricedDescendantIds`). An uncosted assembly forwards what it
    // found below.
    closures.set(
      partId,
      result.cost != null ? NO_UNPRICED : children.length === 0 ? [partId] : unpricedDescendantIds
    )
    return result
  }

  // Collect all part IDs that appear anywhere in the graph
  const allPartIds = new Set([
    ...vendorLandedCosts.keys(),
    ...subpartGraph.keys(),
    ...[...subpartGraph.values()].flatMap((children) => children.map((c) => c.childId)),
  ])

  for (const id of allPartIds) calc(id)

  return results
}

// ─── Persistence ─────────────────────────────────────────────────────

interface CurrentPartValues {
  costs: Map<string, number>
  purchaseCosts: Map<string, number>
  rollupCosts: Map<string, number>
  sources: Map<string, string>
  /** Stored row id per (part, field) pair, see `pairKey`; absent = no row. */
  rowIds: Map<string, string>
}

/** The four `part` fields `persistCosts` owns, resolved from the org cache. */
interface CostFields {
  cost: CustomFieldEntity
  purchaseCost: CustomFieldEntity | null
  rollupCost: CustomFieldEntity | null
  costSource: CustomFieldEntity | null
}

/**
 * Resolve the four cost fields. Only `part_cost` is required — the other three
 * are absent until migration `100` materializes them for the org, and a
 * pre-migration org must still get its `part_cost` maintained.
 */
async function loadCostFields(orgId: string): Promise<CostFields | null> {
  const fields = await getOrgCache()
    .from(orgId, 'customFields')
    .bySystemAttributes([
      'part_cost',
      'part_purchase_cost',
      'part_rollup_cost',
      'part_cost_source',
    ] as const)

  if (!fields.part_cost) {
    logger.warn('part_cost custom field not found, skipping cost persistence')
    return null
  }

  return {
    cost: fields.part_cost,
    purchaseCost: fields.part_purchase_cost,
    rollupCost: fields.part_rollup_cost,
    costSource: fields.part_cost_source,
  }
}

/**
 * Load the currently stored cost values for every part in the org, so the write
 * path only touches rows whose value actually changed.
 *
 * `part_cost_source` is a SINGLE_SELECT and lives in `FieldValue.optionId`, not
 * in `valueNumber` — the registry's option rows carry no `id`, so the stored key
 * is the raw option `value` ('vendor' / 'bom' / 'none').
 */
async function loadCurrentPartValues(
  orgId: string,
  fields: CostFields
): Promise<CurrentPartValues> {
  const current: CurrentPartValues = {
    costs: new Map(),
    purchaseCosts: new Map(),
    rollupCosts: new Map(),
    sources: new Map(),
    rowIds: new Map(),
  }

  const fieldIds = [
    fields.cost.id,
    fields.purchaseCost?.id,
    fields.rollupCost?.id,
    fields.costSource?.id,
  ].filter((id): id is string => Boolean(id))

  const rows = await database
    .select({
      id: schema.FieldValue.id,
      entityId: schema.FieldValue.entityId,
      fieldId: schema.FieldValue.fieldId,
      valueNumber: schema.FieldValue.valueNumber,
      optionId: schema.FieldValue.optionId,
    })
    .from(schema.FieldValue)
    .where(
      and(inArray(schema.FieldValue.fieldId, fieldIds), eq(schema.FieldValue.organizationId, orgId))
    )

  for (const row of rows) {
    current.rowIds.set(pairKey(row.entityId, row.fieldId), row.id)
    if (row.fieldId === fields.cost.id) {
      if (row.valueNumber != null) current.costs.set(row.entityId, row.valueNumber)
    } else if (fields.purchaseCost && row.fieldId === fields.purchaseCost.id) {
      if (row.valueNumber != null) current.purchaseCosts.set(row.entityId, row.valueNumber)
    } else if (fields.rollupCost && row.fieldId === fields.rollupCost.id) {
      if (row.valueNumber != null) current.rollupCosts.set(row.entityId, row.valueNumber)
    } else if (fields.costSource && row.fieldId === fields.costSource.id) {
      if (row.optionId != null) current.sources.set(row.entityId, row.optionId)
    }
  }

  return current
}

/** What `setValueWithType` and the realtime publish both carry for one field. */
type CostFieldValue =
  | { type: 'number'; value: number }
  | { type: 'option'; optionId: string }
  | null

/** One field of one part that needs writing, already reduced to its new value. */
interface PendingWrite {
  field: CustomFieldEntity
  value: CostFieldValue
}

/**
 * The writes one part needs, or an empty list when nothing about it changed.
 *
 * Every field is compared against what is stored, so a recalculation that
 * confirms the existing numbers costs nothing. A `null` is a real answer, not
 * an absence — `part_cost_source` is the exception and is always one of the
 * three option values, which is the point of having `none` at all.
 */
function diffPart(
  result: PartCostResult,
  partId: string,
  fields: CostFields,
  previous: CurrentPartValues
): PendingWrite[] {
  const writes: PendingWrite[] = []

  const numeric: [CustomFieldEntity | null, number | null, Map<string, number>][] = [
    [fields.cost, result.cost, previous.costs],
    [fields.purchaseCost, result.purchaseCost, previous.purchaseCosts],
    [fields.rollupCost, result.rollupCost, previous.rollupCosts],
  ]

  for (const [field, next, stored] of numeric) {
    if (!field) continue
    // Landed and roll-up costs are exact and can carry a sub-minor-unit
    // fraction (4133 at 7.5% → 4442.975). These fields are RATES (part_cost,
    // part_purchase_cost, part_rollup_cost), so the write seam rounds to
    // RATE_DECIMALS rather than to a whole minor unit - round here - and
    // compare the ROUNDED value, or an unchanged fractional cost re-writes on
    // every recalculation.
    const rounded = next == null ? null : roundMinor(next, RATE_DECIMALS)
    const prev = stored.get(partId) ?? null
    if (rounded === prev) continue
    writes.push({ field, value: rounded == null ? null : { type: 'number', value: rounded } })
  }

  if (fields.costSource) {
    const prev = previous.sources.get(partId) ?? null
    if (result.source !== prev) {
      writes.push({ field: fields.costSource, value: { type: 'option', optionId: result.source } })
    }
  }

  return writes
}

/**
 * Write calculated costs back to each part's FieldValues.
 * Only touches parts whose values actually changed.
 *
 * **Authoritative, not additive.** A `null` in a result is a real answer — "this
 * part has no calculated value" — and clears the stored FieldValue, rather than
 * meaning "leave whatever is there". Without that, a part losing its last vendor
 * (or its last subpart) keeps a frozen number that is visually indistinguishable
 * from a fresh one; the caller must therefore pass every part IN SCOPE, using
 * {@link UNCOSTED} where there is no value, not only the parts that have one.
 *
 * Returns IDs of parts whose values changed.
 */
async function persistCosts(
  orgId: string,
  scoped: Map<string, PartCostResult>,
  fields: CostFields,
  previous: CurrentPartValues
): Promise<string[]> {
  const partDefId = await requireCachedEntityDefId(orgId, 'part')

  logger.info('Persisting costs', {
    costFieldId: fields.cost.id,
    purchaseCostFieldId: fields.purchaseCost?.id ?? null,
    rollupCostFieldId: fields.rollupCost?.id ?? null,
    costSourceFieldId: fields.costSource?.id ?? null,
    partDefId,
    scopedParts: scoped.size,
  })

  const changedEntries: { partId: string; writes: PendingWrite[] }[] = []
  for (const [partId, result] of scoped) {
    const writes = diffPart(result, partId, fields, previous)
    if (writes.length > 0) changedEntries.push({ partId, writes })
  }

  logger.info('Parts with changed values', { count: changedEntries.length })

  // Cost fields are single-value system fields with no hooks, no display
  // role and no search-corpus membership, so the write is exactly two
  // statements per batch: one UPDATE over every pair that has a stored row,
  // one INSERT for every pair that does not. It used to be one locked
  // transaction PER FIELD PER PART, opened in parallel across pool
  // connections (plans/field-values/update-path-and-events.md section 1f).
  const changedPartIds = new Set<string>()
  const BATCH_SIZE = 200
  for (let i = 0; i < changedEntries.length; i += BATCH_SIZE) {
    const batch = changedEntries.slice(i, i + BATCH_SIZE)
    try {
      const writes: CostWrite[] = []
      for (const entry of batch) {
        for (const write of entry.writes) {
          writes.push({
            recordId: toRecordId(partDefId, entry.partId) as RecordId,
            fieldId: write.field.id,
            fieldType: toFieldType(write.field.type),
            value: write.value,
            rowId: previous.rowIds.get(pairKey(entry.partId, write.field.id)) ?? null,
          })
        }
      }
      await writeCostValues(orgId, partDefId, writes)
      for (const entry of batch) changedPartIds.add(entry.partId)
    } catch (error) {
      logger.error('Failed to persist part cost values', {
        parts: batch.length,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      })
    }
  }

  // Publish cascaded changes to all clients
  if (changedPartIds.size > 0) {
    const entries: FieldValueUpdateEntry[] = []
    for (const entry of changedEntries) {
      if (!changedPartIds.has(entry.partId)) continue
      const recordId = toRecordId(partDefId, entry.partId) as RecordId

      // A cleared cell publishes as `value: null`, NOT as an omitted entry: on
      // `FieldValueUpdateEntry` an absent `value` means "don't touch the store"
      // (realtime/events.ts), so skipping the entry would leave every open client
      // rendering the stale number until a reload.
      for (const write of entry.writes) {
        entries.push({
          key: buildFieldValueKey(recordId, write.field.id as FieldId),
          value: write.value,
        })
      }
    }
    publishFieldValueUpdates(getRealtimeService(), orgId, entries).catch(() => {})
  }

  return [...changedPartIds]
}

/** Map key for one (part, field) pair in {@link CurrentPartValues.rowIds}. */
function pairKey(partId: string, fieldId: string): string {
  return `${partId}:${fieldId}`
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Recalculate costs for all parts in an organization.
 *
 * The scope is every non-archived `part` in the org, NOT the parts reachable
 * through the vendor/subpart graph — see {@link loadAllPartIds}. That makes a
 * full sweep self-sufficient: it repairs a frozen value on a part that has
 * neither a supplier nor a bill of materials, which a graph-derived sweep can
 * never even visit.
 */
export async function recalculateAllPartCosts(orgId: string): Promise<string[]> {
  const fields = await loadCostFields(orgId)
  if (!fields) return []

  const partDefId = await requireCachedEntityDefId(orgId, 'part')
  const { vendorPrices, subparts } = await loadOrgPricingData(orgId)
  const { landedCostMap } = buildVendorCostMaps(vendorPrices)
  const subpartGraph = buildSubpartGraph(subparts)
  const allResults = calculateAllCosts(landedCostMap, subpartGraph)

  const partIds = await loadAllPartIds(orgId, partDefId)
  const scoped = new Map<string, PartCostResult>()
  for (const partId of partIds) {
    scoped.set(partId, allResults.get(partId) ?? UNCOSTED)
  }

  const previous = await loadCurrentPartValues(orgId, fields)
  const changedIds = await persistCosts(orgId, scoped, fields, previous)

  logger.info('Recalculated all part costs', {
    orgId,
    totalParts: scoped.size,
    changedParts: changedIds.length,
  })

  if (changedIds.length > 0) {
    await syncCatalogPricingSafely(orgId, changedIds)
  }

  return changedIds
}

/**
 * Recalculate costs for specific parts and all their ancestors.
 * Still loads all org data (cheap at ~300 parts), but only recalculates
 * the affected subtree and persists changed values.
 */
export async function recalculateAffectedParts(
  orgId: string,
  affectedPartIds: string[]
): Promise<string[]> {
  const fields = await loadCostFields(orgId)
  if (!fields) return []

  const { vendorPrices, subparts } = await loadOrgPricingData(orgId)
  const { landedCostMap } = buildVendorCostMaps(vendorPrices)
  const subpartGraph = buildSubpartGraph(subparts)
  const parentGraph = buildParentGraph(subparts)

  // Find all ancestors of affected parts
  const dirtySet = new Set<string>()
  function markDirty(partId: string) {
    if (dirtySet.has(partId)) return
    dirtySet.add(partId)
    for (const parent of parentGraph.get(partId) ?? []) {
      markDirty(parent)
    }
  }
  for (const id of affectedPartIds) markDirty(id)

  // Calculate costs for all parts (memoized, so cheap)
  const allResults = calculateAllCosts(landedCostMap, subpartGraph)

  // The dirty set IS the persist scope, so a part that no longer resolves to a
  // cost maps to `UNCOSTED` and gets cleared, instead of dropping out of the
  // map and keeping a frozen value.
  const scoped = new Map<string, PartCostResult>()
  for (const partId of dirtySet) {
    scoped.set(partId, allResults.get(partId) ?? UNCOSTED)
  }

  const previous = await loadCurrentPartValues(orgId, fields)
  const changedIds = await persistCosts(orgId, scoped, fields, previous)

  logger.info('Recalculated affected part costs', {
    orgId,
    affectedParts: affectedPartIds.length,
    dirtyParts: dirtySet.size,
    changedParts: changedIds.length,
  })

  if (changedIds.length > 0) {
    await syncCatalogPricingSafely(orgId, changedIds)
  }

  return changedIds
}

/**
 * Ripple changed part costs into linked catalog items (plan 17 §2) — lazy `import()`
 * so this bom module doesn't gain a static edge onto `money/` (no existing lazy-import
 * convention in this file otherwise; new for this call site). Swallows its own errors:
 * a catalog-pricing bug must never fail the part-cost recalc that triggered it.
 */
async function syncCatalogPricingSafely(orgId: string, changedPartIds: string[]): Promise<void> {
  try {
    const { syncCatalogItemPricing } = await import('../money/catalog-pricing')
    await syncCatalogItemPricing(orgId, changedPartIds)
  } catch (error) {
    logger.error('Failed to sync catalog item pricing after part cost recalc', {
      orgId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

// ─── Exported helpers for BomService ─────────────────────────────────

export {
  loadOrgPricingData,
  buildVendorCostMaps,
  buildSubpartGraph,
  buildParentGraph,
  calculateAllCosts,
}
export type {
  VendorPriceRow,
  VendorCostMaps,
  SubpartRow,
  OrgPricingData,
  PartCostResult,
  CostSourceValue,
}
