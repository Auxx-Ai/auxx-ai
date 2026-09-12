// packages/lib/src/receiving/bulk-opening-stock.ts

/**
 * `bulkOpenStockBalance` - the opening balance for a whole org, in one pass.
 *
 * plans/money/tasks/52-parts-costing-page.md §5.
 *
 * The single-part door (`open-stock-balance.ts`) is the contract this
 * generalises, and its five ordered steps are preserved exactly. What changes is
 * that each one is asked of the whole set at once:
 *
 * 1. `quantity > 0` and `unitCost > 0` at `RATE_DECIMALS`, or the ENTRY is
 *    refused - never the run.
 * 2. 🛑 A part that already has ANY `stock_movement` is EXCLUDED, not an error.
 *    Opening is once, and this guard is what stops the page becoming a back
 *    door into hand-valuing an adjustment.
 * 3. `ensureStandardCost` with `kind: 'opening-stock'`, called once per
 *    DISTINCT unit cost.
 * 4. One `initial` movement per surviving part through
 *    `UnifiedCrudHandler.bulkCreate`, at `cost_basis: standard`, with
 *    `gl_account` from `resolveInventoryRoleForPartKind` and
 *    `adjustSubparts: false`.
 * 5. QoH, by the trigger. See "Quantity on hand" below.
 *
 * ## 🛑 It never throws, and one refused part must not lose the other 494
 *
 * The discipline `money/fulfillment-posting/run.ts` and `executeBackfill` keep:
 * per-part isolation, and a summary that names what did not happen and why.
 * Only a WHOLE-RUN precondition - no `part` definition, no `stock_movement`
 * definition, cost fields not materialised - comes back as an `err`, because
 * none of those is about a part and all of them refuse every entry identically.
 *
 * ## Quantity on hand
 *
 * ✅ This writes on the ORDINARY lane, so `mfg-stock-movements-created` fires
 * per movement and `recalculatePartQoH` (its second action) is what updates
 * `part_quantity_on_hand`. HANDOFF rule 5 does NOT apply and the caller must
 * NOT call `batchRecalculateQoH` - quantity on hand has exactly one owner, and
 * a second writer here would give the same number two.
 *
 * ⚠️ `explodeBomMovement` (the rule's FIRST action) is a no-op on every row:
 * it guards on `stock_movement_adjust_subparts` as its third statement, before
 * any query, and step 4 writes `false` on every one. `recalculatePurchaseOrderLineReceived`
 * (its third) is a no-op too - an opening balance carries no purchase order line.
 *
 * ## 🛑 `ensureStandardCost` takes ONE cost for the whole array
 *
 * `ensure-standard-cost.ts:143` calls `previousStandardCost == null` THE ONE
 * RULE: it writes only where `part_standard_cost IS NULL` and never overwrites.
 * So the caller's cost is not a per-part map - it is one number applied to every
 * part named in that call. Entries are therefore grouped by DISTINCT unit cost
 * and the function is called once per group.
 *
 * That still leaves §6.1's trap: for a part that already HAS a standard, step 3
 * is a documented no-op, and a movement stamped `cost_basis: standard` would
 * then carry a cost the standard disagrees with. The sequence (roll first,
 * default the cost column to the standard) is the fix; what this file adds is
 * the post-condition the single-part door already has - the part's standard is
 * RE-READ after step 3, and a part left holding `null`, `0` or a negative is
 * dropped to `failed` rather than given a movement nothing downstream can value.
 *
 * No permission checks: the router asserts (`docs/lib-module-guide.md` §6).
 */

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { isAtPrecision, RATE_DECIMALS } from '@auxx/utils/currency'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Result } from 'neverthrow'
import { ensureStandardCost } from '../builds/ensure-standard-cost'
import { getCachedEntityDefId, getOrgCache, requireCachedEntityDefId } from '../cache'
import { BadRequestError, NotFoundError, UnprocessableEntityError } from '../errors'
import { UnifiedCrudHandler } from '../resources/crud/unified-handler'
import {
  PartKind,
  StockMovementCostBasis,
  StockMovementType,
} from '../resources/registry/enum-values'
import { type RecordId, toRecordId } from '../resources/resource-id'
import { buildStockMovementValues } from '../stock-movements'
import { resolveInventoryRoleForPartKind } from './client'
import { assertCostFieldsMaterialized } from './cost-fields'
import { guard } from './guard'
import type {
  BulkOpeningStockInput,
  BulkOpeningStockSummary,
  OpenedOpeningStockRow,
  OpeningStockEntry,
  OpeningStockSkip,
  OpeningStockSkipReason,
} from './types'

