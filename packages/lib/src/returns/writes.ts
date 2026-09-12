// packages/lib/src/returns/writes.ts

/**
 * Every WRITE over `return`, `return_line` and `return_part_line`.
 *
 * plans/money/tasks/54-returns.md sections 3.1 to 3.6 and 6.6.
 *
 * 🛑 **Nothing in this file moves inventory.** A `return_part_line` records a
 * DECISION and stops there. The salvage writer - the thing that turns a `good`
 * node into a `return_in` stock movement - is step 7 of the plan's build order
 * and is gated on a chain ending at task 50, because nothing writes a `sale`
 * movement yet and recovering parts before shipping relieves them would make
 * the inventory number worse rather than better (section 6.1). So there is no
 * import of `receiving/`, `builds/` or `stock-movements/` here, and
 * `return_part_line_unit_cost` and `return_part_line_movement` are never
 * written: they are that writer's output.
 *
 * Two guards from the pure modules are enforced on the way in, and both are
 * cross-record checks no single screen can make:
 *
 * - `checkOverReturn` - Σ quantity across every `return_line` pointing at a
 *   sold line, across ALL returns, against what that line shipped
 *   (section 3.5).
 * - `checkSalvageQuantityBounds` - the split button divides a row and may not
 *   invent units (section 6.6, invariant 2). Applied to the tree the write
 *   WOULD produce, before anything is written, so a refusal leaves nothing
 *   half-applied.
 *
 * No permission checks: the router asserts (`docs/lib-module-guide.md`
 * section 6). Reads live in `reads.ts` and `salvage-reads.ts`, because a file
 * that both queries and mutates is the first step back toward a service class.
 */

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { generateId, generateKeyBetween } from '@auxx/utils'
import { and, eq, isNull } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { loadSubpartGraph } from '../bom/subpart-graph'
import { BadRequestError, NotFoundError, UnprocessableEntityError } from '../errors'
import { UnifiedCrudHandler } from '../resources/crud/unified-handler'
import { type RecordId, toRecordId } from '../resources/resource-id'
import {
  type ReturnPartLineFieldContext,
  requireReturnFieldContext,
  requireReturnLineFieldContext,
  requireReturnPartLineFieldContext,
  requireReturnsDefId,
} from './field-context'
import { guard } from './guard'
import { checkOverReturn } from './over-return-guard'
import {
  getReturn,
  type ReturnLineRecord,
  type ReturnPartLineRecord,
  type ReturnWithLines,
  readReturnCeiling,
  readReturnedQuantityClaims,
  readReturnPartLines,
  requireReturnLine,
} from './reads'
import { isUsableSalvagePercent } from './salvage-cost'
import { checkSalvageQuantityBounds } from './salvage-invariants'
import { parseSalvageNodeKey } from './salvage-node-key'
import {
  assembleSalvageTree,
  readSalvagePartInfos,
  type SalvageTreeView,
  toMaterializedRow,
} from './salvage-reads'
import { bomQuantity, buildSalvageTree, flattenSalvageTree } from './salvage-tree'
import type {
  ReturnLineConditionGrade,
  ReturnLineLiability,
  ReturnOrigin,
  ReturnStatus,
} from './status'
import {
  DEFAULT_SALVAGE_PERCENT,
  type MaterializedSalvageRow,
  type SalvageStatus,
  type SubpartGraph,
} from './types'

const logger = createScopedLogger('returns:writes')

// ─── return ─────────────────────────────────────────────────────────

/**
 * What a person may set on a return.
 *
 * `number` is absent because the RecordSequence hook mints it and is the only
 * writer. `creditedAmount` and `withheldAmount` are absent because they are
 * derived from the linked memos (section 5.2), and `evidencePackAsset` because
 * the generator owns it.
 */
export interface ReturnInput {
  status?: ReturnStatus
  origin?: ReturnOrigin | null
  /** TAGS: several reasons are legitimate (wrong item AND damaged). */
  reasons?: string[] | null
  /** The customer's own words, verbatim, beside the normalized {@link reasons} tags. */
  customerNote?: string | null
  /** 🛑 Nullable and load-bearing: a dock pallet has no known sender yet. */
  contactId?: string | null
  orderId?: string | null
  ticketId?: string | null
  requestedAt?: Date | null
  receivedAt?: Date | null
  inspectedAt?: Date | null
  closedAt?: Date | null
  senderNameRaw?: string | null
  senderAddressRaw?: string | null
  inboundCarrier?: string | null
  inboundTracking?: string | null
  labelProvided?: boolean | null
  /** Integer minor units. */
  labelCost?: number | null
  /** Integer minor units, transcribed rather than computed. */
  goodsValue?: number | null
  withheldReason?: string | null
}

