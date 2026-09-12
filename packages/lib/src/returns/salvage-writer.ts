// packages/lib/src/returns/salvage-writer.ts

/**
 * Step 7 of plans/money/tasks/54-returns.md: the salvage writer.
 *
 * One `return_in` `stock_movement` per **highest `good` node in each branch** of
 * a return line's salvage tree, valued at
 * `round(part_standard_cost x salvagePercent / 100)`, with that unit cost frozen
 * back onto the `return_part_line` row alongside a link to the movement it
 * produced (section 6.3 and section 6.4).
 *
 * ## What this is NOT
 *
 * 🔧 **A caller of `writeStockMovements`, never a ninth hand-rolled insert.**
 * `stock-movements/` is the one writer (task 50 section 2), and three of the
 * rules this brief used to spell out are now properties of its contract rather
 * than things this file must remember: `adjustSubparts` is typed `?: true` so
 * silence is safe, `affectedPartIds` comes back from the call, and the link set
 * has one definition so a reversal copies all of it.
 *
 * ## The four things a salvage movement must not do
 *
 * 1. 🛑 **Never set `adjustSubparts`.** `field-hooks/post/bom-movement-triggers.ts`
 *    explodes a flagged movement into one child per LEAF subpart, so a flagged
 *    subassembly restock would put the subassembly and all of its leaves back:
 *    the same material twice, on an append-only ledger. `bom/qoh.ts` also
 *    EXCLUDES flagged rows from the on-hand SUM, so the row would be invisible
 *    to the exact number this writer exists to maintain. The whole point of
 *    restocking at the node the warehouse checked is that it is one movement.
 * 2. 🛑 **Never set `fulfillmentLine`.** That link is task 50's relief netting
 *    and nothing else. Task 50 section 1.1 and task 55 section 7 each deleted a
 *    scope rule that existed to stop a `return_in` reading as un-relief, both on
 *    the stated grounds that "54 points elsewhere" - this is that promise. If a
 *    salvage ever needs to name its dispatch, that is a field on `return_line`,
 *    never the movement's ledger link.
 * 3. 🛑 **Never write for `scrap` / `damaged` / `missing` / `undecided`.** A
 *    scrapped component was never in inventory - the lift was relieved at sale -
 *    so a scrap movement would invent a quantity in order to remove it. The
 *    `return_line` itself writes nothing either: the lift does not come back as
 *    a lift (section 6.1).
 * 4. 🛑 **Never write a zero-valued row.** A part whose `part_standard_cost` is
 *    null OR ZERO refuses, naming the part. Task 26 fixed the roll, but the
 *    handoff recorded 83 parts already rolled to `0`, and a zero passes every
 *    guard that tests `== null`.
 *
 * ⚠️ **Refusing diverges from relief on purpose** (task 50 section 4.2 warns and
 * never refuses). A refused relief loses a shipment that really happened and
 * cannot be re-derived; a refused salvage loses nothing, because the disposition
 * is already on the `return_part_line` and the movement can be written the
 * moment somebody costs the part. Two writers, two answers. Do not harmonise
 * them.
 *
 * ## Standard cost, not the ledger average
 *
 * Section 6.4, re-confirmed on 2026-09-11 against task 50's move to the average.
 * No org holds a single `initial` movement, so most parts have no average at
 * all and an average basis would gate this writer on opening stock and
 * backfilled builds; `salvagePercent` is a policy a warehouse worker has to be
 * able to defend ("60% of what this part is worth new"); and every other
 * movement putting a manufactured part INTO an account values it at standard.
 * There is deliberately no ledger-average read in this file.
 *
 * ## The quiet lane and its two obligations
 *
 * `quietSession`, not `skipEvents` - `builds/write-lane.ts` has the full
 * argument (two doors onto `explodeBomMovement`, and `skipEvents` closes one).
 * Silencing `mfg-stock-movements-created` also silences `recalculatePartQoH`, so
 * this file owes `batchRecalculateQoH` over the returned `affectedPartIds`
 * **after COMMIT** (`bom/qoh.ts` reads the global `database`, not the
 * transaction), and it owes the self-announce that the lane suppressed - for the
 * movement rows AND for the `return_part_line` rows whose frozen cost was
 * written on the same silent handler.
 *
 * ## Two private reads live here
 *
 * `readSalvagePartKinds` and `readReturnNumber` are queries inside a write file,
 * which `docs/lib-module-guide.md` section 5 would normally split out. Same
 * precedent and same reason as `relief/relieve.ts`'s `readPartKindsLocal`: they
 * are single-caller lookups this write needs and no read module owns. Anything a
 * surface would ever read belongs in `reads.ts` or `salvage-reads.ts`.
 *
 * No permission checks: the router asserts (`docs/lib-module-guide.md`
 * section 6).
 */

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { batchRecalculateQoH } from '../bom/qoh'
import { loadSubpartGraph } from '../bom/subpart-graph'
import { readStandardCost } from '../builds'
import { getOrgCache, requireCachedEntityDefId } from '../cache'
import { ConflictError, NotFoundError, UnprocessableEntityError } from '../errors'
import { getRealtimeService, publishRecordsChanged } from '../realtime'
import { reverseMovement } from '../receiving'
import { resolveInventoryRoleForPartKind } from '../receiving/client'
import { UnifiedCrudHandler } from '../resources/crud/unified-handler'
import { quietSession, type WriteSession } from '../resources/crud/write-origin'
import { StockMovementCostBasis, StockMovementType } from '../resources/registry/enum-values'
import { type RecordId, toRecordId } from '../resources/resource-id'
import {
  type StockMovementInput,
  type StockMovementsCtx,
  writeStockMovements,
} from '../stock-movements'
import { requireReturnPartLineFieldContext } from './field-context'
import { guard } from './guard'
import {
  type ReturnPartLineRecord,
  readReturnPartLine,
  readReturnPartLines,
  requireReturnLine,
} from './reads'
import { computeSalvageUnitCost } from './salvage-cost'
import { checkSalvageTree, selectSalvageMovementNodes } from './salvage-invariants'
import { assembleSalvageTree } from './salvage-reads'
import type { SalvageNode } from './types'

