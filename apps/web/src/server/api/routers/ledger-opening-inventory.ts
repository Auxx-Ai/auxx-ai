// apps/web/src/server/api/routers/ledger-opening-inventory.ts
// Mounted as `ledger.openingInventory`: the explicit, repeatable opening inventory difference
// screen (plans/accounting/tasks/111 Q19/Q23).

import {
  postOpeningInventoryAdjustment,
  readOpeningInventoryDifference,
  setCount,
} from '@auxx/lib/inventory/receiving'
import { PermissionKey } from '@auxx/lib/permissions'
import { updateOrganizationSetting } from '@auxx/lib/settings'
import { z } from 'zod'
import { createTRPCRouter, permissionProcedure } from '~/server/api/trpc'

export const ledgerOpeningInventoryRouter = createTRPCRouter({
  /** Books against parts at the cutover, the delta a press would post, and who is uncounted. */
  read: permissionProcedure(PermissionKey.ledgerControl).query(async ({ ctx }) => {
    const result = await readOpeningInventoryDifference(ctx.db, {
      organizationId: ctx.session.organizationId,
    })
    if (result.isErr()) throw result.error
    return result.value
  }),

  /** One press: post the delta since the last difference entry. Never called automatically. */
  post: permissionProcedure(PermissionKey.ledgerControl).mutation(async ({ ctx }) => {
    const result = await postOpeningInventoryAdjustment(ctx.db, {
      organizationId: ctx.session.organizationId,
      actorUserId: ctx.session.userId,
    })
    if (result.isErr()) throw result.error
    return result.value
  }),

  /** The one-time answer that picks the credit account. */
  setInBooks: permissionProcedure(PermissionKey.ledgerControl)
    .input(z.object({ inBooks: z.enum(['revaluation', 'opening_equity']) }))
    .mutation(async ({ ctx, input }) => {
      await updateOrganizationSetting({
        organizationId: ctx.session.organizationId,
        key: 'accounting.openingInventoryInBooks',
        value: input.inBooks,
        db: ctx.db,
      })
      return { success: true }
    }),

  /**
   * Anchor uncounted parts at the channel's count. The client supplies the counts: nothing in
   * this repo reads `externalQuantity` yet (111 §3), so the compare stays on the screen.
   */
  adoptChannelCounts: permissionProcedure(PermissionKey.ledgerControl)
    .input(
      z.object({
        counts: z
          .array(z.object({ partId: z.string().min(1), quantity: z.number().finite() }))
          .min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const date = new Date()
      const results: { partId: string; ok: boolean; error?: string }[] = []
      for (const { partId, quantity } of input.counts) {
        const result = await setCount(ctx.db, ctx.session.organizationId, {
          partId,
          quantity,
          date,
          actorUserId: ctx.session.userId,
        })
        results.push(
          result.isOk() ? { partId, ok: true } : { partId, ok: false, error: result.error.message }
        )
      }
      return { results }
    }),
})