/**
 * Raise a return.
 *
 * Deliberately permissive about identity: a return with no contact, no order
 * and no ticket is the dock surprise of section 3.2 and is the case this record
 * exists for. The only thing refused is a relationship naming a definition the
 * organization does not have.
 */
export async function createReturn(
  db: Database,
  organizationId: string,
  userId: string,
  input: ReturnInput = {}
): Promise<Result<ReturnWithLines, Error>> {
  return guard(
    async () => {
      const ctx = await requireReturnFieldContext(organizationId)
      const values = await buildReturnValues(organizationId, input)

      const crud = new UnifiedCrudHandler(organizationId, userId, db)
      const created = await crud.create(ctx.returnDefId, values)

      logger.info('Raised return', {
        organizationId,
        returnId: created.instance.id,
        origin: input.origin ?? null,
        identified: input.contactId != null,
      })

      return requireReturnRecord(db, organizationId, created.instance.id)
    },
    'Failed to create return',
    { organizationId }
  )
}

/**
 * Edit a return.
 *
 * A key left off the patch is untouched; an explicit `null` clears the value.
 * That distinction is what lets "identify this pallet" set `contact` without
 * also wiping the raw sender the warehouse typed - which is evidence and is
 * never overwritten by identification.
 */
export async function updateReturn(
  db: Database,
  organizationId: string,
  userId: string,
  input: { returnId: string } & ReturnInput
): Promise<Result<ReturnWithLines, Error>> {
  return guard(
    async () => {
      const ctx = await requireReturnFieldContext(organizationId)
      await requireReturnRecord(db, organizationId, input.returnId)

      const values = await buildReturnValues(organizationId, input)
      if (Object.keys(values).length > 0) {
        const crud = new UnifiedCrudHandler(organizationId, userId, db)
        await crud.update(toRecordId(ctx.returnDefId, input.returnId) as RecordId, values)
      }

      return requireReturnRecord(db, organizationId, input.returnId)
    },
    'Failed to update return',
    { organizationId, returnId: input.returnId }
  )
}

// ─── return_line ────────────────────────────────────────────────────

/** The evidence anchor's own fields. Inspection findings live here, not on a child. */
export interface ReturnLineInput {
  lineItemId?: string | null
  partId?: string
  quantity?: number
  conditionGrade?: ReturnLineConditionGrade | null
  liability?: ReturnLineLiability | null
  inspectionNotes?: string | null
  /** A `User.id`. The ACTOR field stores it directly. */
  inspectedByUserId?: string | null
  inspectedAt?: Date | null
}

/**
 * Add a returned sold line.
 *
 * The grain is one row per sold line PER CONDITION: two lifts back, one
 * pristine and one wrecked, are two rows of quantity 1 pointing at the same
 * `line_item`. That is exactly why the over-return check below sums across
 * every return rather than looking at this row alone.
 */
export async function createReturnLine(
  db: Database,
  organizationId: string,
  userId: string,
  input: { returnId: string; partId: string; quantity: number } & ReturnLineInput
): Promise<Result<ReturnLineRecord, Error>> {
  return guard(
    async () => {
      const ctx = await requireReturnLineFieldContext(organizationId)
      await requireReturnRecord(db, organizationId, input.returnId)

      const returnDefId = await requireReturnsDefId(organizationId, 'return')
      const partDefId = await requireReturnsDefId(organizationId, 'part')
      await assertInstanceExists(db, organizationId, partDefId, input.partId, 'Part')

      if (input.lineItemId) {
        await assertOverReturn(db, organizationId, {
          lineItemId: input.lineItemId,
          quantity: input.quantity,
          returnLineId: null,
        })
      }

      const values: Record<string, unknown> = {
        return_line_return: toRecordId(returnDefId, input.returnId),
        return_line_part: toRecordId(partDefId, input.partId),
        return_line_quantity: input.quantity,
        ...(await buildReturnLineValues(organizationId, input)),
      }

      const crud = new UnifiedCrudHandler(organizationId, userId, db)
      const created = await crud.create(ctx.returnLineDefId, values)

      logger.info('Added return line', {
        organizationId,
        returnId: input.returnId,
        returnLineId: created.instance.id,
        quantity: input.quantity,
      })

      return requireReturnLine(db, organizationId, created.instance.id)
    },
    'Failed to create return line',
    { organizationId, returnId: input.returnId }
  )
}

