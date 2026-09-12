// apps/web/src/server/api/routers/return.ts
//
// The API surface for returns (plans/money/tasks/54-returns.md).
//
// 🛑 **Every procedure here is the permission gate for the lib call underneath.**
// `@auxx/lib/returns` contains no access checks by design - its module headers
// say so - so a gate missing here is missing everywhere.
//
// Permissions are DEFERRED for v1 and that is a decision, not an oversight
// (§11.1). `return`, `return_line` and `return_part_line` are NOT in
// `ENTITY_BASE_AREAS`: that map holds the GL record faces and the dispatch
// ones, and `credit_memo`, `order` and `part` are all outside it. So the three
// definitions derive from `Area.records` like everything else, and the gate is
// the same per-definition `canViewEntity` / `canEditEntity` the record pages
// use - resolved from the org cache and asserted against the request's
// `CapabilitySet`, exactly as `builds.ts` does it.
//
// | procedure                                   | gate                     |
// | ------------------------------------------- | ------------------------ |
// | `list`, `get`                               | view on `return`         |
// | `getLine`, `salvageTree`, `returnableQuantity` | view on `return_line` |
// | `create`, `update`                          | edit on `return`         |
// | `createLine`, `updateLine`                  | edit on `return_line`    |
// | `expandSalvageNode`, `setSalvageNodeQuantity`, `setSalvageNodeStatus`, `splitSalvageNode` | edit on `return_part_line` |
//
// ⚠️ Accepted for v1: `stock_movement` is records-gated too, so anyone who can
// create a return can also restock parts. Support and warehouse get identical
// authority; tightening it means a new permission key, which is scope.
//
// 🛑 **Nothing here writes a stock movement.** The salvage writer is step 7 and
// is gated on the chain ending at task 50 - a `return_part_line` records a
// decision, and no inventory moves until that lands.
//
// Lib returns neverthrow `Result`s carrying `AuxxError`s, which are rethrown
// as-is so `auxxErrorMiddleware` maps them. Wrapping one in a `TRPCError` would
// flatten the 422 an over-return produces into a 500.

import { getCachedEntityDefId } from '@auxx/lib/cache'
import { NotFoundError } from '@auxx/lib/errors'
import {
  createReturn,
  createReturnLine,
  expandSalvageNode,
  getReturn,
  getReturnLine,
  listReturns,
  RETURN_LINE_CONDITION_GRADES,
  RETURN_LINE_LIABILITIES,
  RETURN_ORIGINS,
  RETURN_STATUSES,
  readReturnableQuantity,
  readSalvageTree,
  SALVAGE_STATUSES,
  setSalvageNodeQuantity,
  setSalvageNodeStatus,
  splitSalvageNode,
  updateReturn,
  updateReturnLine,
} from '@auxx/lib/returns'
import { parseRecordId, recordIdSchema } from '@auxx/types/resource'
import { z } from 'zod'
import { capabilityProcedure, createTRPCRouter } from '~/server/api/trpc'

/** Money is stored in integer minor units (cents) everywhere in this subsystem. */
const minorUnits = z.number().int()

/**
 * A returned or recovered quantity.
 *
 * Bounded rather than merely non-negative: a salvage quantity eventually
 * multiplies into an extended cost on an append-only ledger, so an unbounded
 * number here is a number nobody can take back. The cap is far above any real
 * pallet.
 */
const unitQuantity = z.number().finite().nonnegative().max(1_000_000)

/**
 * Everything a person may set on a return.
 *
 * `number` is absent: the RecordSequence hook mints `RMA-000N` and is the only
 * writer. `creditedAmount` and `withheldAmount` are absent because they are
 * derived from the linked memos, and `evidencePackAsset` because the generator
 * owns it. `null` clears a value; omitting the key leaves it untouched.
 */