const logger = createScopedLogger('returns:salvage')

// ─── The write lane ─────────────────────────────────────────────────

/** The prose recorded on every silent salvage write. Greppable, and the audit trail. */
export const SALVAGE_WRITE_LANE_REASON =
  'the salvage writer posts its own return_in movements, freezes their unit cost onto the ' +
  'return part lines, and recalculates QoH after commit'

/**
 * The session both the movements and the `return_part_line` freeze writes go
 * through.
 *
 * One session and one `UnifiedCrudHandler` for the whole call, exactly as
 * `complete-build.ts` does: the handler is handed to `writeStockMovements` as
 * `ctx.handler` so a salvage has a single quiet-lane construction site rather
 * than one per write.
 */
export function salvageWriteSession(): WriteSession {
  return quietSession(SALVAGE_WRITE_LANE_REASON)
}

/**
 * Announce rows this writer wrote silently - the frame the quiet lane
 * suppressed.
 *
 * `builds/write-lane.ts`'s self-announce obligation, and it applies to both
 * definitions here: the ledger card renders the `stock_movement` rows and the
 * salvage card renders the `return_part_line` rows, and neither learns about a
 * silent write on its own.
 *
 * Tier-2 (`records:changed`), fire-and-forget, after the commit. No
 * `excludeSocketId`: the tab that pressed the button is the one most likely to
 * have the tree open.
 */
export function announceQuietSalvageWrites(
  organizationId: string,
  entityDefinitionId: string,
  recordIds: string[]
): void {
  if (recordIds.length === 0) return
  // 🛑 try/catch AND `.catch`, both - `getRealtimeService()` resolves transport
  // config and throws SYNCHRONOUSLY when it is absent, which a promise handler
  // never sees, and this runs after the commit, so a throw here must never read
  // back as a failed salvage.
  try {
    publishRecordsChanged(getRealtimeService(), organizationId, {
      entityDefinitionId,
      entries: recordIds.map((recordId) => ({ recordId })),
    }).catch(() => {})
  } catch {
    // Best effort. The next list fetch or channel rebind catches the rows up.
  }
}

