// packages/lib/src/inventory/receiving/bulk-opening-stock.ts

/**
 * `bulkOpenStockBalance` - `setCount` for every named part, with a per-part count day
 * (103 O1, 111 D21).
 *
 * It never throws for a part: an entry is refused (`failed`) or set aside (`excluded`) with
 * the reason, and the others still run. Only a whole-run precondition - no `part` or
 * `stock_movement` definition, cost fields not materialised - is an error, because it refuses
 * every entry identically. A part that already has an `initial` is excluded unless the caller
 * opted into the adjust leg (`adjustAnchored`), so a stale re-run cannot write adjustments.
 *
 * No permission checks: the router asserts (`docs/lib-module-guide.md` §6).
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { isAtPrecision, RATE_DECIMALS } from '@auxx/utils/currency'
import type { Result } from 'neverthrow'
import { requireCachedEntityDefId } from '../../cache'
import { BadRequestError, NotFoundError, UnprocessableEntityError } from '../../errors'
import { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import { PartKind } from '../../resources/registry/enum-values'
import { PART_FIELDS } from '../../resources/registry/resources/part-fields'
import { pickSystemAttributes } from '../../resources/registry/system-attributes'
import { type RecordId, toRecordId } from '../../resources/resource-id'
import { readSystemRecords, systemDefId, systemFieldMap } from '../../resources/system-records'
import { isServicePartKind } from '../costing/client'
import { readServiceKindBlockers, serviceKindRefusal } from '../costing/service-kind-blockers'
import { assertCostFieldsMaterialized } from '../movements/cost-fields'
import { readPartInitials } from '../movements/initial-queries'
import { guard } from './guard'
import { setCount } from './set-count'
import type {
  BulkOpeningStockInput,
  BulkOpeningStockSummary,
  OpenedOpeningStockRow,
  OpeningStockEntry,
  OpeningStockSkip,
  OpeningStockSkipReason,
  PartKindSkip,
} from './types'

const logger = createScopedLogger('receiving:bulk-opening-stock')

/** The legal `part_kind` values, from the registry enum, so a fourth kind is legal here the day it is there. */
const PART_KINDS: ReadonlySet<string> = new Set(PartKind.values.map((option) => option.value))

export async function bulkOpenStockBalance(
  db: Database,
  organizationId: string,
  userId: string,
  input: BulkOpeningStockInput
): Promise<Result<BulkOpeningStockSummary, Error>> {
  return guard(
    async () => {
      const partDefId = await requireCachedEntityDefId(organizationId, 'part')
      const movementDefId = await systemDefId(db, organizationId, 'stock_movement')
      if (!movementDefId) {
        throw new NotFoundError('This organization has no stock_movement entity definition')
      }
      await assertCostFieldsMaterialized(
        organizationId,
        'Set count is not available until the stock movement cost fields are provisioned'
      )

      const excluded: OpeningStockSkip[] = []
      const failed: OpeningStockSkip[] = []
      const requested = input.entries.length

      const accepted = acceptEntries(input.entries, excluded, failed)

      const parts = await readParts(db, organizationId, partDefId, [...accepted.keys()])
      dropWhere(accepted, failed, (partId) => {
        if (parts.has(partId)) return null
        return { reason: 'unknown_part', detail: 'No such part in this organization' }
      })
      dropWhere(accepted, failed, (partId) => {
        if (!isServicePartKind(parts.get(partId)?.kind)) return null
        return { reason: 'service_part', detail: 'A service is not stocked, so it has no count' }
      })

      // Re-read inside the run rather than trusted from the list the browser was handed.
      if (!input.adjustAnchored) {
        const anchored = await readPartInitials(db, organizationId, [...accepted.keys()])
        dropWhere(accepted, excluded, (partId) => {
          if (!anchored.has(partId)) return null
          return {
            reason: 'already_has_initial',
            detail:
              'This part is already anchored by a count. A further count writes an adjustment for the difference; set it from the part itself.',
          }
        })
      }

      const opened: OpenedOpeningStockRow[] = []
      for (const entry of accepted.values()) {
        const result = await setCount(db, organizationId, {
          partId: entry.partId,
          quantity: entry.quantity,
          day: entry.day ?? input.day,
          unitCost: entry.unitCost,
          actorUserId: userId,
        })
        if (result.isErr()) {
          failed.push({
            partId: entry.partId,
            reason: 'write_failed',
            detail: result.error.message,
          })
          continue
        }
        const count = result.value
        if (count.outcome === 'unchanged' || !count.movement) {
          excluded.push({
            partId: entry.partId,
            reason: 'unchanged',
            detail: count.standardCostChange
              ? `The ledger already read ${count.countQuantity} on ${count.countDate}; only the standard cost was updated`
              : `The ledger already read ${count.countQuantity} on ${count.countDate}; nothing was written`,
            ...(count.standardCostChange ? { standardCostChange: count.standardCostChange } : {}),
          })
          continue
        }
        opened.push({
          partId: entry.partId,
          outcome: count.outcome,
          movementId: count.movement.movementId,
          recordId: count.movement.recordId,
          quantity: count.movement.quantity,
          countDate: count.countDate,
          unitCost: count.movement.unitCost,
          extendedCost: count.movement.extendedCost,
          glAccount: count.movement.glAccount ?? '',
          pending: count.pending,
          standardCostChange: count.standardCostChange,
        })
      }

      logger.info('Set counts in bulk', {
        organizationId,
        requested,
        opened: opened.length,
        excluded: excluded.length,
        failed: failed.length,
      })

      return {
        day: input.day ?? null,
        requested,
        opened,
        excluded,
        failed,
        totalsByGlAccount: totalByGlAccount(opened),
      }
    },
    'Failed to set counts in bulk',
    { organizationId, entries: input.entries.length }
  )
}

