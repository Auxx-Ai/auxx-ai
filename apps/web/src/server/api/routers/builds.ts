// apps/web/src/server/api/routers/builds.ts

import { previewStandardCostRoll, rollStandardCost } from '@auxx/lib/builds'
import { getCachedEntityDefId } from '@auxx/lib/cache'
import { NotFoundError } from '@auxx/lib/errors'
import { z } from 'zod'
import { capabilityProcedure, createTRPCRouter } from '~/server/api/trpc'

/**
 * A roll may be scoped to a handful of parts, or run across the org.
 *
 * The cap is generous rather than meaningful — the widening step adds every
 * ancestor anyway, and an unscoped roll covers everything. It exists only so a
 * malformed client cannot send an unbounded array.
 */
const rollInput = z.object({
  partIds: z.array(z.string().min(1)).max(500).optional(),
  /** When the new standards take effect. Defaults to now. */
  effectiveAt: z.coerce.date().optional(),
})

/**
 * Standard cost — phase 1 of plans/products/build/01-build-plan.md.
 *
 * **Both procedures here are the permission gate for the lib call underneath.**
 * `@auxx/lib/builds` contains no access checks by design, so if a gate is
 * missing here it is missing everywhere.
 *
 * | procedure          | gate                |
 * | ------------------ | ------------------- |
 * | `previewRoll`      | edit on `part`      |
 * | `roll`             | edit on `part`      |
 *
 * `assertEditEntity` on `part` on BOTH, not view on the preview: the preview
 * exists solely to be the first half of a write, it discloses the balance-sheet
 * effect of that write, and a reader who cannot roll has no use for it. Gating
 * it the same way is what makes the button the UI hides and the door the server
 * closes the same door.
 *
 * Lib returns neverthrow `Result`s carrying `AuxxError`s; those are rethrown
 * as-is so `auxxErrorMiddleware` maps them. Wrapping one in a `TRPCError` would
 * flatten the 422 an unpriced component produces into a 500.
 */
export const buildsRouter = createTRPCRouter({
  /**
   * What a roll WOULD do to the balance sheet.
   *
   * 🛑 **This is the point of the whole action** (section 2.4). A roll restates
   * inventory value, so it must never be a button that just fires: this returns
   * the revaluation delta per part and summed, plus the parts that cannot be
   * valued at all, before anything is committed.
   *
   * A `.query()` because it writes nothing — not even the `part_cost` refresh
   * the roll performs. In practice `part_cost` is already current;
   * `recalculateAffectedParts` rewrites it on every vendor-price and
   * bill-of-materials change.
   */
  previewRoll: capabilityProcedure.input(rollInput).query(async ({ ctx, input }) => {
    const { organizationId } = ctx.session
    ctx.capabilities.assertEditEntity(await requirePartDefId(organizationId))

    const result = await previewStandardCostRoll(ctx.db, organizationId, {
      partIds: input.partIds,
      effectiveAt: input.effectiveAt ?? new Date(),
    })
    if (result.isErr()) throw result.error
    return result.value
  }),

  /**
   * Freeze a new standard cost onto every part in scope.
   *
   * The revaluation delta comes back on the result and is **not posted** — GL
   * posting is out of scope for this directory (README B9). Nothing here
   * touches an existing `stock_movement`: a mid-period standard change revalues
   * on-hand inventory, it never restates history.
   */
  roll: capabilityProcedure.input(rollInput).mutation(async ({ ctx, input }) => {
    const { organizationId, userId } = ctx.session
    ctx.capabilities.assertEditEntity(await requirePartDefId(organizationId))

    const result = await rollStandardCost(ctx.db, organizationId, userId, {
      partIds: input.partIds,
      effectiveAt: input.effectiveAt ?? new Date(),
    })
    if (result.isErr()) throw result.error
    return result.value
  }),
})

/**
 * Resolve the `part` definition from the org cache, or refuse.
 *
 * A missing def is a 404 rather than a 403: the member is not being denied
 * anything, the organization simply has no parts yet.
 */
async function requirePartDefId(organizationId: string): Promise<string> {
  const defId = await getCachedEntityDefId(organizationId, 'part')
  if (!defId) {
    throw new NotFoundError('This organization has no part records yet.')
  }
  return defId
}