const logger = createScopedLogger('receiving:bulk-opening-stock')

/**
 * The legal `part_kind` values, read from the registry enum rather than
 * restated, so a fourth kind is legal here the day it is legal there.
 */
const PART_KINDS: ReadonlySet<string> = new Set(PartKind.values.map((option) => option.value))

/**
 * Open a balance for every named part, once.
 *
 * @param input The single accounting date the whole run is stamped with, and
 *   one entry per part. An opening balance is ONE event on ONE date; a date per
 *   row would invite 495 dates for it.
 */
export async function bulkOpenStockBalance(
  db: Database,
  organizationId: string,
  userId: string,
  input: BulkOpeningStockInput
): Promise<Result<BulkOpeningStockSummary, Error>> {
  return guard(
    async () => {
      // Whole-run preconditions. None of these is about a part, and every one of
      // them refuses every entry identically, so they are errors rather than
      // rows in the summary.
      const partDefId = await requireCachedEntityDefId(organizationId, 'part')
      const movementDefId = await getCachedEntityDefId(organizationId, 'stock_movement')
      if (!movementDefId) {
        throw new NotFoundError('This organization has no stock_movement entity definition')
      }
      await assertCostFieldsMaterialized(
        organizationId,
        'Opening stock is not available until the stock movement cost fields are provisioned'
      )

      const occurredAt = input.occurredAt ?? new Date()
      const excluded: OpeningStockSkip[] = []
      const failed: OpeningStockSkip[] = []
      const requested = input.entries.length

      // Step 1: per-entry validation and de-duplication.
      const accepted = acceptEntries(input.entries, excluded, failed)

      // Step 2a: a stale id must not invent a write target, and the kind decides
      // the account, so both are read in the same statement.
      const parts = await readParts(db, organizationId, partDefId, [...accepted.keys()])
      dropWhere(accepted, failed, (partId) => {
        if (parts.has(partId)) return null
        return { reason: 'unknown_part', detail: 'No such part in this organization' }
      })

      // Step 2b: 🛑 the load-bearing guard, re-read inside this pass rather than
      // trusted from whatever list the browser was handed (§6.2).
      const alreadyMoved = await readPartsWithMovements(db, organizationId, movementDefId, [
        ...accepted.keys(),
      ])
      dropWhere(accepted, excluded, (partId) => {
        if (!alreadyMoved.has(partId)) return null
        return {
          reason: 'already_has_movements',
          detail:
            'This part already has stock movements. An opening balance is the first thing that ever happens to a part; correct a count with an adjustment instead.',
        }
      })

      // Step 3: one call per DISTINCT unit cost. See the file header.
      await setFirstStandardCosts(db, organizationId, accepted, failed)

      // Step 3b: the post-condition, verified rather than assumed (§6.1).
      const standards = await readPartStandardCosts(db, organizationId, [...accepted.keys()])
      dropWhere(accepted, failed, (partId) => {
        const standard = standards.get(partId) ?? null
        if (standard != null && Number.isFinite(standard) && standard > 0) return null
        const label = parts.get(partId)?.displayName
        return {
          reason: 'no_standard_cost',
          detail: `Could not set a standard cost for ${label ? `"${label}"` : `part ${partId}`}, so its opening stock was not recorded. Stock that carries no standard cost cannot be adjusted, built or closed.`,
        }
      })

      // Step 4: the movements. Step 5 happens on its own.
      const opened = await writeInitialMovements(db, organizationId, userId, {
        movementDefId,
        partDefId,
        occurredAt,
        entries: [...accepted.values()],
        kindByPartId: new Map([...parts].map(([id, part]) => [id, part.kind])),
        failed,
      })

      logger.info('Opened stock balances in bulk', {
        organizationId,
        requested,
        opened: opened.length,
        excluded: excluded.length,
        failed: failed.length,
      })

      return {
        occurredAt,
        requested,
        opened,
        excluded,
        failed,
        totalsByGlAccount: totalByGlAccount(opened),
      }
    },
    'Failed to open stock balances in bulk',
    { organizationId, entries: input.entries.length }
  )
}

