// apps/web/src/server/api/routers/dispatch.ts

import { schema } from '@auxx/database'
import { isOrgMember } from '@auxx/lib/cache'
import {
  assignVisit,
  convertRequestToWorkOrder,
  createWorkOrderFromTicket,
  dispatchVisit,
  endEngagement,
  getBoard,
  listDispatchWorkers,
  listVisitsForWorkOrder,
  pauseEngagement,
  removeDispatchWorker,
  resumeEngagement,
  scheduleVisit,
  setRecurrenceRule,
  setVisitStatus,
  setWorkerActive,
  unscheduleVisit,
  upsertDispatchWorker,
  VISIT_STATUS_VALUES,
} from '@auxx/lib/dispatch'
import { BadRequestError, ForbiddenError, NotFoundError } from '@auxx/lib/errors'
import { isAdminOrOwner } from '@auxx/lib/members'
import { FeaturePermissionService } from '@auxx/lib/permissions'
import { FeatureKey } from '@auxx/lib/permissions/client'
import { recurrencePatternSchema } from '@auxx/lib/recurrence'
import { parseRecordId, recordIdSchema } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
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

/** The visit template carried by a `RecurrenceRule` (06-recurring-engine.md §3.1). */
const recurrenceTemplateSchema = z.object({
  startMinute: z.number().int().min(0).max(1439),
  durationMinutes: z.number().int().min(1),
  defaultAssigneeUserId: z.string().nullable().optional(),
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

  // §5.4 — the M2c recurring engine. Admin-gated like the rest of visit machinery.
  getRecurrence: dispatchProcedure
    .input(z.object({ workOrderRecordId: recordIdSchema }))
    .query(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.workOrderRecordId)
      const rule = await ctx.db.query.RecurrenceRule.findFirst({
        where: and(
          eq(schema.RecurrenceRule.organizationId, ctx.session.organizationId),
          eq(schema.RecurrenceRule.subjectType, 'work_order_visits'),
          eq(schema.RecurrenceRule.subjectId, entityInstanceId)
        ),
      })
      return rule ?? null
    }),
  setRecurrence: dispatchAdminProcedure
    .input(
      z.object({
        workOrderRecordId: recordIdSchema,
        pattern: recurrencePatternSchema,
        template: recurrenceTemplateSchema,
        timezone: z.string(),
        effectiveFrom: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.workOrderRecordId)
      return setRecurrenceRule({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        workOrderInstanceId: entityInstanceId,
        pattern: input.pattern,
        template: input.template,
        timezone: input.timezone,
        effectiveFrom: input.effectiveFrom,
        excludeSocketId: excludeSocketId(ctx),
      })
    }),
  pauseEngagement: dispatchAdminProcedure
    .input(z.object({ workOrderRecordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.workOrderRecordId)
      await pauseEngagement({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        workOrderInstanceId: entityInstanceId,
        excludeSocketId: excludeSocketId(ctx),
      })
      return { success: true }
    }),
  resumeEngagement: dispatchAdminProcedure
    .input(z.object({ workOrderRecordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.workOrderRecordId)
      await resumeEngagement({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        workOrderInstanceId: entityInstanceId,
        excludeSocketId: excludeSocketId(ctx),
      })
      return { success: true }
    }),
  endEngagement: dispatchAdminProcedure
    .input(z.object({ workOrderRecordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.workOrderRecordId)
      await endEngagement({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        workOrderInstanceId: entityInstanceId,
        excludeSocketId: excludeSocketId(ctx),
      })
      return { success: true }
    }),
  // Three-way "this and following" / "all visits" edit (06 §4.3): loads the target visit's
  // rule, keeps the pattern unchanged, merges the template edit, and re-anchors
  // `effectiveFrom` at the visit's occurrenceDate (following) or the rule's anchor (all).
  applyToSeries: dispatchAdminProcedure
    .input(
      z.object({
        visitId: z.string(),
        scope: z.enum(['following', 'all']),
        changes: z.object({
          startMinute: z.number().int().min(0).max(1439).optional(),
          durationMinutes: z.number().int().min(1).optional(),
          assigneeUserId: z.string().nullable().optional(),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const visit = await ctx.db.query.WorkOrderVisit.findFirst({
        where: and(
          eq(schema.WorkOrderVisit.id, input.visitId),
          eq(schema.WorkOrderVisit.organizationId, ctx.session.organizationId)
        ),
      })
      if (!visit?.recurrenceRuleId) {
        throw new NotFoundError('Visit is not part of a recurring series')
      }
      const rule = await ctx.db.query.RecurrenceRule.findFirst({
        where: and(
          eq(schema.RecurrenceRule.id, visit.recurrenceRuleId),
          eq(schema.RecurrenceRule.organizationId, ctx.session.organizationId)
        ),
      })
      if (!rule) throw new NotFoundError('Recurrence rule not found')

      const effectiveFrom =
        input.scope === 'following' ? (visit.occurrenceDate ?? rule.anchor) : rule.anchor

      return setRecurrenceRule({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        workOrderInstanceId: rule.subjectId,
        pattern: rule.pattern as unknown as z.infer<typeof recurrencePatternSchema>,
        template: {
          startMinute: input.changes.startMinute ?? rule.startMinute ?? 0,
          durationMinutes: input.changes.durationMinutes ?? rule.durationMinutes ?? 60,
          defaultAssigneeUserId:
            input.changes.assigneeUserId !== undefined
              ? input.changes.assigneeUserId
              : rule.defaultAssigneeUserId,
        },
        timezone: rule.timezone,
        effectiveFrom,
        excludeSocketId: excludeSocketId(ctx),
      })
    }),
})
