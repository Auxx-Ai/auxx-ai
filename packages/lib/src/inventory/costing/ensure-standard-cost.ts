// packages/lib/src/inventory/costing/ensure-standard-cost.ts

// Writes a FIRST standard from a cost a door names (receipt, count, typed), never overwriting one
// (plans/money/tasks/15 §1). Nothing is inferred from a price list (09 D-SC1); the doors roll the
// parents themselves (`rollUnvaluedAncestors`). No permission checks: the router asserts.

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { buildFieldValueKey, type FieldId } from '@auxx/types/field'
import { type RecordId, toRecordId } from '@auxx/types/resource'
import { roundMinorUnits } from '@auxx/utils/currency'
import type { Result } from 'neverthrow'
import { wakePricedParts } from '../../accounting/work-items/wake'
import { getOrgCache } from '../../cache'
import { BadRequestError } from '../../errors'
import { createFieldValueContext } from '../../field-values/field-value-helpers'
import { setValueWithType } from '../../field-values/field-value-mutations'
import { toFieldType } from '../../field-values/stored-field-type'
import {
  type FieldValueUpdateEntry,
  getRealtimeService,
  publishFieldValueUpdates,
} from '../../realtime'
import type { StandardCostOriginValue, StandardCostSourceValue } from './client'
import { guard } from './guard'
import { pricePendingMovementsQuietly } from './price-pending-movements'
import { loadStandardCostWriteContext, type StandardCostFields } from './standard-cost-queries'
import type { StandardCostComponents } from './types'

const logger = createScopedLogger('builds:ensure-standard-cost')

/** How many parts are written concurrently. Mirrors `persistStandardCosts`. */
const WRITE_BATCH_SIZE = 20

/** Which door called, and the cost it names: minor units at rate precision. */
export interface EnsureStandardCostSource {
  kind: 'opening-stock' | 'receipt' | 'manual'
  /** One cost for every named part. A receipt refuses zero; a person or a count may type it (103 §5a). */
  unitCost?: number
  /** Per-part costs; wins over `unitCost`. A named part with no cost is not written. */
  unitCosts?: ReadonlyMap<string, number>
}

export interface EnsureStandardCostResult {
  /** Parts that had no standard and now have one. */
  writtenPartIds: string[]
}

/** One part's first standard, already reduced to the four numbers to store. */
interface FirstStandard {
  partId: string
  components: StandardCostComponents
  origin: StandardCostOriginValue
}

/**
 * Give each named part its named cost as a first standard, if and only if it has none. An
 * unknown id, a service, or a part that already has a standard is skipped, not an error.
 * Authored as the org's system user.
 */
export async function ensureStandardCost(
  db: Database,
  organizationId: string,
  partIds: string[],
  source: EnsureStandardCostSource
): Promise<Result<EnsureStandardCostResult, Error>> {
  return guard(
    async () => {
      const requested = [...new Set(partIds.filter(Boolean))]
      if (requested.length === 0) return { writtenPartIds: [] }

      const explicitCosts = resolveExplicitCosts(requested, source)
      if (explicitCosts.size === 0) return { writtenPartIds: [] }

      const context = await loadStandardCostWriteContext(db, organizationId)
      const writes: FirstStandard[] = []
      for (const partId of requested) {
        const cost = explicitCosts.get(partId)
        if (cost == null || !context.allPartIds.has(partId)) continue
        if (context.standardCosts.get(partId) != null) continue
        // A service is never stocked, so it never carries a standard (107-D10).
        if (context.partKinds.get(partId) === 'service') continue
        writes.push({
          partId,
          components: {
            standardMaterialCost: cost,
            standardLaborCost: 0,
            standardOverheadCost: 0,
            standardCost: cost,
          },
          origin: originOf(source.kind),
        })
      }
      if (writes.length === 0) return { writtenPartIds: [] }

      const userId = await getOrgCache().get(organizationId, 'systemUser')
      const writtenPartIds = await persistFirstStandards(db, organizationId, userId, {
        partDefId: context.partDefId,
        fields: context.fields,
        effectiveAt: new Date(),
        writes,
        source: source.kind === 'receipt' ? 'confirmed' : 'provisional',
      })

      // The rows written pending for want of a standard are valued now (111 Q22); the wake
      // keeps the recovery lane as the backstop.
      if (writtenPartIds.length > 0) {
        await wakePricedParts(db, organizationId, { partIds: writtenPartIds })
        await pricePendingMovementsQuietly(db, organizationId, writtenPartIds)
      }

      logger.info('Ensured first standard cost', {
        organizationId,
        source: source.kind,
        considered: requested.length,
        written: writtenPartIds.length,
      })
      return { writtenPartIds }
    },
    'Failed to ensure standard cost',
    { organizationId, source: source.kind, partIds: partIds.length }
  )
}