// ─── writeSalvageMovements ──────────────────────────────────────────

/** One `return_in` this run wrote, and the row it froze onto. */
export interface SalvageMovementWritten {
  /** The `return_part_line` that produced it. */
  partLineId: string
  partId: string
  partName: string
  /** Units restocked. Always positive: a `return_in` puts stock back. */
  quantity: number
  salvagePercent: number
  /** `round(part_standard_cost x salvagePercent / 100)`, frozen on both rows. */
  unitCost: number
  movementId: string
}

export interface WriteSalvageMovementsInput {
  returnLineId: string
  /**
   * The movement's accounting date. Defaults to NOW.
   *
   * ⚠️ Deliberately not the return's inspection date. Section 3.3 is explicit
   * that a return straddling a period is correct accrual and that a salvage
   * must never be backdated to line up with the credit memo; defaulting to an
   * inspection stamp that may sit weeks back - possibly inside a closed period -
   * would be exactly that kind of implicit backdating. A caller that genuinely
   * knows the recovery date passes it.
   */
  occurredAt?: Date
}

/** What one salvage run did. Counts are per-RUN. */
export interface WriteSalvageMovementsResult {
  returnLineId: string
  movements: SalvageMovementWritten[]
  /** Distinct parts whose QoH this run recalculated. */
  affectedPartIds: string[]
  /**
   * `good` nodes skipped because their row already carries a `movement`.
   *
   * The ledger is append-only, so pressing the button twice must restock once.
   * A row corrected by {@link reverseSalvageMovement} keeps its link - that is
   * the audit trail of what was undone - and so stays skipped here.
   */
  skippedAlreadySalvaged: number
  /** `good` nodes of zero units. A decision about nothing writes nothing. */
  skippedZeroQuantity: number
}

/**
 * Write the `return_in` movements one return line's salvage tree implies.
 *
 * Refuses, writing nothing at all, when any of section 6.6's three invariants
 * fails over the tree (`checkSalvageTree`) or when a `salvagePercent` is outside
 * `0 < pct <= 100` (`computeSalvageUnitCost`). Refusing costs nothing: every
 * disposition is already stored on its `return_part_line`, so the run can be
 * repeated the moment the part is costed or the percentage fixed.
 *
 * Only the HIGHEST `good` node in each branch produces a movement.
 * `selectSalvageMovementNodes` answers that and this file does not re-derive it:
 * a `good` subassembly whose children are also `good` is one recovery, because
 * the subassembly went into inventory whole.
 */
