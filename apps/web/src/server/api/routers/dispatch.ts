// apps/web/src/server/api/routers/dispatch.ts

import { schema } from '@auxx/database'
import { getOrgCache, isOrgMember } from '@auxx/lib/cache'
import {
  addMyAdhocQcItem,
  addMyQcItemPhoto,
  addVisit,
  addVisitQcItemPhoto,
  advanceMyVisit,
  applyRouteTimes,
  assignVisit,
  cancelVisitFollowing,
  closeMyVisit,
  convertRequestToWorkOrder,
  createQcItemTemplate,
  createTeam,
  createWorkOrder,
  createWorkOrderFromTicket,
  deleteQcItemTemplate,
  dispatchVisit,
  endEngagement,
  getBoard,
  getMyVisitDetail,
  getRouteGeometryForWorker,
  getRoutePlannerBoard,
  getVisitDayMarkers,
  getWorkOrderStatus,
  listDispatchWorkers,
  listMyVisitQcItems,
  listMyVisits,
  listQcItemTemplates,
  listVisitQcItems,
  listVisitsForWorkOrder,
  pasteVisits,
  pauseEngagement,
  removeDispatchWorker,
  removeMyQcItemPhoto,
  removeVisitQcItemPhoto,
  renderVisitReportToAsset,
  reorderQcItemTemplates,
  restoreVisit,
  resumeEngagement,
  scheduleVisit,
  setMyQcItemChecked,
  setMyQcItemNote,
  setMyQcItemPhotoCaption,
  setRecurrenceRule,
  setRouteOrder,
  setSeriesEnd,
  setTeamMembers,
  setVisitDuration,
  setVisitQcItemPhotoCaption,
  setVisitStatus,
  setWorkerActive,
  unscheduleVisit,
  updateQcItemTemplate,
  updateTeam,
  upsertDispatchWorker,
  VISIT_STATUS_VALUES,
} from '@auxx/lib/dispatch'
import { BadRequestError, ForbiddenError, NotFoundError } from '@auxx/lib/errors'
import { FieldValueService } from '@auxx/lib/field-values'
import { isAdminOrOwner } from '@auxx/lib/members'
import { FeaturePermissionService, getCapabilities, PermissionKey } from '@auxx/lib/permissions'
import { FeatureKey } from '@auxx/lib/permissions/client'
import { recurrencePatternSchema } from '@auxx/lib/recurrence'
import type { TypedFieldValue } from '@auxx/types'
import { extractValue } from '@auxx/types'
import { parseRecordId, recordIdSchema, toRecordId } from '@auxx/types/resource'
import { and, eq, inArray } from 'drizzle-orm'
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
 * (§B, members are board-read-only per 04-ui §6) are admin surfaces. Layers the
 * `dispatchBoardManage` capability (Layer 2) on top of the admin gate and attaches the
 * resolved `CapabilitySet` as `ctx.capabilities` — admins hold every key by default, so
 * behavior is unchanged (the capability tightens, never loosens). */
const dispatchAdminProcedure = dispatchProcedure.use(async ({ ctx, next }) => {
  if (!(await isAdminOrOwner(ctx.session.organizationId, ctx.session.user.id))) {
    throw new ForbiddenError('You must be an admin or owner to manage dispatch')
  }
  const capabilities = await getCapabilities(ctx.session.userId, ctx.session.organizationId)
  capabilities.assert(PermissionKey.dispatchBoardManage)
  return next({ ctx: { capabilities } })
})

/** `dispatchProcedure` + the `dispatch.board.view` capability (§9). Read surfaces — full
 * members hold it by default; field (worker) seats do NOT, so board reads 403 for them. */
const dispatchViewProcedure = dispatchProcedure.use(async ({ ctx, next }) => {
  const capabilities = await getCapabilities(ctx.session.userId, ctx.session.organizationId)
  capabilities.assert(PermissionKey.dispatchBoardView)
  return next({ ctx: { capabilities } })
})

/** `dispatchProcedure` + the `dispatch.board.manage` capability, WITHOUT an admin gate —
 * member-level manage mutations (intake conversions). Full members hold the key; field
 * seats do not. */
const dispatchManageProcedure = dispatchProcedure.use(async ({ ctx, next }) => {
  const capabilities = await getCapabilities(ctx.session.userId, ctx.session.organizationId)
  capabilities.assert(PermissionKey.dispatchBoardManage)
  return next({ ctx: { capabilities } })
})