/**
 * Edit a returned sold line, including recording the inspection.
 *
 * The over-return check runs again whenever the quantity or the sold line
 * moves, excluding this row's own prior claim - otherwise saving a row of 2
 * unchanged would count its own 2 twice and refuse itself.
 */
export async function updateReturnLine(
  db: Database,
  organizationId: string,
  userId: string,
  input: { returnLineId: string } & ReturnLineInput
): Promise<Result<ReturnLineRecord, Error>> {
  return guard(
    async () => {
      const ctx = await requireReturnLineFieldContext(organizationId)
      const existing = await requireReturnLine(db, organizationId, input.returnLineId)

      const lineItemId =
        input.lineItemId !== undefined ? input.lineItemId : (existing.lineItemId ?? null)
      const quantity = input.quantity ?? existing.quantity ?? 0
      const quantityMoved = input.quantity !== undefined && input.quantity !== existing.quantity
      const lineMoved = input.lineItemId !== undefined && input.lineItemId !== existing.lineItemId

      if (lineItemId && (quantityMoved || lineMoved)) {
        await assertOverReturn(db, organizationId, {
          lineItemId,
          quantity,
          // A move to a DIFFERENT sold line must not exclude this row from the
          // new line's sum: it has no prior claim there.
          returnLineId: lineMoved ? null : input.returnLineId,
        })
      }

      const values: Record<string, unknown> = await buildReturnLineValues(organizationId, input)
      if (input.quantity !== undefined) values.return_line_quantity = input.quantity
      if (input.partId !== undefined) {
        const partDefId = await requireReturnsDefId(organizationId, 'part')
        await assertInstanceExists(db, organizationId, partDefId, input.partId, 'Part')
        values.return_line_part = toRecordId(partDefId, input.partId)
      }

      if (Object.keys(values).length > 0) {
        const crud = new UnifiedCrudHandler(organizationId, userId, db)
        await crud.update(toRecordId(ctx.returnLineDefId, input.returnLineId) as RecordId, values)
      }

      return requireReturnLine(db, organizationId, input.returnLineId)
    },
    'Failed to update return line',
    { organizationId, returnLineId: input.returnLineId }
  )
}

// ─── return_part_line: the salvage tree ─────────────────────────────

/**
 * Open a node so its components can be graded.
 *
 * 🛑 **Expanding is what materializes the node itself, not its children.** A
 * node's children can only hang off a row, so the row for the node being
 * opened is created here and its children appear as untouched nodes underneath
 * it - `undecided` by absence, with no rows of their own. That keeps the table
 * at one row per node somebody actually opened rather than exploding a
 * twenty-deep bill of materials (section 6.6).
 *
 * A node that already has a row is a no-op: the card calls this at most once
 * per node, and answering with the same tree is the right response to a repeat.
 */
export async function expandSalvageNode(
  db: Database,
  organizationId: string,
  userId: string,
  input: { returnLineId: string; nodeKey: string }
): Promise<Result<SalvageTreeView, Error>> {
  return guard(
    async () => {
      const salvage = await loadSalvageWriteContext(db, organizationId, input.returnLineId)
      const target = resolveSalvageTarget(salvage, input.nodeKey)
      if (target.rowId) return assembleSalvageTree(db, organizationId, salvage.line, salvage.rows)

      await assertBoundsAfter(db, organizationId, salvage, [draftOf(target)])
      await createPartLineRow(db, organizationId, userId, salvage, target)
      return reloadSalvageTree(db, organizationId, salvage.line)
    },
    'Failed to expand salvage node',
    { organizationId, returnLineId: input.returnLineId, nodeKey: input.nodeKey }
  )
}

/**
 * Set how many units of this component came back.
 *
 * Materializes the node first when it has no row: editing the quantity IS
 * touching it, and the prefill it was showing was the bill of materials
 * talking, not a stored decision.
 */
export async function setSalvageNodeQuantity(
  db: Database,
  organizationId: string,
  userId: string,
  input: { returnLineId: string; nodeKey: string; quantity: number }
): Promise<Result<SalvageTreeView, Error>> {
  return guard(
    async () => {
      if (!Number.isFinite(input.quantity) || input.quantity < 0) {
        throw new BadRequestError('A component quantity must be zero or more')
      }

      const salvage = await loadSalvageWriteContext(db, organizationId, input.returnLineId)
      const target = resolveSalvageTarget(salvage, input.nodeKey)
      const draft = { ...draftOf(target), quantity: input.quantity }

      await assertBoundsAfter(db, organizationId, salvage, [draft])
      await writeDraft(db, organizationId, userId, salvage, target, draft, {
        return_part_line_quantity: input.quantity,
      })
      return reloadSalvageTree(db, organizationId, salvage.line)
    },
    'Failed to set salvage quantity',
    { organizationId, returnLineId: input.returnLineId, nodeKey: input.nodeKey }
  )
}

