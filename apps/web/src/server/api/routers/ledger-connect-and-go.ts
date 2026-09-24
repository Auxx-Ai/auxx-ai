// apps/web/src/server/api/routers/ledger-connect-and-go.ts
// Mounted as `ledger.connectAndGo`. See plans/accounting/tasks/105-connect-and-go.md §4.

import {
  completeConnectAndGo,
  prepareConnectAndGo,
  previewConnectAndGoBacklog,
} from '@auxx/lib/accounting/connect-and-go'
import { PermissionKey } from '@auxx/lib/permissions'
import { z } from 'zod'
import { createTRPCRouter, permissionProcedure } from '~/server/api/trpc'

const monthKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected a YYYY-MM month')
const exportMode = z.enum(['transaction', 'summary'])

export const ledgerConnectAndGoRouter = createTRPCRouter({
  /** Run (or re-run) everything that posts nothing; idempotent, so opening the screen refreshes it. */
  prepare: permissionProcedure(PermissionKey.ledgerControl).mutation(async ({ ctx }) => {
    const result = await prepareConnectAndGo(ctx.db, {
      organizationId: ctx.session.organizationId,
      actorUserId: ctx.session.userId,
    })
    if (result.isErr()) throw result.error
    return result.value
  }),

  /** What the recovery sweeps would post after this cutover. */
  preview: permissionProcedure(PermissionKey.ledgerControl)
    .input(
      z.object({
        cutoffPeriod: monthKey,
        bookTimeZone: z.string().nullish(),
        exportMode: exportMode.nullish(),
      })
    )
    .query(async ({ ctx, input }) => {
      const result = await previewConnectAndGoBacklog(ctx.db, {
        organizationId: ctx.session.organizationId,
        ...input,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /** The person's answers: write them, activate exports, fill, finalize and post the opening. */
  complete: permissionProcedure(PermissionKey.ledgerControl)
    .input(
      z.object({
        cutoffPeriod: monthKey,
        answers: z
          .object({
            roles: z.array(z.object({ role: z.string().min(1), glAccountId: z.string().min(1) })),
            railBanks: z.array(
              z.object({ paymentGatewayId: z.string().min(1), glAccountId: z.string().min(1) })
            ),
            acceptBankAccounts: z.array(z.string().min(1)),
            bookTimeZone: z.string().nullish(),
            fiscalYearStartMonth: z.number().int().min(1).max(12).nullish(),
            exportMode: exportMode.nullish(),
            exportSettings: z.array(
              z.object({ key: z.string().min(1), value: z.union([z.boolean(), z.string()]) })
            ),
          })
          .partial()
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await completeConnectAndGo(ctx.db, {
        organizationId: ctx.session.organizationId,
        actorUserId: ctx.session.userId,
        cutoffPeriod: input.cutoffPeriod,
        answers: input.answers,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),
})