/** `dispatchProcedure` + the `dispatch.mySchedule` capability — the field-seat schedule
 * surface (08-worker-surface.md §6). Both full members and worker seats hold it. */
const dispatchMyScheduleProcedure = dispatchProcedure.use(async ({ ctx, next }) => {
  const capabilities = await getCapabilities(ctx.session.userId, ctx.session.organizationId)
  capabilities.assert(PermissionKey.dispatchMySchedule)
  return next({ ctx: { capabilities } })
})

/** `dispatchProcedure` + the `dispatch.visitReports` capability — the field-seat check-in /
 * QC checklist / photo write surface (§4.1). In the worker ceiling AND every role default. */
const dispatchVisitReportProcedure = dispatchProcedure.use(async ({ ctx, next }) => {
  const capabilities = await getCapabilities(ctx.session.userId, ctx.session.organizationId)
  capabilities.assert(PermissionKey.dispatchVisitReports)
  return next({ ctx: { capabilities } })
})

/** Echo-suppression convention (07 §B.4, the `agent.ts:234` precedent). */
function excludeSocketId(ctx: { headers: Headers }): string | undefined {
  return ctx.headers.get('x-realtime-socket-id') ?? undefined
}

/** Roll-up sync (plan 39 `dispatch/39-visit-cache-sync.md` §Phase-1): the work-order status
 * roll-up (`rollUpWorkOrderStatus`, `lifecycle.ts`) runs inside the mutation but its result is
 * otherwise discarded — this is the one read-back, merged onto the returned visit row so the
 * acting tab's cache patch (`applyVisitToCaches`) can reconcile board/drawer chip status without
 * a second round trip. Skipped for `assignVisit` (no roll-up rule of its own) and `pasteVisits`
 * (multi-work-order, out of scope for a single merged status). */
async function withWorkOrderStatus<T extends { workOrderId: string }>(
  ctx: { session: { organizationId: string; user: { id: string } } },
  visit: T
): Promise<T & { workOrderStatus: string | undefined }> {
  const workOrderStatus = await getWorkOrderStatus(
    ctx.session.organizationId,
    ctx.session.user.id,
    visit.workOrderId
  )
  return { ...visit, workOrderStatus }
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
  defaultAssigneeWorkerId: z.string().nullable().optional(),
})