/**
 * Record what the warehouse decided about this component.
 *
 * The first non-`undecided` write on an untouched node is what creates its
 * row - absence is the default, so there is nothing to update until somebody
 * has an opinion.
 *
 * 🛑 Writing `good` here records a decision and nothing else. Only the gated
 * salvage writer turns the highest `good` node in a branch into a `return_in`,
 * and only it freezes a unit cost.
 */
export async function setSalvageNodeStatus(
  db: Database,
  organizationId: string,
  userId: string,
  input: { returnLineId: string; nodeKey: string; status: SalvageStatus }
): Promise<Result<SalvageTreeView, Error>> {
  return guard(
    async () => {
      const salvage = await loadSalvageWriteContext(db, organizationId, input.returnLineId)
      const target = resolveSalvageTarget(salvage, input.nodeKey)
      const draft = { ...draftOf(target), status: input.status }

      await assertBoundsAfter(db, organizationId, salvage, [draft])
      await writeDraft(db, organizationId, userId, salvage, target, draft, {
        return_part_line_status: input.status,
      })
      return reloadSalvageTree(db, organizationId, salvage.line)
    },
    'Failed to set salvage status',
    { organizationId, returnLineId: input.returnLineId, nodeKey: input.nodeKey }
  )
}

/**
 * Value every `good` component on this return line at the same percentage of
 * standard cost.
 *
 * 🛑 **Line-grained, not per row, and section 6.6 is why.** The owner's spec
 * for a tree row is "a number input and a status badge selector, and nothing
 * else", so a third per-row control is out. But section 6.4 stores
 * `salvagePercent` per `return_part_line` and the salvage writer reads it to
 * freeze `unitCost = round(standard * pct / 100)`, so without a writer the
 * default of 100 stands and every recovery freezes at full standard - which
 * defeats section 6.4 entirely. This is the card-header control's writer: one
 * percentage, applied across the line.
 *
 * Applies to every materialized `good` row, **including the ones currently
 * shadowed by a `good` ancestor**. Those post nothing today
 * ({@link selectSalvageMovementNodes} stops at the highest `good`), but a later
 * regrade of the ancestor promotes them, and a promoted row silently still
 * holding 100 is exactly the surprise this control exists to remove.
 *
 * `0 < pct <= 100` (section 6.4): zero refuses rather than writing a worthless
 * recovery, because a worthless component is `scrap`, which writes no movement
 * at all. Nothing here freezes a cost - the percentage is an input the gated
 * salvage writer reads later.
 */
export async function setSalvagePercent(
  db: Database,
  organizationId: string,
  userId: string,
  input: { returnLineId: string; salvagePercent: number }
): Promise<Result<SalvageTreeView, Error>> {
  return guard(
    async () => {
      if (!isUsableSalvagePercent(input.salvagePercent)) {
        throw new BadRequestError(
          'A salvage percentage must be greater than 0 and at most 100. A component worth nothing is scrap, which recovers nothing at all.'
        )
      }

      const salvage = await loadSalvageWriteContext(db, organizationId, input.returnLineId)
      if (!salvage.ctx.fields.return_part_line_salvage_percent) {
        throw new UnprocessableEntityError(
          'This organization has no salvage percentage field yet, so recoveries cannot be valued'
        )
      }

      const view = await assembleSalvageTree(db, organizationId, salvage.line, salvage.rows)
      // An unmaterialized node cannot be `good` - absence reads as `undecided` -
      // but the guard is cheap and a node's key is only a row id when it has one.
      const targets = flattenSalvageTree(view.nodes).filter(
        (node) =>
          node.materialized &&
          node.status === 'good' &&
          node.salvagePercent !== input.salvagePercent
      )
      if (targets.length === 0) return view

      // One write session for the whole line: a per-row loop would open one
      // each, and a line can carry a lot of recovered fasteners.
      const crud = new UnifiedCrudHandler(organizationId, userId, db)
      const { errors } = await crud.bulkUpdate(
        targets.map((node) => ({
          recordId: toRecordId(salvage.ctx.returnPartLineDefId, node.key) as RecordId,
          values: { return_part_line_salvage_percent: input.salvagePercent },
        }))
      )
      if (errors.length > 0) {
        throw new UnprocessableEntityError(
          `Could not value ${errors.length} of ${targets.length} recovered components: ${errors[0]?.error}`
        )
      }

      logger.info('Set the salvage percentage on a return line', {
        organizationId,
        returnLineId: input.returnLineId,
        salvagePercent: input.salvagePercent,
        rows: targets.length,
      })

      return reloadSalvageTree(db, organizationId, salvage.line)
    },
    'Failed to set salvage percentage',
    { organizationId, returnLineId: input.returnLineId }
  )
}