/**
 * Set `part_kind` on many parts at once - the confirm that must precede the run.
 *
 * The kind decides the account, and the account is frozen onto an `updatable: false`
 * movement (§6.3), so this is its own door on the same screen, ahead of the write, and a write
 * of a confirmed value never a derivation (`part-kind-derivation.ts` promotes to `subassembly`
 * only). Validated against the registry here, not only in the router's schema, because an
 * unrecognised value stores as an `optionId` nothing maps and reads as the default account.
 *
 * @returns How many parts the write changed, and each part refused as a `service` (107 F3).
 */
export async function bulkSetPartKind(
  db: Database,
  organizationId: string,
  userId: string,
  partIds: string[],
  kind: string
): Promise<Result<{ count: number; failed: PartKindSkip[] }, Error>> {
  return guard(
    async () => {
      if (!PART_KINDS.has(kind)) {
        throw new BadRequestError(
          `"${kind}" is not a part kind. Expected one of: ${[...PART_KINDS].join(', ')}.`
        )
      }

      const unique = [...new Set(partIds.filter(Boolean))]
      const failed: PartKindSkip[] = []
      let writable = unique
      if (isServicePartKind(kind)) {
        // Mirrors the `part_kind` field guard so one blocked part does not fail the whole write.
        const blockers = await readServiceKindBlockers(db, organizationId, unique)
        writable = unique.filter((partId) => {
          const reason = blockers.get(partId)
          if (reason) failed.push({ partId, detail: serviceKindRefusal(reason) })
          return !reason
        })
      }
      if (writable.length === 0) return { count: 0, failed }

      const partDefId = await requireCachedEntityDefId(organizationId, 'part')
      const fields = await systemFieldMap(db, organizationId, PART_KIND_PICK)
      const kindField = fields.part_kind
      if (!kindField) {
        throw new UnprocessableEntityError('This organization has no part kind field')
      }

      const crud = new UnifiedCrudHandler(organizationId, userId, db)
      const recordIds = writable.map((partId) => toRecordId(partDefId, partId) as RecordId)
      const { count } = await crud.bulkSetFieldValue(recordIds, kindField.id, kind)
      return { count, failed }
    },
    'Failed to set part kind in bulk',
    { organizationId, partIds: partIds.length, kind }
  )
}