export async function writeSalvageMovements(
  db: Database,
  organizationId: string,
  userId: string,
  input: WriteSalvageMovementsInput
): Promise<Result<WriteSalvageMovementsResult, Error>> {
  return guard(
    async () => {
      const ctx = await requireReturnPartLineFieldContext(organizationId)
      const line = await requireReturnLine(db, organizationId, input.returnLineId)
      const rows = await readReturnPartLines(db, organizationId, input.returnLineId)
      const tree = await assembleSalvageTree(db, organizationId, line, rows)

      // The bill of materials again, for invariant 2's allowances.
      // `assembleSalvageTree` loads it to build the tree and does not hand it
      // back; re-loading is one recursive CTE on a button press, and the
      // alternative - rebuilding the tree here - would give the writer its own
      // second definition of what the tree is.
      const graph = await loadSubpartGraph(organizationId, tree.rootPartId)

      const standardCosts = await readSalvageStandardCosts(
        db,
        organizationId,
        selectSalvageMovementNodes(tree.nodes)
      )

      // The single entry point for all three invariants (section 6.6), so they
      // cannot be applied in different combinations by different callers. It
      // answers with the nodes that move stock.
      const selected = checkSalvageTree({
        roots: tree.nodes,
        graph,
        rootPartId: tree.rootPartId,
        returnLineQuantity: tree.returnLineQuantity,
        standardCosts,
      })
      if (selected.isErr()) throw selected.error

      const rowsById = new Map(rows.map((row) => [row.id, row]))
      const pending: { node: SalvageNode; row: ReturnPartLineRecord; unitCost: number }[] = []
      let skippedAlreadySalvaged = 0
      let skippedZeroQuantity = 0

      for (const node of selected.value) {
        // A node's status can only be `good` because a row stores it, so a
        // selected node without one means the tree and the rows disagree. That
        // is a fault to report, never a movement to skip silently.
        const row = rowsById.get(node.key)
        if (!row) {
          throw new UnprocessableEntityError(
            `${node.partName} is marked good but has no stored salvage row any more`
          )
        }
        if (row.movementId) {
          skippedAlreadySalvaged++
          continue
        }
        if (!(node.quantity > 0)) {
          skippedZeroQuantity++
          continue
        }

        const unitCost = computeSalvageUnitCost({
          partId: node.partId,
          partName: node.partName,
          standardCost: standardCosts.get(node.partId) ?? null,
          salvagePercent: node.salvagePercent,
        })
        if (unitCost.isErr()) throw unitCost.error

        pending.push({ node, row, unitCost: unitCost.value })
      }

      if (pending.length === 0) {
        return {
          returnLineId: line.returnLineId,
          movements: [],
          affectedPartIds: [],
          skippedAlreadySalvaged,
          skippedZeroQuantity,
        }
      }

      const partIds = [...new Set(pending.map((entry) => entry.node.partId))]
      const partKinds = await readSalvagePartKinds(db, organizationId, partIds)
      const reason = await salvageMovementReason(db, organizationId, line.returnId)
      const occurredAt = input.occurredAt ?? new Date()

      const inputs: StockMovementInput[] = pending.map(({ node, unitCost }) => ({
        partInstanceId: node.partId,
        type: StockMovementType.RETURN_IN,
        // POSITIVE: a `return_in` puts units back on the shelf, which is also
        // how `reverse-movement.ts` reads it when it negates a `sale`.
        quantity: node.quantity,
        unitCost,
        // Standard x a stored policy percentage. Not a vendor's invoice price,
        // so `standard` is the honest one of the two basis values - the same
        // reading `adjustStock` and `completeBuild` take.
        costBasis: StockMovementCostBasis.STANDARD,
        glAccount: resolveInventoryRoleForPartKind(partKinds.get(node.partId) ?? null),
        occurredAt,
        reason,
        // 🛑 `adjustSubparts` omitted - the contract types it `?: true`, so
        //    silence is the safe answer and the only correct one here.
        // 🛑 `links` omitted entirely - a salvage carries no
        //    `stock_movement_fulfillment_line`, and there is nothing else on a
        //    return for the ledger's link set to point at.
      }))

      const [movementDefId, partDefId] = await Promise.all([
        requireCachedEntityDefId(organizationId, 'stock_movement'),
        requireCachedEntityDefId(organizationId, 'part'),
      ])

      const session = salvageWriteSession()
      let movements: SalvageMovementWritten[] = []
      let affectedPartIds: string[] = []

      // This function owns the transaction boundary - `writeStockMovements`
      // never opens one of its own - so the movements and the freeze writes
      // land or roll back together. A frozen cost without its movement, or a
      // movement nothing points at, are both worse than neither.
      await db.transaction(async (tx) => {
        const txDb = tx as unknown as Database
        // The one quiet-lane handler construction site for this call.
        const crud = new UnifiedCrudHandler(organizationId, userId, txDb, undefined, { session })
        const movementCtx: StockMovementsCtx = {
          db: txDb,
          organizationId,
          userId,
          movementDefId,
          partDefId,
          lane: { kind: 'quiet', session },
          handler: crud,
        }

        const written = await writeStockMovements(movementCtx, inputs)
        if (written.isErr()) throw written.error
        affectedPartIds = written.value.affectedPartIds

        // `records` comes back in the same order as `inputs`, which is
        // `pending`'s order.
        movements = written.value.records.map((record, index) => {
          const entry = pending[index]
          if (!entry) throw new Error('writeStockMovements returned more records than inputs')
          return {
            partLineId: entry.row.id,
            partId: entry.node.partId,
            partName: entry.node.partName,
            quantity: entry.node.quantity,
            salvagePercent: entry.node.salvagePercent,
            unitCost: entry.unitCost,
            movementId: record.movementId,
          }
        })

        // Section 6.4's "store both, always": the percentage is the input and
        // the unit cost is the output, and `part_standard_cost` is re-rolled, so
        // a year from now the percentage alone cannot reproduce the number the
        // movement carries. One bulk call rather than a row loop.
        const freeze = await crud.bulkUpdate(
          movements.map((movement) => ({
            recordId: toRecordId(ctx.returnPartLineDefId, movement.partLineId) as RecordId,
            values: {
              return_part_line_unit_cost: movement.unitCost,
              return_part_line_movement: toRecordId(movementDefId, movement.movementId),
            },
          }))
        )
        // `bulkUpdate` tolerates per-row failures; this caller must not. A row
        // that did not take its link points at no movement, and the next run
        // would restock the same material again.
        if (freeze.errors.length > 0) {
          const first = freeze.errors[0]
          throw new UnprocessableEntityError(
            `Could not record the salvage on its return part line: ${first?.error ?? 'unknown'}`
          )
        }
      })

      // ── Post-commit, both obligations ────────────────────────────────
      // The quiet lane silenced `recalculatePartQoH`, so this is the ONLY thing
      // that moves quantity on hand for these movements, and `bom/qoh.ts` reads
      // the global `database` rather than the transaction, so it must run here.
      await batchRecalculateQoH(organizationId, affectedPartIds)
      announceQuietSalvageWrites(
        organizationId,
        movementDefId,
        movements.map((movement) => movement.movementId)
      )
      announceQuietSalvageWrites(
        organizationId,
        ctx.returnPartLineDefId,
        movements.map((movement) => movement.partLineId)
      )

      logger.info('Wrote salvage movements for a return line', {
        organizationId,
        returnLineId: line.returnLineId,
        written: movements.length,
        skippedAlreadySalvaged,
        skippedZeroQuantity,
      })

      return {
        returnLineId: line.returnLineId,
        movements,
        affectedPartIds,
        skippedAlreadySalvaged,
        skippedZeroQuantity,
      }
    },
    'Failed to write salvage movements',
    { organizationId, returnLineId: input.returnLineId }
  )
}