/**
 * Divide a row into two siblings whose quantities sum to what it held.
 *
 * The case it exists for: four of a subassembly came back, three are fine and
 * one has to be drilled into. The default split is `quantity - 1` and `1`,
 * which is the plan's own example ("splitting a row of 4 may produce rows of 3
 * and 1"); `firstQuantity` overrides it.
 *
 * 🔑 The two halves sum to the original, so the parent's allowance is
 * untouched by construction - but the bounds check still runs, because a
 * concurrent edit could have moved the parent underneath this one.
 *
 * `sortOrder` is a fractional index, so the new sibling slots in directly after
 * its origin without renumbering anything else.
 */
export async function splitSalvageNode(
  db: Database,
  organizationId: string,
  userId: string,
  input: { returnLineId: string; nodeKey: string; firstQuantity?: number }
): Promise<Result<SalvageTreeView, Error>> {
  return guard(
    async () => {
      const salvage = await loadSalvageWriteContext(db, organizationId, input.returnLineId)
      const target = resolveSalvageTarget(salvage, input.nodeKey)

      const total = target.quantity
      if (!Number.isFinite(total) || total < 2) {
        throw new BadRequestError('A component row needs at least two units before it can be split')
      }

      const first = input.firstQuantity ?? total - 1
      if (!Number.isInteger(first) || first < 1 || first >= total) {
        throw new BadRequestError(
          `A split must leave at least one unit on each side of ${total} units`
        )
      }

      // Splitting an untouched node materializes BOTH halves, so the origin's
      // key is pinned here rather than left for `createPartLineRow` to compute:
      // otherwise both rows would ask for "the key after the last sibling" and
      // land on the same one, and sibling order would fall back to the row id.
      const originSortOrder =
        target.sortOrder ?? nextSortOrder(lastSiblingSortOrder(salvage, target.parentRowId), null)
      const origin = { ...draftOf(target), quantity: first, sortOrder: originSortOrder }
      const sibling: MaterializedSalvageRow = {
        id: generateId(),
        parentId: target.parentRowId,
        partId: target.partId,
        quantity: total - first,
        // The new half inherits nothing: the whole point of splitting is that
        // the units diverged, so the sibling starts undecided.
        status: 'undecided',
        salvagePercent: DEFAULT_SALVAGE_PERCENT,
        sortOrder: nextSortOrder(originSortOrder, nextSiblingSortOrder(salvage, target)),
      }

      await assertBoundsAfter(db, organizationId, salvage, [origin, sibling])

      await writeDraft(
        db,
        organizationId,
        userId,
        salvage,
        { ...target, sortOrder: originSortOrder },
        origin,
        { return_part_line_quantity: first }
      )
      await createPartLineRow(db, organizationId, userId, salvage, {
        rowId: null,
        parentRowId: sibling.parentId,
        partId: sibling.partId,
        quantity: sibling.quantity,
        status: sibling.status,
        salvagePercent: sibling.salvagePercent,
        sortOrder: sibling.sortOrder ?? null,
      })

      logger.info('Split a salvage row', {
        organizationId,
        returnLineId: input.returnLineId,
        partId: target.partId,
        first,
        second: total - first,
      })

      return reloadSalvageTree(db, organizationId, salvage.line)
    },
    'Failed to split salvage node',
    { organizationId, returnLineId: input.returnLineId, nodeKey: input.nodeKey }
  )
}

// ─── internals ──────────────────────────────────────────────────────

/** Everything a salvage write resolves once, up front. */
interface SalvageWriteContext {
  ctx: ReturnPartLineFieldContext
  line: ReturnLineRecord
  rootPartId: string
  returnLineQuantity: number
  rows: ReturnPartLineRecord[]
  graph: SubpartGraph
}

/** The node a mutation names, whether or not it has a row yet. */
interface SalvageTarget {
  /** Null when the node is not materialized. */
  rowId: string | null
  parentRowId: string | null
  partId: string
  quantity: number
  status: SalvageStatus
  salvagePercent: number
  sortOrder: string | null
}