/**
 * Set `part_kind` on many parts at once - the confirm that must precede the run.
 *
 * 🛑 **The kind decides the account, and the account is frozen onto an
 * `updatable: false` movement** (§6.3). A part opened as `component` that was a
 * finished good is corrected only by reversing the movement and writing a new
 * one, which leaves two rows in an append-only ledger forever. That is why this
 * exists as its own door on the same screen, ahead of the write, rather than as
 * something the run infers.
 *
 * ⚠️ It is a WRITE OF A CONFIRMED VALUE, never a derivation. The
 * `finished_good` suggestion is offered by `shouldSuggestFinishedGood` and
 * chosen by a person; `field-hooks/post/part-kind-derivation.ts` promotes to
 * `subassembly` only and never to `finished_good`, for exactly this reason.
 *
 * Goes through `UnifiedCrudHandler.bulkSetFieldValue`, which fans out through
 * `setBulkValues` - so the field hooks, the realtime frames and the uniqueness
 * gates all behave as they do on a single edit.
 *
 * 🛑 **The kind is validated HERE, not only in the router's input schema.**
 * `part_kind` is a SINGLE_SELECT and an unrecognised value would store as an
 * `optionId` nothing maps, which `resolveInventoryRoleForPartKind` then reads as
 * the default - silently posting a finished good to Raw Materials. A router
 * schema protects one door; this protects the worker, the seeder and every
 * later caller too.
 *
 * @param kind A `PartKind` value: `component`, `subassembly` or `finished_good`.
 * @returns How many parts the write actually changed.
 */
export async function bulkSetPartKind(
  db: Database,
  organizationId: string,
  userId: string,
  partIds: string[],
  kind: string
): Promise<Result<{ count: number }, Error>> {
  return guard(
    async () => {
      if (!PART_KINDS.has(kind)) {
        throw new BadRequestError(
          `"${kind}" is not a part kind. Expected one of: ${[...PART_KINDS].join(', ')}.`
        )
      }

      const unique = [...new Set(partIds.filter(Boolean))]
      if (unique.length === 0) return { count: 0 }

      const partDefId = await requireCachedEntityDefId(organizationId, 'part')
      const fields = await getOrgCache()
        .from(organizationId, 'customFields')
        .bySystemAttributes(['part_kind'])
      const kindField = fields.part_kind
      if (!kindField) {
        throw new UnprocessableEntityError('This organization has no part kind field')
      }

      const crud = new UnifiedCrudHandler(organizationId, userId, db)
      const recordIds = unique.map((partId) => toRecordId(partDefId, partId) as RecordId)
      return crud.bulkSetFieldValue(recordIds, kindField.id, kind)
    },
    'Failed to set part kind in bulk',
    { organizationId, partIds: partIds.length, kind }
  )
}

/**
 * Step 1: validate every entry and drop the duplicates, keeping the FIRST
 * occurrence of each part.
 *
 * A duplicate is an exclusion rather than a failure: the part IS opened, once,
 * which is what the caller meant. A second `initial` movement for it would be
 * the exact thing step 2 exists to refuse.
 */
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

    const quantityRefusal = refuseOpeningQuantity(entry.quantity)
    if (quantityRefusal) {
      failed.push({ partId, reason: 'invalid_quantity', detail: quantityRefusal })
      continue
    }
    const costRefusal = refuseOpeningUnitCost(entry.unitCost)
    if (costRefusal) {
      failed.push({ partId, reason: 'invalid_unit_cost', detail: costRefusal })
      continue
    }

    accepted.set(partId, { partId, quantity: entry.quantity, unitCost: entry.unitCost })
  }

  return accepted
}

/**
 * Step 1a, per entry: the opening quantity must be finite and strictly above
 * zero. `assertOpeningQuantity`'s rule, returning the refusal instead of
 * throwing it.
 *
 * `Number.isFinite` is checked as well as the sign: `NaN > 0` is false but so is
 * `NaN <= 0`, and an `Infinity` quantity multiplies into an `extendedCost` of
 * `Infinity` that `Math.round` preserves and every later `SUM` is poisoned by.
 *
 * A negative opening balance is refused rather than reinterpreted. Starting life
 * owing stock is not an opening balance, it is a count correction, and that door
 * is `adjustStock`.
 */