// ─── reverseSalvageMovement ─────────────────────────────────────────

/**
 * Undo one salvage: the warehouse marked a row `good`, this writer ran, and
 * somebody then opened the crate properly and found it is scrap.
 *
 * Section 6.5's rule, and it is all this needs to be: **a correction is priced
 * at what was frozen, never re-priced.** `receiving/reverse-movement.ts` already
 * is that rule - it carries the original's frozen `unitCost` verbatim, refuses a
 * movement that is already reversed, and refuses to reverse a reversal - so this
 * function only resolves the row to its movement and hands over. Reversing a
 * $210 salvage at today's `standard x pct` would net the pair to a non-zero
 * amount of inventory value out of nothing, which is the exact costing bug that
 * module exists to avoid.
 *
 * ⤵️ **What it deliberately does not do:** write a `scrap` movement afterwards
 * (section 6.3 - the part was never in inventory, so there is nothing to remove)
 * and touch the row. The correction is the reversal, and then the warehouse
 * changes the row's status. Nothing else moves.
 *
 * 🛑 The row keeps its `movement` link and its frozen `unitCost`, which is why
 * {@link writeSalvageMovements} keeps skipping it. Re-salvaging a row after a
 * correction is not a case this brief defines; it would need the row's link
 * cleared, and inventing that here would be designing rather than building.
 *
 * The reversal runs on the ORDINARY lane, so `recalculatePartQoH` fires from the
 * rule and this function owes no post-commit recalculation of its own.
 */