const returnFields = {
  status: z.enum(RETURN_STATUSES).optional(),
  origin: z.enum(RETURN_ORIGINS).nullable().optional(),
  /** TAGS, so several are legitimate: wrong item AND damaged is a real answer. */
  reasons: z.array(z.string().min(1)).max(20).nullable().optional(),
  /** 🛑 Nullable on purpose: a dock pallet has no known sender yet (§3.2). */
  contactId: z.string().min(1).nullable().optional(),
  orderId: z.string().min(1).nullable().optional(),
  ticketId: z.string().min(1).nullable().optional(),
  requestedAt: z.coerce.date().nullable().optional(),
  receivedAt: z.coerce.date().nullable().optional(),
  inspectedAt: z.coerce.date().nullable().optional(),
  closedAt: z.coerce.date().nullable().optional(),
  senderNameRaw: z.string().max(500).nullable().optional(),
  senderAddressRaw: z.string().max(2000).nullable().optional(),
  inboundCarrier: z.string().max(200).nullable().optional(),
  inboundTracking: z.string().max(200).nullable().optional(),
  labelProvided: z.boolean().nullable().optional(),
  labelCost: minorUnits.nullable().optional(),
  goodsValue: minorUnits.nullable().optional(),
  withheldReason: z.string().max(10_000).nullable().optional(),
}

/** The evidence anchor's own fields. Inspection findings are fields here, not a child record. */
const returnLineFields = {
  lineItemId: z.string().min(1).nullable().optional(),
  customerReason: z.string().max(2000).nullable().optional(),
  customerNote: z.string().max(5000).nullable().optional(),
  conditionGrade: z.enum(RETURN_LINE_CONDITION_GRADES).nullable().optional(),
  liability: z.enum(RETURN_LINE_LIABILITIES).nullable().optional(),
  inspectionNotes: z.string().max(10_000).nullable().optional(),
  inspectedByUserId: z.string().min(1).nullable().optional(),
  inspectedAt: z.coerce.date().nullable().optional(),
}

/**
 * A node of the salvage tree, as the card hands it back.
 *
 * Opaque on purpose: a materialized node's key is its `return_part_line` id and
 * an untouched one's is `bom:<parent>:<part>`, and the lib side is what decides
 * which of the two it is looking at. The browser never has to know.
 */
const salvageNodeKey = z.string().min(1).max(200)