function refuseOpeningQuantity(quantity: number): string | null {
  if (!Number.isFinite(quantity)) return 'Opening quantity must be a finite number'
  if (quantity <= 0) {
    return 'Opening quantity must be greater than zero. A part with no stock needs no opening balance.'
  }
  return null
}

/**
 * Step 1b, per entry: `assertOpeningUnitCost`'s rule, returning the refusal.
 *
 * 🛑 **A fractional input is NOT rounded down into a legal value.** A receipt
 * derives its cost from supplier terms and rounds the result; an opening balance
 * is typed, by a person looking at what was paid, so a value finer than
 * `stock_movement_unit_cost` can hold (`RATE_DECIMALS` - five major-unit places)
 * means the caller is working in the wrong units, and silently rounding it would
 * freeze that mistake onto an append-only row forever.
 *
 * Zero is refused for the reason `receiveStock` refuses it: a zero frozen onto
 * an append-only row sums into the inventory balance as nothing and cannot be
 * told apart from a genuinely free part.
 */
function refuseOpeningUnitCost(unitCost: number): string | null {
  if (!Number.isFinite(unitCost) || !isAtPrecision(unitCost, RATE_DECIMALS)) {
    return 'Opening unit cost must have at most five decimal places'
  }
  if (unitCost <= 0) {
    return 'Refusing to open a stock balance at zero cost. Enter what a unit actually cost.'
  }
  return null
}

/**
 * Remove every accepted part the verdict names, recording why.
 *
 * One helper for all four drop points so a part can never leave `accepted`
 * without a row in the summary explaining it - the property that makes
 * `opened + excluded + failed` account for every entry.
 */
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

/** One part, as the run needs it: does it exist, what is it called, what kind is it. */
interface PartRow {
  displayName: string | null
  kind: string | null
}

/**
 * The parts the run named, with their kinds, in one statement.
 *
 * Archived parts are excluded: giving an opening balance to a part somebody
 * removed writes a ledger row nothing will ever look at.
 */
async function readParts(
  db: Database,
  organizationId: string,
  partDefId: string,
  partIds: string[]
): Promise<Map<string, PartRow>> {
  const parts = new Map<string, PartRow>()
  if (partIds.length === 0) return parts

  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['part_kind'])
  const kindValue = alias(schema.FieldValue, 'bos_kind')

  const rows = await db
    .select({
      partId: schema.EntityInstance.id,
      displayName: schema.EntityInstance.displayName,
      kind: kindValue.optionId,
    })
    .from(schema.EntityInstance)
    .leftJoin(
      kindValue,
      and(
        eq(kindValue.entityId, schema.EntityInstance.id),
        eq(kindValue.organizationId, schema.EntityInstance.organizationId),
        eq(kindValue.fieldId, fields.part_kind?.id ?? '')
      )
    )
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, partDefId),
        isNull(schema.EntityInstance.archivedAt),
        inArray(schema.EntityInstance.id, partIds)
      )
    )

  for (const row of rows) {
    parts.set(row.partId, { displayName: row.displayName, kind: row.kind })
  }
  return parts
}

/**
 * Step 2: every named part that already has ANY `stock_movement`, in one read.
 *
 * The bulk form of `assertPartHasNoMovements`, and it lives here for the same
 * reason that one lives in `open-stock-balance.ts`: it is not a receipt read, it
 * is this writer's own precondition and has no other caller.
 *
 * ⚠️ Read-then-write with no DB constraint behind it. There is no uniqueness a
 * `FieldValue` row can express, so two runs racing at the same instant would
 * both pass - the same window the single-part door has, and the reason §6.2 says
 * this read must happen INSIDE the run rather than being taken from the
 * candidate list the page was rendered from.
 *
 * Archived movements still count. A soft-deleted movement is a movement that
 * happened, and letting an archive re-open the door would make the guard
 * bypassable by anybody who could archive a row.
 */
