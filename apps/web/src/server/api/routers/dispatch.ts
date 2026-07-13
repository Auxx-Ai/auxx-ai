// apps/web/src/server/api/routers/dispatch.ts

import { schema } from '@auxx/database'
import { isOrgMember } from '@auxx/lib/cache'
import {
  addMyAdhocQcItem,
  addMyQcItemPhoto,
  advanceMyVisit,
  applyRouteTimes,
  assignVisit,
  closeMyVisit,
  convertRequestToWorkOrder,
  createQcItemTemplate,
  createWorkOrderFromTicket,
  deleteQcItemTemplate,
  dispatchVisit,
  endEngagement,
  getBoard,
  getMyVisitDetail,
  getRouteGeometryForWorker,
  getRoutePlannerBoard,
  getVisitDayMarkers,
  listDispatchWorkers,
  listMyVisitQcItems,
  listMyVisits,
  listQcItemTemplates,
  listVisitsForWorkOrder,
  pauseEngagement,
  removeDispatchWorker,
  removeMyQcItemPhoto,
  reorderQcItemTemplates,
  resumeEngagement,
  scheduleVisit,
  setMyQcItemChecked,
  setMyQcItemNote,
  setRecurrenceRule,
  setRouteOrder,
  setVisitStatus,
  setWorkerActive,
  unscheduleVisit,
  updateQcItemTemplate,
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
        routeStartAtHome: z.boolean().optional(),
        routeEndAtHome: z.boolean().optional(),
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
        routeStartAtHome: input.routeStartAtHome,
        routeEndAtHome: input.routeEndAtHome,
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

  // v3 sidebar plan §1.4 — mini-calendar day-marker dots. Minimal-rows read (no server-side day
  // bucketing: day windows are always CLIENT-computed, same convention as `getBoard`); the client
  // groups these by local day and filters by visible worker itself, so there's no worker param.
  // Member read-only, same gating as `getBoard`.
  getVisitDayMarkers: dispatchProcedure
    .input(z.object({ from: z.date(), to: z.date() }))
    .query(async ({ ctx, input }) => {
      return getVisitDayMarkers(ctx.session.organizationId, { from: input.from, to: input.to })
    }),

  // Route planner (M3, 09-route-planner.md §F) — the planner's single read. Members read it
  // (read-only map interactions, same gating precedent as getBoard); `workerIds` narrows the
  // returned `workers` array only. Day windows are CLIENT-computed (the getBoard/listMyVisits
  // convention — the server is timezone-naive): `from`/`to` = local day bounds, `dateKey` =
  // its `yyyy-MM-dd` label (availability lookups + the Directions cache key).
  getRoutePlannerBoard: dispatchProcedure
    .input(
      z.object({
        from: z.date(),
        to: z.date(),
        dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        workerIds: z.array(z.string()).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { workerIds, ...window } = input
      return getRoutePlannerBoard(ctx.session.organizationId, window, workerIds)
    }),
  // Resolves depot + that worker's ordered geocoded stops server-side — draws the map's
  // polylines + per-stop ETAs. Read-only (member-gated), Redis content-addressed cache inside.
  getRouteGeometry: dispatchProcedure
    .input(
      z.object({
        from: z.date(),
        to: z.date(),
        dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        assigneeUserId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { assigneeUserId, ...window } = input
      return getRouteGeometryForWorker(ctx.session.organizationId, assigneeUserId, window)
    }),
  // Bulk `routeOrder` write (drag-reorder / suggest-route / backlog slot-in follow-up) —
  // admin-gated like the rest of visit machinery (§B).
  setRouteOrder: dispatchAdminProcedure
    .input(
      z.object({
        assigneeUserId: z.string(),
        from: z.date(),
        to: z.date(),
        visitIds: z.array(z.string()),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await setRouteOrder({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        assigneeUserId: input.assigneeUserId,
        window: { from: input.from, to: input.to },
        visitIds: input.visitIds,
        excludeSocketId: excludeSocketId(ctx),
      })
      return { success: true }
    }),
  // "Apply times to schedule" (design doc §E/§F, decision #1) — the only planner path that
  // writes `startTime`/`endTime`; admin-gated like the rest of visit machinery.
  applyRouteTimes: dispatchAdminProcedure
    .input(
      z.object({
        assigneeUserId: z.string(),
        dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        firstDeparture: z.date(),
        stops: z.array(z.object({ visitId: z.string(), durationMinutes: z.number().int().min(1) })),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await applyRouteTimes({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        assigneeUserId: input.assigneeUserId,
        dateKey: input.dateKey,
        firstDeparture: input.firstDeparture,
        stops: input.stops,
        excludeSocketId: excludeSocketId(ctx),
      })
      return { success: true }
    }),

  // §F.3 (M2b job view) — visits for one work order, oldest-scheduled-first.
  listVisits: dispatchProcedure
    .input(z.object({ workOrderRecordId: recordIdSchema }))
    .query(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.workOrderRecordId)
      return listVisitsForWorkOrder(ctx.session.organizationId, entityInstanceId)
    }),

  // 08-worker-surface.md §6 — the worker-scoped path. Member-level (not admin-gated): the
  // row-level assignee guard lives in the lib layer (`loadOwnVisit`), so orgId + userId always
  // come from the session, never input — a worker touches only their own visits.
  myVisits: dispatchProcedure
    .input(z.object({ from: z.date(), to: z.date() }))
    .query(async ({ ctx, input }) => {
      return listMyVisits({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        from: input.from,
        to: input.to,
      })
    }),
  getMyVisit: dispatchProcedure
    .input(z.object({ visitId: z.string() }))
    .query(async ({ ctx, input }) => {
      return getMyVisitDetail({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        visitId: input.visitId,
      })
    }),
  advanceMyVisit: dispatchProcedure
    .input(
      z.object({
        visitId: z.string(),
        to: z.enum(['scheduled', 'en_route', 'on_site']),
        clientDayEnd: z.date(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return advanceMyVisit({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        visitId: input.visitId,
        to: input.to,
        clientDayEnd: input.clientDayEnd,
      })
    }),
  closeMyVisit: dispatchProcedure
    .input(z.object({ visitId: z.string(), invoice: z.enum(['now', 'later', 'leave_open']) }))
    .mutation(async ({ ctx, input }) => {
      return closeMyVisit({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        visitId: input.visitId,
        invoice: input.invoice,
      })
    }),

  // 08-worker-surface.md §5 — the quality-checklist template catalog. Admin-managed;
  // org-scoped only, no assignee guard. Deleting a template never touches already-materialized
  // visit snapshots (their templateId FK is set-null on delete).
  listQcTemplates: dispatchAdminProcedure.query(async ({ ctx }) => {
    return listQcItemTemplates(ctx.session.organizationId)
  }),
  createQcTemplate: dispatchAdminProcedure
    .input(
      z.object({
        title: z.string().min(1),
        description: z.string().nullable().optional(),
        isRequired: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return createQcItemTemplate(ctx.session.organizationId, input)
    }),
  updateQcTemplate: dispatchAdminProcedure
    .input(
      z.object({
        templateId: z.string(),
        title: z.string().optional(),
        description: z.string().nullable().optional(),
        isRequired: z.boolean().optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return updateQcItemTemplate(ctx.session.organizationId, input)
    }),
  deleteQcTemplate: dispatchAdminProcedure
    .input(z.object({ templateId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await deleteQcItemTemplate(ctx.session.organizationId, input.templateId)
      return { success: true }
    }),
  reorderQcTemplates: dispatchAdminProcedure
    .input(z.array(z.object({ id: z.string(), sortOrder: z.number().int() })))
    .mutation(async ({ ctx, input }) => {
      await reorderQcItemTemplates(ctx.session.organizationId, input)
      return { success: true }
    }),

  // 08-worker-surface.md §5 — the worker-scoped checklist path. Member-level (not admin-gated):
  // the row-level assignee guard lives in the lib layer (`loadOwnVisit`/`loadOwnQcItem`), so
  // orgId + userId always come from the session, never input.
  listMyVisitQcItems: dispatchProcedure
    .input(z.object({ visitId: z.string() }))
    .query(async ({ ctx, input }) => {
      return listMyVisitQcItems(ctx.session.organizationId, ctx.session.user.id, input.visitId)
    }),
  setMyQcItemChecked: dispatchProcedure
    .input(z.object({ itemId: z.string(), checked: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      return setMyQcItemChecked(ctx.session.organizationId, ctx.session.user.id, input)
    }),
  setMyQcItemNote: dispatchProcedure
    .input(z.object({ itemId: z.string(), note: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      return setMyQcItemNote(ctx.session.organizationId, ctx.session.user.id, input)
    }),
  addMyAdhocQcItem: dispatchProcedure
    .input(z.object({ visitId: z.string(), title: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      return addMyAdhocQcItem(ctx.session.organizationId, ctx.session.user.id, input)
    }),
  addMyQcItemPhoto: dispatchProcedure
    .input(z.object({ itemId: z.string(), assetId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return addMyQcItemPhoto(ctx.session.organizationId, ctx.session.user.id, input)
    }),
  removeMyQcItemPhoto: dispatchProcedure
    .input(z.object({ itemId: z.string(), attachmentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await removeMyQcItemPhoto(ctx.session.organizationId, ctx.session.user.id, input)
      return { success: true }
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
