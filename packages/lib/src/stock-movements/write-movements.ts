// packages/lib/src/stock-movements/write-movements.ts

/**
 * `writeStockMovements` - the ONE writer behind `receive-stock.ts`,
 * `adjust-stock.ts`, `reverse-movement.ts`, `complete-build.ts` and
 * `reverse-build.ts` (plans/money/tasks/50-batch-inventory-relief.md §2).
 *
 * `bulk-opening-stock.ts` is the sixth caller and deliberately does NOT go
 * through this function: its cardinality is `UnifiedCrudHandler.bulkCreate`
 * with per-INDEX failure tolerance (one bad part must not lose the other
 * 494), which §2.2 does not name as a shared axis. It still shares
 * `buildStockMovementValues` (`values.ts`) for the nine keys and the sign
 * convention, so the ONE rule six files used to restate by hand
 * (`adjustSubparts` defaults false) has one definition regardless.
 *
 * ## What is a parameter here, never a branch (§2.2)
 *
 * - **The lane** - `ctx.lane`. `'plain'` constructs
 *   `new UnifiedCrudHandler(organizationId, userId, db)` exactly as
 *   `receive-stock.ts` / `adjust-stock.ts` / `reverse-movement.ts` do today
 *   (no session override, no `bypassFieldGuards`). `'quiet'` adds the
 *   session and the builds-only `bypassFieldGuards` - see `types.ts`.
 * - **`bypassFieldGuards`** rides on the quiet lane only, and is inert here:
 *   `stock_movement` has no attribute it would ever bypass. It is threaded
 *   through purely so `complete-build.ts` and `reverse-build.ts` do not need
 *   a second `UnifiedCrudHandler` construction site for their movement
 *   writes.
 * - **The typed links** - resolved here, once, from bare
 *   `EntityInstance.id`s. §2.4 item 4: a reversal (or any future writer)
 *   copies the WHOLE link set rather than a hand-listed subset, because
 *   there is exactly one place that knows how to turn a link into a
 *   `RecordId`.
 * - **`extendedCost`** - computed here from `computeExtendedCost`, unless
 *   the caller supplies the override (`values.ts`).
 *
 * `affectedPartIds` comes back from every call (§2.4 item 3): the quiet
 * lane's caller passes it to `batchRecalculateQoH` after its transaction
 * commits, and the set is a fact about what was WRITTEN, not something the
 * caller re-derives and could get out of sync.
 */

import type { Result } from 'neverthrow'
import { getCachedEntityDefId } from '../cache'
import { UnprocessableEntityError } from '../errors'
import { UnifiedCrudHandler } from '../resources/crud/unified-handler'
import { isRecordId, type RecordId, toRecordId } from '../resources/resource-id'
import { guard } from './guard'
import type {
  StockMovementInput,
  StockMovementLinks,
  StockMovementsCtx,
  WriteStockMovementsResult,
  WrittenStockMovement,
} from './types'
import { buildStockMovementValues, type ResolvedStockMovementLinks } from './values'

/** The entity type a bare link id resolves against, for every link but the two that point at a `stock_movement` itself. */
const LINK_ENTITY_TYPES = {
  vendorPartId: 'vendor_part',
  purchaseOrderLineId: 'purchase_order_line',
  buildId: 'build',
  fulfillmentLineId: 'fulfillment_line',
} as const

/**
 * Resolve one bare link id to a `RecordId`, or pass an already-built
 * `RecordId` through unchanged - a caller that already resolved its OWN def
 * id (a build's own field context, for instance) is not made to resolve it
 * twice, and cannot disagree with itself by doing so.
 *
 * Throws `UnprocessableEntityError` naming the entity type when the org has
 * no such definition - the exact refusal `receive-stock.ts` and
 * `reverse-movement.ts` each hand-rolled as their own `requireDefId` before
 * this extraction.
 */
async function resolveLinkId(
  organizationId: string,
  entityType: string,
  value: string
): Promise<RecordId> {
  if (isRecordId(value)) return value
  const defId = await getCachedEntityDefId(organizationId, entityType)
  if (!defId) {
    throw new UnprocessableEntityError(
      `This organization has no ${entityType} entity definition yet`
    )
  }
  return toRecordId(defId, value)
}

/**
 * `reversesMovementId` / `parentMovementId` point at a `stock_movement`
 * itself - the def id this call is ALREADY writing against, so no second
 * cache lookup is needed or made.
 */
function resolveMovementLinkId(movementDefId: string, value: string): RecordId {
  return isRecordId(value) ? value : toRecordId(movementDefId, value)
}