async function loadSalvageWriteContext(
  db: Database,
  organizationId: string,
  returnLineId: string
): Promise<SalvageWriteContext> {
  const ctx = await requireReturnPartLineFieldContext(organizationId)
  const line = await requireReturnLine(db, organizationId, returnLineId)
  if (!line.partId) {
    throw new UnprocessableEntityError(
      'This return line names no part, so there is no bill of materials to inspect'
    )
  }
  const rows = await readReturnPartLines(db, organizationId, returnLineId)
  // The bill of materials is loaded on every salvage write, not only on the
  // read: an untouched node's prefill and the bounds check are both derived
  // from it, and neither may be taken from the browser.
  const graph = await loadSubpartGraph(organizationId, line.partId)

  return {
    ctx,
    line,
    rootPartId: line.partId,
    returnLineQuantity: line.quantity ?? 0,
    rows,
    graph,
  }
}

/**
 * Read a node key back into the row it names, or into the row it would create.
 *
 * An untouched node's prefilled quantity is recomputed here from the bill of
 * materials rather than taken from the browser: the number the card was
 * showing came from a tree that may be seconds out of date, and it is the
 * quantity a salvage movement will eventually be written for.
 */
function resolveSalvageTarget(salvage: SalvageWriteContext, nodeKey: string): SalvageTarget {
  const parsed = parseSalvageNodeKey(nodeKey)
  if (!parsed) throw new BadRequestError(`"${nodeKey}" is not a salvage tree node`)

  if (parsed.kind === 'row') {
    const row = salvage.rows.find((candidate) => candidate.id === parsed.rowId)
    if (!row) {
      throw new NotFoundError('That component is no longer on this return line')
    }
    return {
      rowId: row.id,
      parentRowId: row.parentId,
      partId: row.partId,
      quantity: row.quantity,
      status: row.status,
      salvagePercent: row.salvagePercent,
      sortOrder: row.sortOrder,
    }
  }

  const parent = parsed.parentRowId
    ? salvage.rows.find((candidate) => candidate.id === parsed.parentRowId)
    : null
  if (parsed.parentRowId && !parent) {
    throw new NotFoundError('That component sits under a row that no longer exists')
  }

  const parentPartId = parent?.partId ?? salvage.rootPartId
  const parentQuantity = parent?.quantity ?? salvage.returnLineQuantity
  const perParent = bomQuantity(salvage.graph, parentPartId, parsed.partId)
  if (perParent === null) {
    throw new BadRequestError("That component is not on its parent's bill of materials any more")
  }

  return {
    rowId: null,
    parentRowId: parsed.parentRowId,
    partId: parsed.partId,
    // The compounding prefill of section 6.6: two lifts back, each carrying 2
    // of a subassembly, materializes at 4.
    quantity: perParent * parentQuantity,
    status: 'undecided',
    salvagePercent: DEFAULT_SALVAGE_PERCENT,
    sortOrder: null,
  }
}

/** A target as the prospective row the bounds check reasons over. */
function draftOf(target: SalvageTarget): MaterializedSalvageRow {
  return {
    id: target.rowId ?? generateId(),
    parentId: target.parentRowId,
    partId: target.partId,
    quantity: target.quantity,
    status: target.status,
    salvagePercent: target.salvagePercent,
    sortOrder: target.sortOrder,
  }
}

/**
 * Refuse the write BEFORE it happens, by building the tree it would produce.
 *
 * The invariant is not "children sum to the parent" - a subassembly of 4
 * legitimately contains 16 bolts - but "the rows for one part under one parent
 * sum to no more than the bill of materials allows there". That is
 * `checkSalvageQuantityBounds`'s job and it is written against a built tree, so
 * the cheapest correct way to apply it to a pending write is to build the tree
 * the write would leave behind.
 */
async function assertBoundsAfter(
  db: Database,
  organizationId: string,
  salvage: SalvageWriteContext,
  drafts: readonly MaterializedSalvageRow[]
): Promise<void> {
  const byId = new Map(salvage.rows.map((row) => [row.id, toMaterializedRow(row)]))
  for (const draft of drafts) byId.set(draft.id, draft)
  const rows = [...byId.values()]

  const parts = await readSalvagePartInfos(
    db,
    organizationId,
    rows.map((row) => row.partId)
  )
  const roots = buildSalvageTree({
    graph: salvage.graph,
    rootPartId: salvage.rootPartId,
    returnLineQuantity: salvage.returnLineQuantity,
    rows,
    parts,
  })

  const bounds = checkSalvageQuantityBounds({
    roots,
    graph: salvage.graph,
    rootPartId: salvage.rootPartId,
    returnLineQuantity: salvage.returnLineQuantity,
  })
  if (bounds.isErr()) throw bounds.error
}