async function readPartsWithMovements(
  db: Database,
  organizationId: string,
  movementDefId: string,
  partIds: string[]
): Promise<Set<string>> {
  const moved = new Set<string>()
  if (partIds.length === 0) return moved

  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['stock_movement_part'])
  const partField = fields.stock_movement_part
  if (!partField) {
    throw new UnprocessableEntityError(
      'This organization has no stock_movement part field, so an opening balance cannot be linked to a part'
    )
  }

  const rows = await db
    .selectDistinct({ partId: schema.FieldValue.relatedEntityId })
    .from(schema.EntityInstance)
    .innerJoin(
      schema.FieldValue,
      and(
        eq(schema.FieldValue.entityId, schema.EntityInstance.id),
        eq(schema.FieldValue.organizationId, schema.EntityInstance.organizationId),
        eq(schema.FieldValue.fieldId, partField.id)
      )
    )
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, movementDefId),
        inArray(schema.FieldValue.relatedEntityId, partIds)
      )
    )

  for (const row of rows) {
    if (row.partId) moved.add(row.partId)
  }
  return moved
}

/**
 * Step 3: give every surviving part a standard cost, grouped by DISTINCT unit
 * cost.
 *
 * 🛑 `ensureStandardCost` takes `partIds: string[]` but ONE `source.unitCost`,
 * so a single call over mixed costs would freeze the first group's number onto
 * every part in the run. Grouping is not an optimisation - it is the only way to
 * call it correctly with more than one cost in play.
 *
 * A group that errs fails only its own parts. `ensureStandardCost` is documented
 * as never throwing on an unvaluable part, so a returned error means something
 * upstream genuinely declined, and writing the movements anyway would produce
 * the one state the subsystem exists to exclude: a part holding stock with no
 * standard to value it at.
 */
async function setFirstStandardCosts(
  db: Database,
  organizationId: string,
  accepted: Map<string, OpeningStockEntry>,
  failed: OpeningStockSkip[]
): Promise<void> {
  const byUnitCost = new Map<number, string[]>()
  for (const entry of accepted.values()) {
    const group = byUnitCost.get(entry.unitCost) ?? []
    group.push(entry.partId)
    byUnitCost.set(entry.unitCost, group)
  }

  for (const [unitCost, partIds] of byUnitCost) {
    const ensured = await ensureStandardCost(db, organizationId, partIds, {
      kind: 'opening-stock',
      unitCost,
    })
    if (ensured.isOk()) continue

    for (const partId of partIds) {
      accepted.delete(partId)
      failed.push({
        partId,
        reason: 'no_standard_cost',
        detail: ensured.error.message,
      })
    }
  }
}

/** Step 3b: the stored `part_standard_cost` of every named part, in one read. */
async function readPartStandardCosts(
  db: Database,
  organizationId: string,
  partIds: string[]
): Promise<Map<string, number | null>> {
  const standards = new Map<string, number | null>()
  if (partIds.length === 0) return standards

  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['part_standard_cost'])
  const standardField = fields.part_standard_cost
  if (!standardField) return standards

  const rows = await db
    .select({
      partId: schema.FieldValue.entityId,
      standardCost: schema.FieldValue.valueNumber,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, standardField.id),
        inArray(schema.FieldValue.entityId, partIds)
      )
    )

  for (const row of rows) {
    standards.set(row.partId, row.standardCost)
  }
  return standards
}

interface WriteInitialMovementsArgs {
  movementDefId: string
  partDefId: string
  occurredAt: Date
  entries: readonly OpeningStockEntry[]
  kindByPartId: ReadonlyMap<string, string | null>
  failed: OpeningStockSkip[]
}

