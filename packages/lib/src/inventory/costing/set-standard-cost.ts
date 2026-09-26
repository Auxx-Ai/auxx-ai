// packages/lib/src/inventory/costing/set-standard-cost.ts

// The typed-cost door (106 §5, 09 D-SC2a/D-SC3): a first standard, a restate of an unmoved
// provisional one, or a revaluing restate of a moved part. No permission checks: the router asserts.

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { buildFieldValueKey, type FieldId } from '@auxx/types/field'
import { type RecordId, toRecordId } from '@auxx/types/resource'
import { roundMinorUnits } from '@auxx/utils/currency'
import { and, eq, inArray } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { requestAccountingRecovery } from '../../accounting/work-items/recovery'
import { wakePricedParts } from '../../accounting/work-items/wake'
import { getOrgCache } from '../../cache'
import { BadRequestError, NotFoundError } from '../../errors'
import { createFieldValueContext } from '../../field-values/field-value-helpers'
import { setValueWithType } from '../../field-values/field-value-mutations'
import { toFieldType } from '../../field-values/stored-field-type'
import {
  type FieldValueUpdateEntry,
  getRealtimeService,
  publishFieldValueUpdates,
} from '../../realtime'
import { loadOrgSubpartEdges } from './cost-calculator'
import { ensureStandardCost } from './ensure-standard-cost'
import { guard } from './guard'
import { pricePendingMovementsQuietly } from './price-pending-movements'
import { replaceProvisionalStandard } from './provisional-standard'
import { rollUnvaluedAncestors } from './roll-unvalued-ancestors'
import {
  loadStandardCostWriteContext,
  type StandardCostWriteContext,
} from './standard-cost-queries'

const logger = createScopedLogger('costing:set-standard-cost')

/** One typed unit cost, in minor units at rate precision. Zero is a value (103 §5a). */
export interface StandardCostEntry {
  partId: string
  unitCost: number
  /** "Set cost instead": type a cost on a part with a BOM, origin `manual` (D-SC3). */
  overrideBom?: boolean
}

/** What a typed cost did. `revaluationPostedMinor` is signed minor units, 0 when nothing posted. */
export interface StandardCostWrite {
  action: 'set' | 'restated'
  standardCost: number
  revaluationPostedMinor: number
}

export type StandardCostEntryOutcome =
  | ({ partId: string; ok: true } & StandardCostWrite)
  | { partId: string; ok: false; error: Error }

/** Who is typing; the revaluation and the parent roll are authored as them. Defaults to the system user. */
export interface SetStandardCostOptions {
  userId?: string
}

/** A typed unit cost for one part; see {@link setStandardCosts}. */
export async function setStandardCost(
  db: Database,
  organizationId: string,
  entry: StandardCostEntry,
  options?: SetStandardCostOptions
): Promise<Result<StandardCostWrite, Error>> {
  const result = await setStandardCosts(db, organizationId, [entry], options)
  if (result.isErr()) return err(result.error)
  const outcome = result.value[0]
  if (!outcome) return err(new NotFoundError('No such part'))
  if (!outcome.ok) return err(outcome.error)
  return ok({
    action: outcome.action,
    standardCost: outcome.standardCost,
    revaluationPostedMinor: outcome.revaluationPostedMinor,
  })
}

/**
 * Typed unit costs, one outcome per entry in input order; one bad entry fails only itself.
 * First standards then roll their unvalued BOM parents once (D-SC7).
 */