/** Create the row when the node has none, update it when it does. */
async function writeDraft(
  db: Database,
  organizationId: string,
  userId: string,
  salvage: SalvageWriteContext,
  target: SalvageTarget,
  draft: MaterializedSalvageRow,
  values: Record<string, unknown>
): Promise<void> {
  if (!target.rowId) {
    await createPartLineRow(db, organizationId, userId, salvage, {
      ...target,
      quantity: draft.quantity,
      status: draft.status,
      salvagePercent: draft.salvagePercent,
    })
    return
  }

  const crud = new UnifiedCrudHandler(organizationId, userId, db)
  await crud.update(toRecordId(salvage.ctx.returnPartLineDefId, target.rowId) as RecordId, values)
}

/** One `return_part_line`. Never writes a unit cost or a movement: step 7 owns those. */
async function createPartLineRow(
  db: Database,
  organizationId: string,
  userId: string,
  salvage: SalvageWriteContext,
  target: SalvageTarget
): Promise<string> {
  const returnLineDefId = await requireReturnsDefId(organizationId, 'return_line')
  const partDefId = await requireReturnsDefId(organizationId, 'part')

  const values: Record<string, unknown> = {
    return_part_line_return_line: toRecordId(returnLineDefId, salvage.line.returnLineId),
    return_part_line_part: toRecordId(partDefId, target.partId),
    return_part_line_quantity: target.quantity,
    return_part_line_status: target.status,
  }
  if (target.parentRowId) {
    values.return_part_line_parent = toRecordId(salvage.ctx.returnPartLineDefId, target.parentRowId)
  }
  if (salvage.ctx.fields.return_part_line_salvage_percent) {
    values.return_part_line_salvage_percent = target.salvagePercent
  }
  if (salvage.ctx.fields.return_part_line_sort_order) {
    values.return_part_line_sort_order =
      target.sortOrder ?? nextSortOrder(lastSiblingSortOrder(salvage, target.parentRowId), null)
  }

  const crud = new UnifiedCrudHandler(organizationId, userId, db)
  const created = await crud.create(salvage.ctx.returnPartLineDefId, values)
  return created.instance.id
}

/** Re-read the rows and rebuild, so the caller answers with what is now stored. */
async function reloadSalvageTree(
  db: Database,
  organizationId: string,
  line: ReturnLineRecord
): Promise<SalvageTreeView> {
  const rows = await readReturnPartLines(db, organizationId, line.returnLineId)
  return assembleSalvageTree(db, organizationId, line, rows)
}