/**
 * Step 4: one `initial` movement per part, through `UnifiedCrudHandler.bulkCreate`.
 *
 * 🛑 **The `unit_cost` is the CALLER's number, and this is the only movement
 * writer where that is true.** Everywhere else a caller-supplied cost is a
 * defect: `adjustStock` reads the standard because a count has no invoice
 * (`G12`), and `receiveStock`'s `unitCost` seam is internal to lib and rejected
 * by the router's input schema. Here the number IS the fact being recorded.
 *
 * 🛑 **`adjustSubparts: false` is load-bearing, not a default.**
 * `explodeBomMovement` inherits the parent movement's type AND its sign, so an
 * opening balance with the flag set would open a balance for every component in
 * the bill of materials as well: ten assemblies on the shelf would claim ten of
 * every screw inside them, on top of whatever opening balance those screws were
 * given in their own right.
 *
 * 🛑 **The account is a ROLE resolved from the part kind, never a number.**
 * `resolveInventoryRoleForPartKind` is the ONE map (decision `G8`); a hardcoded
 * `'1310'` stamped onto 495 `updatable: false` rows would be uncorrectable the
 * day an org renumbers its chart.
 *
 * `bulkCreate` reports failures BY INDEX and returns the successes in order, so
 * the two are re-paired by walking the input positions and consuming `created`
 * as the non-failed ones go past.
 *
 * 🛑 **Not `writeStockMovements`.** This is the one writer whose cardinality is
 * `bulkCreate` with per-INDEX failure tolerance - a bad part must not lose the
 * other 494 - which `stock-movements/write-movements.ts` does not attempt to
 * unify (plans/money/tasks/50-batch-inventory-relief.md §2.2 does not name
 * cardinality as a shared axis). It DOES share
 * `stock-movements/buildStockMovementValues` for the nine keys and the sign
 * convention, so the `adjustSubparts: false` default has one definition
 * regardless of which of the six writers reaches it.
 */
async function writeInitialMovements(
  db: Database,
  organizationId: string,
  userId: string,
  args: WriteInitialMovementsArgs
): Promise<OpenedOpeningStockRow[]> {
  const { movementDefId, partDefId, occurredAt, entries, kindByPartId, failed } = args
  if (entries.length === 0) return []

  const planned = entries.map((entry) => {
    const glAccount = resolveInventoryRoleForPartKind(kindByPartId.get(entry.partId))
    const values = buildStockMovementValues({
      partRecordId: toRecordId(partDefId, entry.partId),
      type: StockMovementType.INITIAL,
      quantity: entry.quantity,
      unitCost: entry.unitCost,
      // `standard`, not `actual`. There is no vendor row, no purchase order and
      // no packing slip behind an opening balance, and step 3 has just made
      // this cost BE the part's standard, so `standard` is the honest
      // description of it.
      costBasis: StockMovementCostBasis.STANDARD,
      glAccount,
      // One date for the whole run: an opening balance is one event, on one date.
      occurredAt,
    })
    return { entry, glAccount, extendedCost: values.stock_movement_extended_cost as number, values }
  })

  const items: Record<string, unknown>[] = planned.map(({ values }) => values)

  const crud = new UnifiedCrudHandler(organizationId, userId, db)
  const { created, errors } = await crud.bulkCreate(movementDefId, items)

  const errorByIndex = new Map(errors.map((error) => [error.index, error.error]))
  const opened: OpenedOpeningStockRow[] = []
  let cursor = 0

  for (let index = 0; index < planned.length; index++) {
    const { entry, glAccount, extendedCost } = planned[index]!
    const failure = errorByIndex.get(index)
    if (failure !== undefined) {
      failed.push({ partId: entry.partId, reason: 'write_failed', detail: failure })
      continue
    }
    const instance = created[cursor++]
    if (!instance) {
      // Belt: `bulkCreateEntities` reports every item as either a success or an
      // indexed error, so this is unreachable. Reporting it beats silently
      // returning fewer rows than were written.
      failed.push({
        partId: entry.partId,
        reason: 'write_failed',
        detail: 'The write reported neither a movement nor an error',
      })
      continue
    }
    opened.push({
      partId: entry.partId,
      movementId: instance.id,
      recordId: toRecordId(movementDefId, instance.id),
      quantity: entry.quantity,
      unitCost: entry.unitCost,
      extendedCost,
      glAccount,
    })
  }

  return opened
}

/**
 * The opening journal entry, by inventory account.
 *
 * The sum of every opening balance IS the opening inventory on the balance
 * sheet, and the per-account split is literally the entry the run produces
 * (§2.3). Derived from the rows that were actually written, never from the ones
 * that were planned.
 */
function totalByGlAccount(
  opened: readonly OpenedOpeningStockRow[]
): BulkOpeningStockSummary['totalsByGlAccount'] {
  const totals = new Map<string, { glAccount: string; partCount: number; extendedCost: number }>()
  for (const row of opened) {
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