async function resolveLinks(
  ctx: StockMovementsCtx,
  links: StockMovementLinks | undefined
): Promise<ResolvedStockMovementLinks | undefined> {
  if (!links) return undefined
  const resolved: ResolvedStockMovementLinks = {}

  if (links.vendorPartId) {
    resolved.vendorPart = await resolveLinkId(
      ctx.organizationId,
      LINK_ENTITY_TYPES.vendorPartId,
      links.vendorPartId
    )
  }
  if (links.purchaseOrderLineId) {
    resolved.purchaseOrderLine = await resolveLinkId(
      ctx.organizationId,
      LINK_ENTITY_TYPES.purchaseOrderLineId,
      links.purchaseOrderLineId
    )
  }
  if (links.buildId) {
    resolved.build = await resolveLinkId(
      ctx.organizationId,
      LINK_ENTITY_TYPES.buildId,
      links.buildId
    )
  }
  if (links.fulfillmentLineId) {
    resolved.fulfillmentLine = await resolveLinkId(
      ctx.organizationId,
      LINK_ENTITY_TYPES.fulfillmentLineId,
      links.fulfillmentLineId
    )
  }
  if (links.reversesMovementId) {
    resolved.reversesMovement = resolveMovementLinkId(ctx.movementDefId, links.reversesMovementId)
  }
  if (links.parentMovementId) {
    resolved.parentMovement = resolveMovementLinkId(ctx.movementDefId, links.parentMovementId)
  }

  return resolved
}

/**
 * The one `UnifiedCrudHandler` every input in this call writes through -
 * `ctx.handler` when the caller supplied one (see its doc comment), else a
 * fresh construction from the lane.
 */
function buildHandler(ctx: StockMovementsCtx): UnifiedCrudHandler {
  if (ctx.handler) return ctx.handler
  if (ctx.lane.kind === 'quiet') {
    return new UnifiedCrudHandler(ctx.organizationId, ctx.userId, ctx.db, undefined, {
      session: ctx.lane.session,
      bypassFieldGuards: ctx.lane.bypassFieldGuards,
    })
  }
  return new UnifiedCrudHandler(ctx.organizationId, ctx.userId, ctx.db)
}

/**
 * Write one or more `stock_movement` rows, atomically in the sense that every
 * write shares one `UnifiedCrudHandler` and the caller decides the
 * transaction boundary (§2's "no lane changes" - this function never opens
 * its own transaction). A create that throws partway through propagates as
 * `Err` and leaves whatever the caller's own transaction (if any) rolls back.
 *
 * Call it once per row for a single-movement writer (`receive-stock.ts`,
 * `adjust-stock.ts`, `reverse-movement.ts`), once with the whole batch for a
 * writer whose rows carry no live, order-dependent computation between them
 * (`reverse-build.ts`), or split across calls when a value genuinely can only
 * be known after an earlier write has landed (`complete-build.ts`'s produce
 * row, whose GL account is resolved after every consume row is written -
 * see that file's own comment for why the split is load-bearing there).
 */
export async function writeStockMovements(
  ctx: StockMovementsCtx,
  inputs: StockMovementInput[]
): Promise<Result<WriteStockMovementsResult, Error>> {
  return guard(
    async () => {
      const crud = buildHandler(ctx)
      const records: WrittenStockMovement[] = []
      const affectedPartIds = new Set<string>()

      for (const input of inputs) {
        const links = await resolveLinks(ctx, input.links)
        const partRecordId = toRecordId(ctx.partDefId, input.partInstanceId)

        const values = buildStockMovementValues({
          partRecordId,
          type: input.type,
          quantity: input.quantity,
          unitCost: input.unitCost,
          costBasis: input.costBasis,
          glAccount: input.glAccount,
          occurredAt: input.occurredAt,
          extendedCost: input.extendedCost,
          adjustSubparts: input.adjustSubparts,
          reason: input.reason,
          reference: input.reference,
          qtyPerUnit: input.qtyPerUnit,
          vendorUnitPrice: input.vendorUnitPrice,
          links,
        })

        const created = await crud.create(ctx.movementDefId, values)

        records.push({
          movementId: created.instance.id,
          recordId: toRecordId(ctx.movementDefId, created.instance.id),
          partInstanceId: input.partInstanceId,
          quantity: input.quantity,
          unitCost: input.unitCost,
          extendedCost: values.stock_movement_extended_cost as number,
          glAccount: input.glAccount ?? null,
          occurredAt: input.occurredAt,
        })
        affectedPartIds.add(input.partInstanceId)
      }

      return { records, affectedPartIds: [...affectedPartIds] }
    },
    'Failed to write stock movements',
    { organizationId: ctx.organizationId, count: inputs.length }
  )
}