/** The siblings of one node, in the order `salvage-tree.ts` renders them. */
function siblingsOf(
  salvage: SalvageWriteContext,
  parentRowId: string | null
): ReturnPartLineRecord[] {
  return salvage.rows
    .filter((row) => row.parentId === parentRowId)
    .sort((a, b) => {
      const aOrder = a.sortOrder ?? ''
      const bOrder = b.sortOrder ?? ''
      if (aOrder !== bOrder) return aOrder < bOrder ? -1 : 1
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
}

/** The last sibling's key, so a new row lands at the end of its level. */
function lastSiblingSortOrder(
  salvage: SalvageWriteContext,
  parentRowId: string | null
): string | null {
  const siblings = siblingsOf(salvage, parentRowId)
  return siblings[siblings.length - 1]?.sortOrder ?? null
}

/** The key of whatever currently follows this row, so a split lands between them. */
function nextSiblingSortOrder(salvage: SalvageWriteContext, target: SalvageTarget): string | null {
  if (!target.rowId) return null
  const siblings = siblingsOf(salvage, target.parentRowId)
  const index = siblings.findIndex((row) => row.id === target.rowId)
  if (index < 0) return null
  return siblings[index + 1]?.sortOrder ?? null
}

/**
 * A fractional index between two keys, tolerant of a stored key that is not
 * one.
 *
 * `sortOrder` is nullable and the generic record editor can write anything
 * into it, so a malformed neighbour must not make the split button throw. The
 * fallback appends; ties then fall back to the row id, which is how
 * `salvage-tree.ts` keeps sibling order total anyway.
 */
function nextSortOrder(after: string | null, before: string | null): string {
  try {
    return generateKeyBetween(after, before)
  } catch {
    return generateKeyBetween(null, null)
  }
}

/** The cross-return ceiling check of section 3.5, as a throw the guard converts. */
async function assertOverReturn(
  db: Database,
  organizationId: string,
  candidate: { lineItemId: string; quantity: number; returnLineId: string | null }
): Promise<void> {
  const { ceiling } = await readReturnCeiling(db, organizationId, candidate.lineItemId)
  // 🛑 Unknown is null, not zero, and it passes. Nothing records a ceiling for
  // this line, so there is no bound to breach - refusing here would be a wall
  // built out of missing data. A ceiling of 0 IS a real bound and does refuse,
  // which is why the two may never be collapsed.
  if (ceiling === null) return
  const existing = await readReturnedQuantityClaims(db, organizationId, candidate.lineItemId)
  const verdict = checkOverReturn({
    lineItemId: candidate.lineItemId,
    ceiling,
    existing,
    candidate: { returnLineId: candidate.returnLineId, quantity: candidate.quantity },
  })
  if (verdict.isErr()) throw verdict.error
}

/** The `return` values common to create and update. Absent keys stay untouched. */
async function buildReturnValues(
  organizationId: string,
  input: ReturnInput
): Promise<Record<string, unknown>> {
  const values: Record<string, unknown> = {}

  if (input.status !== undefined) values.return_status = input.status
  if (input.origin !== undefined) values.return_origin = input.origin
  if (input.reasons !== undefined) values.return_reason = input.reasons ?? []
  if (input.customerNote !== undefined) values.return_customer_note = input.customerNote
  if (input.senderNameRaw !== undefined) values.return_sender_name_raw = input.senderNameRaw
  if (input.senderAddressRaw !== undefined) {
    values.return_sender_address_raw = input.senderAddressRaw
  }
  if (input.inboundCarrier !== undefined) values.return_inbound_carrier = input.inboundCarrier
  if (input.inboundTracking !== undefined) values.return_inbound_tracking = input.inboundTracking
  if (input.labelProvided !== undefined) values.return_label_provided = input.labelProvided
  if (input.labelCost !== undefined) values.return_label_cost = input.labelCost
  if (input.goodsValue !== undefined) values.return_goods_value = input.goodsValue
  if (input.withheldReason !== undefined) values.return_withheld_reason = input.withheldReason

  for (const [value, attribute] of [
    [input.requestedAt, 'return_requested_at'],
    [input.receivedAt, 'return_received_at'],
    [input.inspectedAt, 'return_inspected_at'],
    [input.closedAt, 'return_closed_at'],
  ] as const) {
    if (value !== undefined) values[attribute] = value === null ? null : value.toISOString()
  }

  for (const [value, attribute, entityType] of [
    [input.contactId, 'return_contact', 'contact'],
    [input.orderId, 'return_order', 'order'],
    [input.ticketId, 'return_ticket', 'ticket'],
  ] as const) {
    if (value === undefined) continue
    values[attribute] = value
      ? toRecordId(await requireReturnsDefId(organizationId, entityType), value)
      : null
  }

  return values
}

/** The `return_line` values common to create and update, minus part and quantity. */
async function buildReturnLineValues(
  organizationId: string,
  input: ReturnLineInput
): Promise<Record<string, unknown>> {
  const values: Record<string, unknown> = {}

  if (input.conditionGrade !== undefined) values.return_line_condition_grade = input.conditionGrade
  if (input.liability !== undefined) values.return_line_liability = input.liability
  if (input.inspectionNotes !== undefined) {
    values.return_line_inspection_notes = input.inspectionNotes
  }
  if (input.inspectedByUserId !== undefined) {
    values.return_line_inspected_by = input.inspectedByUserId
  }
  if (input.inspectedAt !== undefined) {
    values.return_line_inspected_at =
      input.inspectedAt === null ? null : input.inspectedAt.toISOString()
  }
  if (input.lineItemId !== undefined) {
    values.return_line_line_item = input.lineItemId
      ? toRecordId(await requireReturnsDefId(organizationId, 'line_item'), input.lineItemId)
      : null
  }

  return values
}

/** {@link getReturn}, as the `NotFoundError` a write path needs. */
async function requireReturnRecord(
  db: Database,
  organizationId: string,
  returnId: string
): Promise<ReturnWithLines> {
  const result = await getReturn(db, organizationId, returnId)
  if (result.isErr()) throw result.error
  if (!result.value) throw new NotFoundError(`Return ${returnId} not found`)
  return result.value
}

/** The referenced record must exist, in this organization, unarchived. */
async function assertInstanceExists(
  db: Database,
  organizationId: string,
  entityDefinitionId: string,
  instanceId: string,
  label: string
): Promise<void> {
  const [instance] = await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.id, instanceId),
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, entityDefinitionId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .limit(1)
  if (!instance) throw new NotFoundError(`${label} ${instanceId} not found`)
}