/** Validate every entry and drop the duplicates, keeping the FIRST occurrence of each part. */
function acceptEntries(
  entries: readonly OpeningStockEntry[],
  excluded: OpeningStockSkip[],
  failed: OpeningStockSkip[]
): Map<string, OpeningStockEntry> {
  const accepted = new Map<string, OpeningStockEntry>()
  const seen = new Set<string>()

  for (const entry of entries) {
    const partId = entry.partId?.trim()
    if (!partId) {
      failed.push({ partId: entry.partId ?? '', reason: 'unknown_part', detail: 'No part id' })
      continue
    }
    if (seen.has(partId)) {
      excluded.push({
        partId,
        reason: 'duplicate_entry',
        detail: 'This part appears more than once in the run; only the first entry was used',
      })
      continue
    }
    seen.add(partId)

    const quantityRefusal = refuseCountQuantity(entry.quantity)
    if (quantityRefusal) {
      failed.push({ partId, reason: 'invalid_quantity', detail: quantityRefusal })
      continue
    }
    const costRefusal = entry.unitCost == null ? null : refuseCountUnitCost(entry.unitCost)
    if (costRefusal) {
      failed.push({ partId, reason: 'invalid_unit_cost', detail: costRefusal })
      continue
    }

    accepted.set(partId, { ...entry, partId })
  }

  return accepted
}

function refuseCountQuantity(quantity: number): string | null {
  if (!Number.isFinite(quantity)) return 'A count must be a finite number'
  if (quantity < 0) return 'A count cannot be negative. Enter how many units are on the shelf.'
  return null
}

/** Finite, zero or more, and no finer than a RATE - never rounded into a legal value. */
function refuseCountUnitCost(unitCost: number): string | null {
  if (!Number.isFinite(unitCost) || !isAtPrecision(unitCost, RATE_DECIMALS)) {
    return 'A unit cost must have at most five decimal places'
  }
  if (unitCost < 0) return 'A unit cost cannot be negative'
  return null
}

/** Remove every accepted part the verdict names, recording why, so `opened + excluded + failed` accounts for every entry. */
function dropWhere(
  accepted: Map<string, OpeningStockEntry>,
  into: OpeningStockSkip[],
  verdict: (partId: string) => { reason: OpeningStockSkipReason; detail: string } | null
): void {
  for (const partId of [...accepted.keys()]) {
    const refusal = verdict(partId)
    if (!refusal) continue
    accepted.delete(partId)
    into.push({ partId, ...refusal })
  }
}

const PART_KIND_PICK = pickSystemAttributes(PART_FIELDS, ['part_kind'] as const)

interface PartRow {
  displayName: string | null
  kind: string | null
}

/** The parts the run named, with their kinds. Archived parts are excluded: they are not counted. */
async function readParts(
  db: Database,
  organizationId: string,
  partDefId: string,
  partIds: string[]
): Promise<Map<string, PartRow>> {
  const parts = new Map<string, PartRow>()
  if (partIds.length === 0) return parts

  const fields = await systemFieldMap(db, organizationId, PART_KIND_PICK)
  const rows = await readSystemRecords(
    db,
    organizationId,
    { defId: partDefId, fields },
    { ids: partIds }
  )

  for (const row of rows) {
    parts.set(row.id, { displayName: row.displayName, kind: row.option('part_kind') })
  }
  return parts
}

/** The run's value by inventory account, from the rows actually written and priced. */
function totalByGlAccount(
  opened: readonly OpenedOpeningStockRow[]
): BulkOpeningStockSummary['totalsByGlAccount'] {
  const totals = new Map<string, { glAccount: string; partCount: number; extendedCost: number }>()
  for (const row of opened) {
    if (row.extendedCost == null) continue
    const total = totals.get(row.glAccount) ?? {
      glAccount: row.glAccount,
      partCount: 0,
      extendedCost: 0,
    }
    total.partCount += 1
    total.extendedCost += row.extendedCost
    totals.set(row.glAccount, total)
  }
  return [...totals.values()].sort((a, b) => a.glAccount.localeCompare(b.glAccount))
}