export async function setStandardCosts(
  db: Database,
  organizationId: string,
  entries: readonly StandardCostEntry[],
  options?: SetStandardCostOptions
): Promise<Result<StandardCostEntryOutcome[], Error>> {
  return guard(
    async () => {
      const outcomes = new Map<string, StandardCostEntryOutcome>()
      const valid = new Map<string, { unitCost: number; overrideBom: boolean }>()
      for (const entry of entries) {
        if (outcomes.has(entry.partId) || valid.has(entry.partId)) continue
        if (!Number.isFinite(entry.unitCost) || entry.unitCost < 0) {
          outcomes.set(entry.partId, refuse(entry.partId, 'A unit cost must be zero or more'))
          continue
        }
        valid.set(entry.partId, {
          unitCost: roundMinorUnits(entry.unitCost),
          overrideBom: entry.overrideBom === true,
        })
      }
      if (valid.size === 0) return inOrder(entries, outcomes)

      const partIds = [...valid.keys()]
      const [context, moved, withBom] = await Promise.all([
        loadStandardCostWriteContext(db, organizationId),
        readMovedPartIds(db, organizationId, partIds),
        readPartIdsWithBom(db, organizationId, partIds),
      ])
      const userId = options?.userId ?? (await getOrgCache().get(organizationId, 'systemUser'))

      const toSet = new Map<string, number>()
      const toRestate = new Map<string, number>()
      const toReplace = new Map<string, number>()
      for (const [partId, { unitCost, overrideBom }] of valid) {
        const door = classify(context, moved, withBom, partId, overrideBom)
        if (door === 'set') toSet.set(partId, unitCost)
        else if (door === 'restate') toRestate.set(partId, unitCost)
        else if (door === 'replace') toReplace.set(partId, unitCost)
        else outcomes.set(partId, { partId, ok: false, error: door })
      }

      let firstStandards: string[] = []
      if (toSet.size > 0) {
        const ensured = await ensureStandardCost(db, organizationId, [...toSet.keys()], {
          kind: 'manual',
          unitCosts: toSet,
        })
        if (ensured.isErr()) throw ensured.error
        firstStandards = ensured.value.writtenPartIds
        const written = new Set(firstStandards)
        for (const [partId, unitCost] of toSet) {
          outcomes.set(
            partId,
            written.has(partId) ? wrote(partId, 'set', unitCost) : notWritten(partId)
          )
        }
      }

      if (toRestate.size > 0) {
        const restated = await restateUnmovedProvisionalStandards(
          db,
          organizationId,
          context,
          toRestate
        )
        for (const [partId, unitCost] of toRestate) {
          outcomes.set(
            partId,
            restated.has(partId) ? wrote(partId, 'restated', unitCost) : notWritten(partId)
          )
        }
        if (restated.size > 0) {
          await wakePricedParts(db, organizationId, { partIds: [...restated] })
          await pricePendingMovementsQuietly(db, organizationId, [...restated])
        }
      }

      // Sequential: each prices its pending rows, writes, then posts its own revaluation.
      for (const [partId, unitCost] of toReplace) {
        const replaced = await replaceProvisionalStandard(
          db,
          organizationId,
          userId,
          partId,
          unitCost,
          { door: 'typed' }
        )
        outcomes.set(
          partId,
          replaced.isErr()
            ? { partId, ok: false, error: replaced.error }
            : wrote(partId, 'restated', unitCost, replaced.value.revaluationPostedMinor)
        )
      }

      if (firstStandards.length > 0) {
        const rolled = await rollUnvaluedAncestors(db, organizationId, userId, firstStandards)
        if (rolled.isErr()) {
          logger.warn('Could not roll the parents of a typed first standard', {
            organizationId,
            error: rolled.error.message,
          })
        }
      }

      if ([...outcomes.values()].some((outcome) => outcome.ok)) {
        await requestAccountingRecovery(organizationId)
      }
      return inOrder(entries, outcomes)
    },
    'Failed to set standard costs',
    { organizationId, entries: entries.length }
  )
}

/** Which door a typed cost goes through, or why it is refused. */
function classify(
  context: StandardCostWriteContext,
  moved: ReadonlySet<string>,
  withBom: ReadonlySet<string>,
  partId: string,
  overrideBom: boolean
): 'set' | 'restate' | 'replace' | Error {
  if (!context.allPartIds.has(partId)) return new NotFoundError('No such part')
  if (context.partKinds.get(partId) === 'service') {
    return new BadRequestError('A service is never stocked, so it has no standard cost')
  }
  if (withBom.has(partId) && !overrideBom) return bomRefusal()
  if (context.standardCosts.get(partId) == null) return 'set'
  if (!moved.has(partId) && context.standardCostSources.get(partId) === 'provisional') {
    return 'restate'
  }
  return 'replace'
}

/** Why a part with a BOM takes no typed cost (D-SC3). */
export function bomRefusal(): BadRequestError {
  return new BadRequestError(
    'This part rolls from its bill of materials; cost its components, or use Set cost instead.'
  )
}

