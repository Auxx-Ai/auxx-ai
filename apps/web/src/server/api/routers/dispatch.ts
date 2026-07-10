// apps/web/src/server/api/routers/dispatch.ts

import { isOrgMember } from '@auxx/lib/cache'
import {
  assignVisit,
  convertRequestToWorkOrder,
  createWorkOrderFromTicket,
  dispatchVisit,
  getBoard,
  listDispatchWorkers,
  listVisitsForWorkOrder,
  removeDispatchWorker,
  scheduleVisit,
  setVisitStatus,
  setWorkerActive,
  unscheduleVisit,
  upsertDispatchWorker,
  VISIT_STATUS_VALUES,
} from '@auxx/lib/dispatch'
import { BadRequestError, ForbiddenError } from '@auxx/lib/errors'
import { isAdminOrOwner } from '@auxx/lib/members'
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

/** `dispatchProcedure` + org admin/owner check — worker CRUD (§A.3) and visit scheduling
 * (§B, members are board-read-only per 04-ui §6) are admin surfaces. */
const dispatchAdminProcedure = dispatchProcedure.use(async ({ ctx, next }) => {
  if (!(await isAdminOrOwner(ctx.session.organizationId, ctx.session.user.id))) {
    throw new ForbiddenError('You must be an admin or owner to manage dispatch')
  }
  return next()
})

/** Echo-suppression convention (07 §B.4, the `agent.ts:234` precedent). */
function excludeSocketId(ctx: { headers: Headers }): string | undefined {
  return ctx.headers.get('x-realtime-socket-id') ?? undefined
}

const addressStructSchema = z.object({
  street1: z.string(),
  street2: z.string().optional(),
  city: z.string(),
  state: z.string(),
  zipCode: z.string(),
  country: z.string(),
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

  // §A — DispatchWorker CRUD (07-m2-build.md §A.3).
  listWorkers: dispatchProcedure.query(async ({ ctx }) => {
    return listDispatchWorkers(ctx.session.organizationId)
  }),
  upsertWorker: dispatchAdminProcedure
    .input(
      z.object({
        userId: z.string(),
        isActive: z.boolean().optional(),
        color: z.string().nullable().optional(),
        homeBase: addressStructSchema.nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!(await isOrgMember(ctx.session.organizationId, input.userId))) {
        throw new BadRequestError('User is not a member of this organization')
      }
      return upsertDispatchWorker({
        organizationId: ctx.session.organizationId,
        userId: input.userId,
        isActive: input.isActive,
        color: input.color,
        homeBase: input.homeBase,
      })
    }),
  removeWorker: dispatchAdminProcedure
    .input(z.object({ workerId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await removeDispatchWorker(ctx.session.organizationId, input.workerId)
      return { success: true }
    }),
  setWorkerActive: dispatchAdminProcedure
    .input(z.object({ workerId: z.string(), isActive: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      return setWorkerActive(ctx.session.organizationId, input.workerId, input.isActive)
    }),

  // §B — Visit machinery (07-m2-build.md §B). Admin-gated per 04-ui §6/07 §D.2 (members are
  // read-only on the board); the worker-mobile plan later carves out scoped member writes
  // (e.g. assignee updating own visit status).
  scheduleVisit: dispatchAdminProcedure
    .input(
      z.object({
        visitId: z.string(),
        startTime: z.coerce.date(),
        endTime: z.coerce.date(),
        assigneeUserId: z.string().nullable().optional(),
        timezone: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return scheduleVisit({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        visitId: input.visitId,
        startTime: input.startTime,
        endTime: input.endTime,
        assigneeUserId: input.assigneeUserId,
        timezone: input.timezone,
        excludeSocketId: excludeSocketId(ctx),
      })
    }),
  assignVisit: dispatchAdminProcedure
    .input(z.object({ visitId: z.string(), assigneeUserId: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      return assignVisit({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        visitId: input.visitId,
        assigneeUserId: input.assigneeUserId,
        excludeSocketId: excludeSocketId(ctx),
      })
    }),
  unscheduleVisit: dispatchAdminProcedure
    .input(z.object({ visitId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return unscheduleVisit({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        visitId: input.visitId,
        excludeSocketId: excludeSocketId(ctx),
      })
    }),
  setVisitStatus: dispatchAdminProcedure
    .input(z.object({ visitId: z.string(), status: z.enum(VISIT_STATUS_VALUES) }))
    .mutation(async ({ ctx, input }) => {
      return setVisitStatus({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        visitId: input.visitId,
        status: input.status,
        excludeSocketId: excludeSocketId(ctx),
      })
    }),
  dispatchVisit: dispatchAdminProcedure
    .input(z.object({ visitId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return dispatchVisit({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        visitId: input.visitId,
        excludeSocketId: excludeSocketId(ctx),
      })
    }),

  // §B.6 — the board's single read. Members read it (read-only board interactions).
  getBoard: dispatchProcedure
    .input(z.object({ from: z.coerce.date(), to: z.coerce.date() }))
    .query(async ({ ctx, input }) => {
      return getBoard(ctx.session.organizationId, { from: input.from, to: input.to })
    }),

  // §F.3 (M2b job view) — visits for one work order, oldest-scheduled-first.
  listVisits: dispatchProcedure
    .input(z.object({ workOrderRecordId: recordIdSchema }))
    .query(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.workOrderRecordId)
      return listVisitsForWorkOrder(ctx.session.organizationId, entityInstanceId)
    }),
})