export const dispatchRouter = createTRPCRouter({
  // PRIMARY intake path (01 §8/§9) — request → job.
  convertToWorkOrder: dispatchManageProcedure
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
  createFromTicket: dispatchManageProcedure
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
  listWorkers: dispatchViewProcedure.query(async ({ ctx }) => {
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

  // Teams (45-teams.md §6) — a `DispatchWorker` (type:'team') whose members are other
  // individual workers. Same admin gate as the rest of worker CRUD.
  createTeam: dispatchAdminProcedure
    .input(
      z.object({
        name: z.string().optional(),
        color: z.string().nullish(),
        homeBase: addressStructSchema.nullable().optional(),
        routeStartAtHome: z.boolean().optional(),
        routeEndAtHome: z.boolean().optional(),
        memberWorkerIds: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return createTeam(ctx.session.organizationId, input)
    }),
  updateTeam: dispatchAdminProcedure
    .input(
      z.object({
        teamWorkerId: z.string(),
        name: z.string().optional(),
        color: z.string().nullish(),
        homeBase: addressStructSchema.nullable().optional(),
        routeStartAtHome: z.boolean().optional(),
        routeEndAtHome: z.boolean().optional(),
        memberWorkerIds: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { teamWorkerId, ...rest } = input
      return updateTeam(ctx.session.organizationId, teamWorkerId, rest)
    }),
  setTeamMembers: dispatchAdminProcedure
    .input(z.object({ teamWorkerId: z.string(), memberWorkerIds: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      await setTeamMembers(ctx.session.organizationId, input.teamWorkerId, input.memberWorkerIds)
      return { success: true }
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
        assigneeWorkerId: z.string().nullable().optional(),
        timezone: z.string().optional(),
        timeWriteKind: z.enum(['provisional', 'confirmed']).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const visit = await scheduleVisit({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        visitId: input.visitId,
        startTime: input.startTime,
        endTime: input.endTime,
        assigneeWorkerId: input.assigneeWorkerId,
        timezone: input.timezone,
        timeWriteKind: input.timeWriteKind,
        excludeSocketId: excludeSocketId(ctx),
      })
      return withWorkOrderStatus(ctx, visit)
    }),
  assignVisit: dispatchAdminProcedure
    .input(z.object({ visitId: z.string(), assigneeWorkerId: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      return assignVisit({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        visitId: input.visitId,
        assigneeWorkerId: input.assigneeWorkerId,
        excludeSocketId: excludeSocketId(ctx),
      })
    }),
  unscheduleVisit: dispatchAdminProcedure
    .input(z.object({ visitId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const visit = await unscheduleVisit({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        visitId: input.visitId,
        excludeSocketId: excludeSocketId(ctx),
      })
      return withWorkOrderStatus(ctx, visit)
    }),
  setVisitStatus: dispatchAdminProcedure
    .input(z.object({ visitId: z.string(), status: z.enum(VISIT_STATUS_VALUES) }))
    .mutation(async ({ ctx, input }) => {
      const visit = await setVisitStatus({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        visitId: input.visitId,
        status: input.status,
        excludeSocketId: excludeSocketId(ctx),
      })
      return withWorkOrderStatus(ctx, visit)
    }),
  // "Skip this and future visits" — tombstones the target occurrence AND ends its series
  // there (`until` stamp + later-scheduled-row cleanup). Single-row cancels keep going
  // through `setVisitStatus`.
  cancelVisitFollowing: dispatchAdminProcedure
    .input(z.object({ visitId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await cancelVisitFollowing({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        visitId: input.visitId,
        excludeSocketId: excludeSocketId(ctx),
      })
      return { success: true }
    }),
  dispatchVisit: dispatchAdminProcedure
    .input(z.object({ visitId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const visit = await dispatchVisit({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        visitId: input.visitId,
        excludeSocketId: excludeSocketId(ctx),
      })
      return withWorkOrderStatus(ctx, visit)
    }),
  // Plan 30 §A.1 — bring a canceled visit back to `scheduled` IN PLACE (never a new time).
  // `resumeSeries` (plan 36 §A.2): on the series boundary visit only, also clears the
  // pattern's `until` and regenerates the tail — the symmetric undo of "Skip this and future".
  restoreVisit: dispatchAdminProcedure
    .input(z.object({ visitId: z.string(), resumeSeries: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      const visit = await restoreVisit({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        visitId: input.visitId,
        resumeSeries: input.resumeSeries,
        excludeSocketId: excludeSocketId(ctx),
      })
      return withWorkOrderStatus(ctx, visit)
    }),

  // §B.6 — the board's single read. Members read it (read-only board interactions).
  getBoard: dispatchViewProcedure
    .input(z.object({ from: z.coerce.date(), to: z.coerce.date() }))
    .query(async ({ ctx, input }) => {
      return getBoard(ctx.session.organizationId, { from: input.from, to: input.to })
    }),

  // v3 sidebar plan §1.4 — mini-calendar day-marker dots. Minimal-rows read (no server-side day
  // bucketing: day windows are always CLIENT-computed, same convention as `getBoard`); the client
  // groups these by local day and filters by visible worker itself, so there's no worker param.
  // Member read-only, same gating as `getBoard`.
  getVisitDayMarkers: dispatchViewProcedure
    .input(
      z.object({
        from: z.date(),
        to: z.date(),
        // Plan 30 §B.1 — mirrors the sidebar footer's "Show canceled" toggle so the mini-
        // calendar's dots agree with what the board actually renders. Default false (excluded).
        includeCanceled: z.boolean().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      return getVisitDayMarkers(
        ctx.session.organizationId,
        { from: input.from, to: input.to },
        { includeCanceled: input.includeCanceled ?? false }
      )
    }),

  // Route planner (M3, 09-route-planner.md §F) — the planner's single read. Members read it
  // (read-only map interactions, same gating precedent as getBoard); `workerIds` narrows the
  // returned `workers` array only. Day windows are CLIENT-computed (the getBoard/listMyVisits
  // convention — the server is timezone-naive): `from`/`to` = local day bounds, `dateKey` =
  // its `yyyy-MM-dd` label (availability lookups + the Directions cache key).
  getRoutePlannerBoard: dispatchViewProcedure
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
  getRouteGeometry: dispatchViewProcedure
    .input(
      z.object({
        from: z.date(),
        to: z.date(),
        dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        assigneeWorkerId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { assigneeWorkerId, ...window } = input
      return getRouteGeometryForWorker(ctx.session.organizationId, assigneeWorkerId, window)
    }),
  // Bulk `routeOrder` write (drag-reorder / suggest-route / backlog slot-in follow-up) —
  // admin-gated like the rest of visit machinery (§B).
  setRouteOrder: dispatchAdminProcedure
    .input(
      z.object({
        assigneeWorkerId: z.string(),
        from: z.date(),
        to: z.date(),
        dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        visitIds: z.array(z.string()),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await setRouteOrder({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        assigneeWorkerId: input.assigneeWorkerId,
        window: { from: input.from, to: input.to },
        dateKey: input.dateKey,
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
        assigneeWorkerId: z.string(),
        dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        firstDeparture: z.date(),
        visitIds: z.array(z.string()).min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await applyRouteTimes({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        assigneeWorkerId: input.assigneeWorkerId,
        dateKey: input.dateKey,
        firstDeparture: input.firstDeparture,
        visitIds: input.visitIds,
        excludeSocketId: excludeSocketId(ctx),
      })
      return { success: true }
    }),
  // Plan 20 §4.1a — standalone duration write (visit detail panel). Never touches the schedule.
  setVisitDuration: dispatchAdminProcedure
    .input(
      z.object({
        visitId: z.string(),
        durationMinutes: z
          .number()
          .int()
          .min(1)
          .max(24 * 60)
          .nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await setVisitDuration({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        visitId: input.visitId,
        durationMinutes: input.durationMinutes,
        excludeSocketId: excludeSocketId(ctx),
      })
      return { success: true }
    }),

  // Plan 30 §F.1 — "Add visit": an extra rule-less visit on a work order (e.g. extra one-off
  // work alongside a recurring engagement). With `startTime`/`endTime` (the schedule-picker
  // create flow) the row is created AND scheduled in one call; without, it lands unscheduled.
  // Admin-gated like the rest of visit machinery (§B).
  addVisit: dispatchAdminProcedure
    .input(
      z.object({
        workOrderRecordId: recordIdSchema,
        startTime: z.coerce.date().optional(),
        endTime: z.coerce.date().optional(),
        assigneeWorkerId: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.workOrderRecordId)
      const visit = await addVisit({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        workOrderInstanceId: entityInstanceId,
        startTime: input.startTime,
        endTime: input.endTime,
        assigneeWorkerId: input.assigneeWorkerId,
        excludeSocketId: excludeSocketId(ctx),
      })
      return withWorkOrderStatus(ctx, visit)
    }),

  // Plan 37c §7 — slot-click create's "New job" path: builds a minimal work order from a
  // contact + title + slot times (not a conversion — see `createFromTicket`/`convertToWorkOrder`
  // above for the source-copying flows). Admin-gated like the rest of visit machinery (§B).
  createWorkOrder: dispatchAdminProcedure
    .input(
      z.object({
        contactRecordId: recordIdSchema,
        title: z.string().optional(),
        startTime: z.coerce.date(),
        endTime: z.coerce.date(),
        assigneeWorkerId: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await createWorkOrder({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        contactRecordId: input.contactRecordId,
        title: input.title,
        startTime: input.startTime,
        endTime: input.endTime,
        assigneeWorkerId: input.assigneeWorkerId,
        excludeSocketId: excludeSocketId(ctx),
      })
      const workOrderStatus = await getWorkOrderStatus(
        ctx.session.organizationId,
        ctx.session.user.id,
        result.visit.workOrderId
      )
      return { ...result, workOrderStatus }
    }),

  // Plan 37c §4.4 — copy/paste's one deliberate batch mutation: N new rule-less, scheduled
  // visits in a single round trip (the paste-options dialog's confirm). Thin delegation to
  // `pasteVisits` (a sequential loop over `addVisit`, no transaction — partial success is
  // expected and reported back per item). Admin-gated like the rest of visit machinery (§B).
  pasteVisits: dispatchAdminProcedure
    .input(
      z.object({
        items: z
          .array(
            z.object({
              workOrderRecordId: recordIdSchema,
              startTime: z.coerce.date(),
              endTime: z.coerce.date(),
              assigneeWorkerId: z.string().nullable().optional(),
            })
          )
          .min(1)
          .max(200),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await pasteVisits({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        items: input.items.map((item) => ({
          workOrderInstanceId: parseRecordId(item.workOrderRecordId).entityInstanceId,
          startTime: item.startTime,
          endTime: item.endTime,
          assigneeWorkerId: item.assigneeWorkerId,
        })),
        excludeSocketId: excludeSocketId(ctx),
      })
      return result
    }),

  // §F.3 (M2b job view) — visits for one work order, oldest-scheduled-first.
  listVisits: dispatchViewProcedure
    .input(z.object({ workOrderRecordId: recordIdSchema }))
    .query(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.workOrderRecordId)
      const visits = await listVisitsForWorkOrder(ctx.session.organizationId, entityInstanceId)
      // `[]`, not `visits` — returning the bare rows here made the output type a union of
      // bare|enriched row arrays, which broke `JobVisit` consumers (plan 39 `mergeJobVisits`).
      if (visits.length === 0) return []

      const allocations = await ctx.db
        .select({
          visitId: schema.InvoiceVisitAllocation.visitId,
          invoiceId: schema.InvoiceVisitAllocation.invoiceId,
        })
        .from(schema.InvoiceVisitAllocation)
        .where(
          and(
            eq(schema.InvoiceVisitAllocation.organizationId, ctx.session.organizationId),
            eq(schema.InvoiceVisitAllocation.workOrderId, entityInstanceId),
            eq(schema.InvoiceVisitAllocation.status, 'active'),
            inArray(
              schema.InvoiceVisitAllocation.visitId,
              visits.map((visit) => visit.id)
            )
          )
        )

      const invoiceIds = [...new Set(allocations.map((allocation) => allocation.invoiceId))]
      const statusByInvoiceId = new Map<string, string>()
      if (invoiceIds.length > 0) {
        const fields = await getOrgCache()
          .from(ctx.session.organizationId, 'customFields')
          .bySystemAttributes(['invoice_status'])
        const statusField = fields.invoice_status
        if (statusField) {
          const service = new FieldValueService(
            ctx.session.organizationId,
            ctx.session.user.id,
            ctx.db,
            undefined,
            { capabilities: ctx.capabilities }
          )
          const batch = await service.batchGetValues({
            recordIds: invoiceIds.map((id) => toRecordId('invoice', id)),
            fieldReferences: [`invoice:${statusField.id}` as never],
          })
          for (const row of batch.values) {
            const typed = (Array.isArray(row.value) ? row.value[0] : row.value) as
              | TypedFieldValue
              | undefined
            if (typed)
              statusByInvoiceId.set(
                parseRecordId(row.recordId).entityInstanceId,
                String(extractValue(typed))
              )
          }
        }
      }

      const invoiceIdsByVisit = new Map<string, string[]>()
      for (const allocation of allocations) {
        const ids = invoiceIdsByVisit.get(allocation.visitId) ?? []
        if (!ids.includes(allocation.invoiceId)) ids.push(allocation.invoiceId)
        invoiceIdsByVisit.set(allocation.visitId, ids)
      }
      return visits.map((visit) => {
        const ids = invoiceIdsByVisit.get(visit.id) ?? []
        return {
          ...visit,
          invoiceState:
            ids.length === 0
              ? ('uninvoiced' as const)
              : ids.some((id) => statusByInvoiceId.get(id) === 'draft')
                ? ('drafted' as const)
                : ('invoiced' as const),
          invoiceCount: ids.length,
          invoiceId: ids.length === 1 ? ids[0] : undefined,
        }
      })
    }),

  // 08-worker-surface.md §6 — the worker-scoped path. Member-level (not admin-gated): the
  // row-level assignee guard lives in the lib layer (`loadOwnVisit`), so orgId + userId always
  // come from the session, never input — a worker touches only their own visits.
  myVisits: dispatchMyScheduleProcedure
    .input(z.object({ from: z.date(), to: z.date() }))
    .query(async ({ ctx, input }) => {
      return listMyVisits({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        from: input.from,
        to: input.to,
      })
    }),
  getMyVisit: dispatchMyScheduleProcedure
    .input(z.object({ visitId: z.string() }))
    .query(async ({ ctx, input }) => {
      return getMyVisitDetail({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        visitId: input.visitId,
      })
    }),
  advanceMyVisit: dispatchMyScheduleProcedure
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
  closeMyVisit: dispatchMyScheduleProcedure
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
  // Plan 17 Part A — the dispatcher's read-only view of a worker's captured checklist. Org-scoped
  // (no assignee guard) and NON-materializing: an untouched visit shows an honest empty state.
  listVisitQcItems: dispatchAdminProcedure
    .input(z.object({ visitId: z.string() }))
    .query(async ({ ctx, input }) => {
      return listVisitQcItems(ctx.session.organizationId, input.visitId)
    }),
  // 37d §2 — office (dispatcher) photo capture: org-scoped, NO assignee guard, so any dispatch
  // admin can document a visit's checklist from the proof-of-work panel. Admin-gated to match the
  // `listVisitQcItems` read this panel is built on. Checks/notes stay worker attestations.
  addVisitQcItemPhoto: dispatchAdminProcedure
    .input(z.object({ itemId: z.string(), assetId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return addVisitQcItemPhoto(ctx.session.organizationId, ctx.session.user.id, input)
    }),
  removeVisitQcItemPhoto: dispatchAdminProcedure
    .input(z.object({ itemId: z.string(), attachmentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await removeVisitQcItemPhoto(ctx.session.organizationId, ctx.session.user.id, input)
      return { success: true }
    }),
  setVisitQcItemPhotoCaption: dispatchAdminProcedure
    .input(
      z.object({ itemId: z.string(), attachmentId: z.string(), caption: z.string().nullable() })
    )
    .mutation(async ({ ctx, input }) => {
      await setVisitQcItemPhotoCaption(ctx.session.organizationId, ctx.session.user.id, input)
      return { success: true }
    }),
  // 37d §5 — render the per-visit "Visit report" PDF on demand (visits aren't FieldValue-backed
  // entities, so no pointer cache) and return the short-lived asset id to open via the file proxy.
  getVisitReportPdf: dispatchAdminProcedure
    .input(z.object({ visitId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return renderVisitReportToAsset({
        organizationId: ctx.session.organizationId,
        actorId: ctx.session.user.id,
        visitId: input.visitId,
      })
    }),

  // 08-worker-surface.md §5 — the worker-scoped checklist path. Member-level (not admin-gated):
  // the row-level assignee guard lives in the lib layer (`loadOwnVisit`/`loadOwnQcItem`), so
  // orgId + userId always come from the session, never input.
  listMyVisitQcItems: dispatchVisitReportProcedure
    .input(z.object({ visitId: z.string() }))
    .query(async ({ ctx, input }) => {
      return listMyVisitQcItems(ctx.session.organizationId, ctx.session.user.id, input.visitId)
    }),
  setMyQcItemChecked: dispatchVisitReportProcedure
    .input(z.object({ itemId: z.string(), checked: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      return setMyQcItemChecked(ctx.session.organizationId, ctx.session.user.id, input)
    }),
  setMyQcItemNote: dispatchVisitReportProcedure
    .input(z.object({ itemId: z.string(), note: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      return setMyQcItemNote(ctx.session.organizationId, ctx.session.user.id, input)
    }),
  addMyAdhocQcItem: dispatchVisitReportProcedure
    .input(z.object({ visitId: z.string(), title: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      return addMyAdhocQcItem(ctx.session.organizationId, ctx.session.user.id, input)
    }),
  addMyQcItemPhoto: dispatchVisitReportProcedure
    .input(z.object({ itemId: z.string(), assetId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return addMyQcItemPhoto(ctx.session.organizationId, ctx.session.user.id, input)
    }),
  removeMyQcItemPhoto: dispatchVisitReportProcedure
    .input(z.object({ itemId: z.string(), attachmentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await removeMyQcItemPhoto(ctx.session.organizationId, ctx.session.user.id, input)
      return { success: true }
    }),
  setMyQcItemPhotoCaption: dispatchVisitReportProcedure
    .input(
      z.object({ itemId: z.string(), attachmentId: z.string(), caption: z.string().nullable() })
    )
    .mutation(async ({ ctx, input }) => {
      await setMyQcItemPhotoCaption(ctx.session.organizationId, ctx.session.user.id, input)
      return { success: true }
    }),

  // §5.4 — the M2c recurring engine. Admin-gated like the rest of visit machinery.
  getRecurrence: dispatchViewProcedure
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
  // Plan 36 §A.1 — set, move, or clear the series end date in place (the engagement card's
  // "Ends" control and the terminator row's Extend). `null` clears it (open-ended).
  setSeriesEnd: dispatchAdminProcedure
    .input(
      z.object({
        workOrderRecordId: recordIdSchema,
        until: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { entityInstanceId } = parseRecordId(input.workOrderRecordId)
      return setSeriesEnd({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        workOrderInstanceId: entityInstanceId,
        until: input.until,
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
          assigneeWorkerId: z.string().nullable().optional(),
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
          defaultAssigneeWorkerId:
            input.changes.assigneeWorkerId !== undefined
              ? input.changes.assigneeWorkerId
              : rule.defaultAssigneeWorkerId,
        },
        timezone: rule.timezone,
        effectiveFrom,
        excludeSocketId: excludeSocketId(ctx),
      })
    }),
})