export const returnRouter = createTRPCRouter({
  /**
   * Returns matching the filters, newest first unless asked otherwise.
   *
   * The two saved views the plan turns on are filters rather than stored
   * states: `unidentified` is `contact IS NULL` (the dock queue, best read
   * `oldest` first, because every day one sits there is a day closer to a
   * chargeback deadline), and `creditedNotInspected` is the risk state of §3.3 -
   * memos linked while the goods have not been looked at. Both are surfaced and
   * neither is ever blocked.
   */
  list: capabilityProcedure
    .input(
      z.object({
        status: z.array(z.enum(RETURN_STATUSES)).max(RETURN_STATUSES.length).optional(),
        unidentified: z.boolean().optional(),
        creditedNotInspected: z.boolean().optional(),
        contactId: z.string().min(1).optional(),
        orderId: z.string().min(1).optional(),
        ticketId: z.string().min(1).optional(),
        sort: z.enum(['newest', 'oldest']).optional(),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      ctx.capabilities.assertViewEntity(await requireDefId(organizationId, 'return'))

      const result = await listReturns(ctx.db, organizationId, input)
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * One return with its lines.
   *
   * `null` for a return that does not exist, is archived, or belongs to another
   * organization - the three cases deliberately indistinguishable, so this
   * cannot be used to probe for ids.
   */
  get: capabilityProcedure
    .input(z.object({ returnRecordId: recordIdSchema }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      ctx.capabilities.assertViewEntity(await requireDefId(organizationId, 'return'))

      const { entityInstanceId } = parseRecordId(input.returnRecordId)
      const result = await getReturn(ctx.db, organizationId, entityInstanceId)
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * One return line with whatever of its teardown checklist exists.
   *
   * The ROWS, not the tree: a node with no row is `undecided` by absence, and
   * turning absence into nodes needs the bill of materials, which is what
   * `salvageTree` below is for.
   */
  getLine: capabilityProcedure
    .input(z.object({ returnLineRecordId: recordIdSchema }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      ctx.capabilities.assertViewEntity(await requireDefId(organizationId, 'return_line'))

      const { entityInstanceId } = parseRecordId(input.returnLineRecordId)
      const result = await getReturnLine(ctx.db, organizationId, entityInstanceId)
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * The salvage tree for one return line - what `ReturnSalvageCard` renders.
   *
   * Lazy by construction (§6.6): the top level plus the children of every node
   * that already has a row, never the whole bill of materials. A node whose
   * `children` is `null` has not been opened.
   */
  salvageTree: capabilityProcedure
    .input(z.object({ returnLineRecordId: recordIdSchema }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      ctx.capabilities.assertViewEntity(await requireDefId(organizationId, 'return_line'))

      const { entityInstanceId } = parseRecordId(input.returnLineRecordId)
      const result = await readSalvageTree(ctx.db, organizationId, entityInstanceId)
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * How many more units a sold line can still take back, and where the ceiling
   * came from.
   *
   * The create dialog wants the number to show rather than only the verdict.
   * The ceiling is what SHIPPED, falling back to what sold on a line with no
   * dispatches - `ceilingSource` says which, so the surface can explain the
   * number instead of merely enforcing it.
   */
  returnableQuantity: capabilityProcedure
    .input(
      z.object({
        lineItemRecordId: recordIdSchema,
        /** Exclude one return line's own prior claim, when editing it. */
        excludeReturnLineRecordId: recordIdSchema.optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      ctx.capabilities.assertViewEntity(await requireDefId(organizationId, 'return_line'))

      const result = await readReturnableQuantity(
        ctx.db,
        organizationId,
        parseRecordId(input.lineItemRecordId).entityInstanceId,
        {
          excludeReturnLineId: input.excludeReturnLineRecordId
            ? parseRecordId(input.excludeReturnLineRecordId).entityInstanceId
            : null,
        }
      )
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Raise a return.
   *
   * Deliberately permissive about identity: no contact, no order and no ticket
   * is the dock surprise this record exists for, and identification happens
   * later from the unidentified queue.
   */
  create: capabilityProcedure.input(z.object(returnFields)).mutation(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session
    ctx.capabilities.assertEditEntity(await requireDefId(organizationId, 'return'))

    const result = await createReturn(ctx.db, organizationId, userId, input)
    if (result.isErr()) throw result.error
    return result.value
  }),

  /**
   * Edit a return.
   *
   * Setting `contact` on a dock pallet never touches `senderNameRaw`: that is
   * what the label said, it is evidence, and identification does not overwrite
   * it.
   */
  update: capabilityProcedure
    .input(z.object({ returnRecordId: recordIdSchema, ...returnFields }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      ctx.capabilities.assertEditEntity(await requireDefId(organizationId, 'return'))

      const { returnRecordId, ...patch } = input
      const result = await updateReturn(ctx.db, organizationId, userId, {
        returnId: parseRecordId(returnRecordId).entityInstanceId,
        ...patch,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Add a returned sold line.
   *
   * 🛑 Refused when it would bring back more than the sold line let out,
   * summed across every return (§3.5) - without that a customer can return
   * three of two lifts and the salvage tree will happily restock parts for a
   * unit that never shipped. The refusal is a 422 carrying the ceiling and what
   * was already claimed.
   */
  createLine: capabilityProcedure
    .input(
      z.object({
        returnRecordId: recordIdSchema,
        partRecordId: recordIdSchema,
        quantity: unitQuantity,
        ...returnLineFields,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      ctx.capabilities.assertEditEntity(await requireDefId(organizationId, 'return_line'))

      const { returnRecordId, partRecordId, ...rest } = input
      const result = await createReturnLine(ctx.db, organizationId, userId, {
        returnId: parseRecordId(returnRecordId).entityInstanceId,
        partId: parseRecordId(partRecordId).entityInstanceId,
        ...rest,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Edit a returned sold line, including recording the inspection.
   *
   * A re-inspection overwrites: findings are fields on this row by owner
   * decision, not a separate inspection record.
   */
  updateLine: capabilityProcedure
    .input(
      z.object({
        returnLineRecordId: recordIdSchema,
        partRecordId: recordIdSchema.optional(),
        quantity: unitQuantity.optional(),
        ...returnLineFields,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      ctx.capabilities.assertEditEntity(await requireDefId(organizationId, 'return_line'))

      const { returnLineRecordId, partRecordId, ...rest } = input
      const result = await updateReturnLine(ctx.db, organizationId, userId, {
        returnLineId: parseRecordId(returnLineRecordId).entityInstanceId,
        ...(partRecordId ? { partId: parseRecordId(partRecordId).entityInstanceId } : {}),
        ...rest,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * `ReturnSalvageCard`'s `onExpand`: open a node so its components appear.
   *
   * 🛑 Expanding materializes the node ITSELF, not its children - a child can
   * only hang off a row. Its components then show as untouched nodes with no
   * rows of their own, which is what keeps the table at one row per node
   * somebody actually opened.
   *
   * Answers with the whole refreshed tree, which is what the card's expansion
   * hook expects back.
   */
  expandSalvageNode: capabilityProcedure
    .input(z.object({ returnLineRecordId: recordIdSchema, nodeKey: salvageNodeKey }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      ctx.capabilities.assertEditEntity(await requireDefId(organizationId, 'return_part_line'))

      const result = await expandSalvageNode(ctx.db, organizationId, userId, {
        returnLineId: parseRecordId(input.returnLineRecordId).entityInstanceId,
        nodeKey: input.nodeKey,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * `ReturnSalvageCard`'s `onChangeQuantity`.
   *
   * Refused when the rows for one part under one parent would add up to more
   * than the bill of materials allows there (§6.6, invariant 2). The check runs
   * against the tree the write WOULD produce, so a refusal leaves nothing
   * half-applied.
   */
  setSalvageNodeQuantity: capabilityProcedure
    .input(
      z.object({
        returnLineRecordId: recordIdSchema,
        nodeKey: salvageNodeKey,
        quantity: unitQuantity,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      ctx.capabilities.assertEditEntity(await requireDefId(organizationId, 'return_part_line'))

      const result = await setSalvageNodeQuantity(ctx.db, organizationId, userId, {
        returnLineId: parseRecordId(input.returnLineRecordId).entityInstanceId,
        nodeKey: input.nodeKey,
        quantity: input.quantity,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * `ReturnSalvageCard`'s `onChangeStatus`.
   *
   * The first non-`undecided` write on an untouched node is what creates its
   * row. Writing `good` records a decision and nothing else: only the gated
   * salvage writer turns the highest `good` node in a branch into a `return_in`.
   */
  setSalvageNodeStatus: capabilityProcedure
    .input(
      z.object({
        returnLineRecordId: recordIdSchema,
        nodeKey: salvageNodeKey,
        status: z.enum(SALVAGE_STATUSES),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      ctx.capabilities.assertEditEntity(await requireDefId(organizationId, 'return_part_line'))

      const result = await setSalvageNodeStatus(ctx.db, organizationId, userId, {
        returnLineId: parseRecordId(input.returnLineRecordId).entityInstanceId,
        nodeKey: input.nodeKey,
        status: input.status,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * `ReturnSalvageCard`'s `onSplit`: divide a row into two siblings whose
   * quantities sum to what it held.
   *
   * Four came back, three are fine and one has to be drilled into. The default
   * split is `quantity - 1` and `1`; `firstQuantity` overrides it. The sum is
   * preserved, so the parent's allowance is untouched by construction.
   */
  splitSalvageNode: capabilityProcedure
    .input(
      z.object({
        returnLineRecordId: recordIdSchema,
        nodeKey: salvageNodeKey,
        firstQuantity: z.number().int().min(1).max(1_000_000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      ctx.capabilities.assertEditEntity(await requireDefId(organizationId, 'return_part_line'))

      const result = await splitSalvageNode(ctx.db, organizationId, userId, {
        returnLineId: parseRecordId(input.returnLineRecordId).entityInstanceId,
        nodeKey: input.nodeKey,
        firstQuantity: input.firstQuantity,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),
})

/**
 * Resolve an entity definition id from the org cache, or refuse.
 *
 * A missing definition is a 404 rather than a 403: the member is not being
 * denied anything, the organization simply has no returns yet because the
 * entity migration has not run for it.
 */
async function requireDefId(organizationId: string, entityType: string): Promise<string> {
  const defId = await getCachedEntityDefId(organizationId, entityType)
  if (!defId) {
    throw new NotFoundError(`This organization has no ${entityType} records yet.`)
  }
  return defId
}