/** Validate the caller's costs, keyed by part. Zero only from a person or a count (103 §5a). */
function resolveExplicitCosts(
  requested: readonly string[],
  source: EnsureStandardCostSource
): Map<string, number> {
  const allowZero = source.kind !== 'receipt'
  const costs = new Map<string, number>()
  const raw: [string, number][] = source.unitCosts
    ? [...source.unitCosts]
    : source.unitCost != null
      ? requested.map((partId) => [partId, source.unitCost as number])
      : []
  for (const [partId, unitCost] of raw) {
    const valid = Number.isFinite(unitCost) && (allowZero ? unitCost >= 0 : unitCost > 0)
    if (!valid) {
      throw new BadRequestError(
        allowZero
          ? 'A standard cost must be zero or a positive amount in minor units'
          : 'A standard cost must be a positive amount in minor units'
      )
    }
    costs.set(partId, roundMinorUnits(unitCost))
  }
  return costs
}

/** Write the `part_standard_*` fields. Never throws: a failed batch stops the loop and is logged. */
async function persistFirstStandards(
  db: Database,
  organizationId: string,
  userId: string,
  args: {
    partDefId: string
    fields: StandardCostFields
    effectiveAt: Date
    writes: readonly FirstStandard[]
    source: StandardCostSourceValue
  }
): Promise<string[]> {
  const { partDefId, fields, effectiveAt, writes, source } = args
  const effectiveAtIso = effectiveAt.toISOString()

  const pending = writes.map((write) => ({
    partId: write.partId,
    values: [
      { field: fields.material, value: numberValue(write.components.standardMaterialCost) },
      { field: fields.labor, value: numberValue(write.components.standardLaborCost) },
      { field: fields.overhead, value: numberValue(write.components.standardOverheadCost) },
      { field: fields.standard, value: numberValue(write.components.standardCost) },
      { field: fields.effectiveAt, value: { type: 'date' as const, value: effectiveAtIso } },
      // Absent on an org short of migration 173; the roll behaves as before.
      ...(fields.source
        ? [{ field: fields.source, value: { type: 'option' as const, optionId: source } }]
        : []),
      ...(fields.origin
        ? [{ field: fields.origin, value: { type: 'option' as const, optionId: write.origin } }]
        : []),
    ],
  }))

  const ctx = createFieldValueContext(organizationId, userId, db)
  const written = new Set<string>()

  for (let i = 0; i < pending.length; i += WRITE_BATCH_SIZE) {
    const batch = pending.slice(i, i + WRITE_BATCH_SIZE)
    const settled = await Promise.allSettled(
      batch.map(async (entry) => {
        const recordId = toRecordId(partDefId, entry.partId) as RecordId
        // Sequential per part: the five values belong to one record and
        // `setValueWithType` stamps the instance on each write.
        for (const write of entry.values) {
          await setValueWithType(ctx, {
            recordId,
            fieldId: write.field.id,
            fieldType: toFieldType(write.field.type),
            value: write.value,
          })
        }
        return entry.partId
      })
    )

    for (const outcome of settled) {
      if (outcome.status === 'fulfilled') written.add(outcome.value)
    }

    const failure = settled.find((outcome) => outcome.status === 'rejected')
    if (failure) {
      logger.error('Failed to freeze a first standard cost, stopping', {
        organizationId,
        written: written.size,
        planned: pending.length,
        error: failure.reason instanceof Error ? failure.reason.message : String(failure.reason),
      })
      break
    }
  }

  publishFirstStandards(organizationId, partDefId, pending, written)

  return [...written]
}

/** The same realtime frame `persistStandardCosts` publishes, for the parts that landed. */
function publishFirstStandards(
  organizationId: string,
  partDefId: string,
  pending: { partId: string; values: { field: { id: string }; value: unknown }[] }[],
  written: ReadonlySet<string>
): void {
  if (written.size === 0) return
  const entries: FieldValueUpdateEntry[] = []
  for (const entry of pending) {
    if (!written.has(entry.partId)) continue
    const recordId = toRecordId(partDefId, entry.partId) as RecordId
    for (const write of entry.values) {
      entries.push({
        key: buildFieldValueKey(recordId, write.field.id as FieldId),
        value: write.value as FieldValueUpdateEntry['value'],
      })
    }
  }
  publishFieldValueUpdates(getRealtimeService(), organizationId, entries).catch(() => {})
}

/** `null` is a real answer: it clears the stored value. */
function numberValue(value: number | null): { type: 'number'; value: number } | null {
  return value == null ? null : { type: 'number', value }
}

/** The origin each door stamps (106 D9). */
function originOf(kind: EnsureStandardCostSource['kind']): StandardCostOriginValue {
  return kind === 'opening-stock' ? 'opening_stock' : kind
}
