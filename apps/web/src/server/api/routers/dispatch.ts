// apps/web/src/server/api/routers/dispatch.ts

import { convertRequestToWorkOrder, createWorkOrderFromTicket } from '@auxx/lib/dispatch'
import { FeaturePermissionService } from '@auxx/lib/permissions'
import { FeatureKey } from '@auxx/lib/permissions/client'
import { parseRecordId, recordIdSchema } from '@auxx/types/resource'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'

/** protectedProcedure + the `dispatch` feature gate — guards every dispatch mutation (§G). */
const dispatchProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  await new FeaturePermissionService().requireAccess(
    ctx.session.organizationId,
    FeatureKey.dispatch
  )
  return next()
})

export const dispatchRouter = createTRPCRouter({
  // PRIMARY intake path (01 §8/§9) — request → job.
  convertToWorkOrder: dispatchProcedure
    .input(z.object({ requestRecordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.requestRecordId)
      return convertRequestToWorkOrder({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        requestInstanceId: entityInstanceId,
      })
    }),
  // SECONDARY intake path (01 §8) — ticket → job, kept alongside convertToWorkOrder.
  createFromTicket: dispatchProcedure
    .input(z.object({ ticketRecordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.ticketRecordId)
      return createWorkOrderFromTicket({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        ticketInstanceId: entityInstanceId,
      })
    }),
})