export async function reverseSalvageMovement(
  db: Database,
  organizationId: string,
  userId: string,
  input: { partLineId: string; reason?: string }
): Promise<Result<{ partLineId: string; reversedMovementId: string; movementId: string }, Error>> {
  return guard(
    async () => {
      const row = await readReturnPartLine(db, organizationId, input.partLineId)
      if (!row) throw new NotFoundError(`Return part line ${input.partLineId} not found`)
      if (!row.movementId) {
        throw new ConflictError('This component never produced a salvage movement to reverse')
      }

      const reversal = await reverseMovement(db, organizationId, userId, {
        movementId: row.movementId,
        reason: input.reason ?? 'Salvage decision corrected',
      })
      if (reversal.isErr()) throw reversal.error

      logger.info('Reversed a salvage movement', {
        organizationId,
        partLineId: row.id,
        movementId: row.movementId,
        reversalId: reversal.value.movementId,
      })

      return {
        partLineId: row.id,
        reversedMovementId: row.movementId,
        movementId: reversal.value.movementId,
      }
    },
    'Failed to reverse a salvage movement',
    { organizationId, partLineId: input.partLineId }
  )
}

// ─── internals ──────────────────────────────────────────────────────

/**
 * `part_standard_cost` for the parts that would be salvaged, in minor units.
 *
 * `readStandardCost` returns an entry only for a part with a **usable**
 * standard, omitting a stored `0` exactly as it omits a NULL, so a part missing
 * from this map is one `findMissingStandardCosts` must refuse - which is the
 * whole of invariant 3 and the reason it is read here rather than defaulted.
 */
async function readSalvageStandardCosts(
  db: Database,
  organizationId: string,
  nodes: readonly SalvageNode[]
): Promise<Map<string, number | null>> {
  const costs = new Map<string, number | null>()
  const partIds = [...new Set(nodes.map((node) => node.partId))]
  if (partIds.length === 0) return costs

  const result = await readStandardCost(db, organizationId, partIds)
  // A failed read is not "every part is uncosted": it is an infrastructure
  // failure, and turning it into a refusal that names an arbitrary part would
  // send somebody to edit a part that is perfectly well costed.
  if (result.isErr()) throw result.error

  for (const [partId, standard] of result.value) costs.set(partId, standard.standardCost)
  return costs
}

/**
 * `part_kind` for a set of parts, so the movement can be stamped with the
 * inventory ROLE the part sat in at write time (guide section 7.4).
 *
 * A part with no row is absent from the map, and
 * {@link resolveInventoryRoleForPartKind} already reads that absence as raw
 * materials - the conservative default every other movement writer takes.
 */
async function readSalvagePartKinds(
  db: Database,
  organizationId: string,
  partInstanceIds: string[]
): Promise<Map<string, string>> {
  const kinds = new Map<string, string>()
  if (partInstanceIds.length === 0) return kinds

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
        inArray(schema.FieldValue.entityId, [...new Set(partInstanceIds)]),
        eq(schema.FieldValue.fieldId, kindField.id)
      )
    )

  for (const row of rows) {
    if (row.optionId) kinds.set(row.entityId, row.optionId)
  }
  return kinds
}

/**
 * `RMA-000N salvage` - section 6.3's reason string, verbatim.
 *
 * The movement carries NO link back to the return (the `return_part_line` owns
 * that edge, one-sided, so the append-only ledger holds no pointer into the
 * returns tree), which makes this string the only human trace on the ledger row
 * of where the stock came from. A return with no minted number yet still gets a
 * reason that says what the row is.
 */
async function salvageMovementReason(
  db: Database,
  organizationId: string,
  returnId: string | null
): Promise<string> {
  const number = returnId ? await readReturnNumber(db, organizationId, returnId) : null
  return number ? `${number} salvage` : 'Return salvage'
}

/** `return_number` for one return, or null. One value, one query. */
async function readReturnNumber(
  db: Database,
  organizationId: string,
  returnId: string
): Promise<string | null> {
  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['return_number'] as const)
  const numberField = fields.return_number
  if (!numberField) return null

  const [row] = await db
    .select({ value: schema.FieldValue.valueText })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.entityId, returnId),
        eq(schema.FieldValue.fieldId, numberField.id)
      )
    )
    .limit(1)

  return row?.value ?? null
}