/** Which of `partIds` are the parent of at least one live subpart edge. */
export async function readPartIdsWithBom(
  db: Database,
  organizationId: string,
  partIds: readonly string[]
): Promise<Set<string>> {
  const wanted = new Set(partIds)
  const withBom = new Set<string>()
  if (wanted.size === 0) return withBom
  for (const edge of await loadOrgSubpartEdges(db, organizationId)) {
    if (wanted.has(edge.parentPartId)) withBom.add(edge.parentPartId)
  }
  return withBom
}

function wrote(
  partId: string,
  action: 'set' | 'restated',
  standardCost: number,
  revaluationPostedMinor = 0
): StandardCostEntryOutcome {
  return { partId, ok: true, action, standardCost, revaluationPostedMinor }
}

function notWritten(partId: string): StandardCostEntryOutcome {
  return { partId, ok: false, error: new Error('The standard cost could not be written') }
}

/**
 * Overwrite a provisional standard on parts that have never moved (103 §7). With no movement
 * there is nothing on hand and nothing relieved at the old number, so no revaluation is due.
 * Returns the parts written; a failed write is logged and left out.
 */
async function restateUnmovedProvisionalStandards(
  db: Database,
  organizationId: string,
  context: StandardCostWriteContext,
  costs: ReadonlyMap<string, number>
): Promise<Set<string>> {
  const { fields, partDefId } = context
  const userId = await getOrgCache().get(organizationId, 'systemUser')
  const ctx = createFieldValueContext(organizationId, userId, db)
  const effectiveAt = new Date().toISOString()
  const written = new Set<string>()
  const entries: FieldValueUpdateEntry[] = []

  for (const [partId, unitCost] of costs) {
    const recordId = toRecordId(partDefId, partId) as RecordId
    const writes = [
      { field: fields.material, value: { type: 'number' as const, value: unitCost } },
      { field: fields.labor, value: { type: 'number' as const, value: 0 } },
      { field: fields.overhead, value: { type: 'number' as const, value: 0 } },
      { field: fields.standard, value: { type: 'number' as const, value: unitCost } },
      { field: fields.effectiveAt, value: { type: 'date' as const, value: effectiveAt } },
      ...(fields.origin
        ? [{ field: fields.origin, value: { type: 'option' as const, optionId: 'manual' } }]
        : []),
    ]
    try {
      for (const write of writes) {
        await setValueWithType(ctx, {
          recordId,
          fieldId: write.field.id,
          fieldType: toFieldType(write.field.type),
          value: write.value,
        })
      }
      written.add(partId)
      for (const write of writes) {
        entries.push({
          key: buildFieldValueKey(recordId, write.field.id as FieldId),
          value: write.value as FieldValueUpdateEntry['value'],
        })
      }
    } catch (error) {
      logger.error('Failed to restate a provisional standard', {
        organizationId,
        partId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (entries.length > 0) {
    publishFieldValueUpdates(getRealtimeService(), organizationId, entries).catch(() => {})
  }
  return written
}

/** Which of `partIds` have ANY `stock_movement`, archived ones included. */
export async function readMovedPartIds(
  db: Database,
  organizationId: string,
  partIds: readonly string[]
): Promise<Set<string>> {
  const moved = new Set<string>()
  const unique = [...new Set(partIds.filter(Boolean))]
  if (unique.length === 0) return moved

  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['stock_movement_part'] as const)
  const partField = fields.stock_movement_part
  if (!partField) return moved

  const rows = await db
    .selectDistinct({ partId: schema.FieldValue.relatedEntityId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, partField.id),
        inArray(schema.FieldValue.relatedEntityId, unique)
      )
    )
  for (const row of rows) if (row.partId) moved.add(row.partId)
  return moved
}

function refuse(partId: string, message: string): StandardCostEntryOutcome {
  return { partId, ok: false, error: new BadRequestError(message) }
}

function inOrder(
  entries: readonly StandardCostEntry[],
  outcomes: ReadonlyMap<string, StandardCostEntryOutcome>
): StandardCostEntryOutcome[] {
  const seen = new Set<string>()
  const ordered: StandardCostEntryOutcome[] = []
  for (const entry of entries) {
    if (seen.has(entry.partId)) continue
    seen.add(entry.partId)
    const outcome = outcomes.get(entry.partId)
    if (outcome) ordered.push(outcome)
  }
  return ordered
}
