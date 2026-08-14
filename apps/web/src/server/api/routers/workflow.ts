// apps/web/src/server/api/routers/workflow.ts

import { schema } from '@auxx/database'
import { WorkflowRunStatus } from '@auxx/database/enums'
import { getCachedWorkflowAppCount } from '@auxx/lib/cache'
import { ForbiddenError } from '@auxx/lib/errors'
import { FeatureKey, FeaturePermissionService, PermissionKey } from '@auxx/lib/permissions'
import {
  triggerManualResourceWorkflow,
  triggerManualResourceWorkflowBulk,
} from '@auxx/lib/workflow-engine'
import {
  assertWorkflowAppNotSystemOwned,
  assertWorkflowRunNotSystemOwned,
  buildTemplateWorkflowData,
  type TemplateForCreate,
  type TemplateWorkflowData,
  toWorkflowAppResponse,
  WORKFLOW_TRIGGER_TYPE_VALUES,
  type WorkflowExecutionError,
  WorkflowExecutionService,
  WorkflowService,
  WorkflowStatsService,
  WorkflowVersionService,
} from '@auxx/lib/workflows'
import { readWorkflowTurnLock } from '@auxx/lib/workflows/graph-edit'
import { getWorkflowAppsByTrigger } from '@auxx/services/workflows'
import { type RecordId, recordIdSchema } from '@auxx/types/resource'
import { generateId } from '@auxx/utils/generateId'
import { TRPCError } from '@trpc/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { recordAuditFromCtx } from '~/server/api/audit-context'
import {
  capabilityProcedure,
  createTRPCRouter,
  isAuxxError,
  notDemo,
  permissionProcedure,
} from '~/server/api/trpc'
import { resolveTemplateById } from '~/server/api/workflow-template-resolver'
import {
  armWebhookTestWindow,
  WEBHOOK_TEST_WINDOW_TTL_SECONDS,
} from '~/server/lib/webhook-test-window'
import { mayStopWorkflowRun } from '~/server/lib/workflow-run-stop-access'
import { workflowTemplatesRouter } from './workflow-templates'

// Create TRPC error handler for WorkflowExecutionService
const createTRPCErrorHandler = (error: WorkflowExecutionError): never => {
  throw new TRPCError({
    code:
      error.statusCode === 404
        ? 'NOT_FOUND'
        : error.statusCode === 403
          ? 'FORBIDDEN'
          : error.statusCode === 400
            ? 'BAD_REQUEST'
            : 'INTERNAL_SERVER_ERROR',
    message: error.message,
  })
}

/**
 * Enforce the org's workflow limit before creating a new one.
 * Reads the current count from the org cache (no DB query).
 */
async function assertWorkflowLimitNotReached(organizationId: string): Promise<void> {
  await new FeaturePermissionService().requireLimit(organizationId, FeatureKey.workflowsLimit, () =>
    getCachedWorkflowAppCount(organizationId)
  )
}
// Create workflow schema
const createWorkflowSchema = z.object({
  name: z.string().min(1, 'Workflow name is required'),
  description: z.string().optional(),
  enabled: z.boolean().default(false),
  icon: z
    .object({
      iconId: z.string(),
      color: z.string(),
    })
    .optional(),
  templateId: z.string().optional(), // Optional template ID for creating from template
  /**
   * The caller's chosen trigger. `WorkflowService.create` reads this and falls back to
   * MESSAGE_RECEIVED, but the field was missing from this schema — so zod stripped it and
   * EVERY workflow was created as MESSAGE_RECEIVED regardless of what the caller asked for.
   * When creating from a template, `templateData` is spread after `input` and wins.
   */
  triggerType: z.enum(WORKFLOW_TRIGGER_TYPE_VALUES).optional(),
})
// Update workflow schema
const updateWorkflowSchema = z.object({
  id: z.string(),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  triggerType: z.enum(WORKFLOW_TRIGGER_TYPE_VALUES).nullish(),
  entityDefinitionId: z.string().nullish(), // NEW: replaces triggerConfig
  graph: z
    .object({
      nodes: z.array(z.any()),
      edges: z.array(z.any()),
      viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }).optional(),
    })
    .optional(),
  envVars: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        value: z.any(), // Required, not optional
        type: z.enum(['string', 'number', 'boolean', 'array', 'secret']),
      })
    )
    .optional(),
  variables: z.array(z.any()).optional(),
  /**
   * Optimistic-concurrency token for draft graph saves: the `graphHash` the
   * editor loaded (or got back from its last save). When present, the service
   * compare-and-swaps against the stored draft graph and rejects with 409
   * CONFLICT if another editor saved in between. Absent → unconditional write.
   */
  expectedGraphHash: z.string().optional(),

  // Access settings fields
  webEnabled: z.boolean().optional(),
  apiEnabled: z.boolean().optional(),
  accessMode: z.enum(['public', 'organization']).optional(),
  icon: z
    .object({
      iconId: z.string(),
      color: z.string(),
    })
    .optional(),
  config: z
    .object({
      title: z.string().optional(),
      description: z.string().optional(),
      about: z.string().optional(),
      logoUrl: z.string().url().optional().or(z.literal('')),
      brandName: z.string().optional(),
      hideBranding: z.boolean().optional(),
      showWorkflowPreview: z.boolean().optional(),
      showInputForm: z.boolean().optional(),
      submitButtonText: z.string().optional(),
      successMessage: z.string().optional(),
      maxConcurrentRuns: z.number().optional(),
    })
    .optional(),
  rateLimit: z
    .object({
      enabled: z.boolean(),
      maxRequests: z.number(),
      windowMs: z.number(),
      perUser: z.boolean().optional(),
    })
    .optional(),
})
// Test workflow execution schema
const testWorkflowSchema = z.object({
  workflowId: z.string(),
  testData: z.object({
    message: z.object({
      id: z.string().optional(),
      subject: z.string(),
      textPlain: z.string(),
      from: z.object({ identifier: z.email(), name: z.string() }),
      isInbound: z.boolean().default(true),
    }),
    variables: z.record(z.string(), z.any()).optional(),
  }),
  options: z
    .object({ dryRun: z.boolean().default(true), debug: z.boolean().default(true) })
    .optional(),
})
// Filter schema for listing workflows
const listWorkflowsSchema = z.object({
  enabled: z.boolean().optional(),
  triggerType: z.enum(WORKFLOW_TRIGGER_TYPE_VALUES).optional(),
  search: z.string().optional(),
  limit: z.number().min(1).max(100).default(50),
  offset: z.number().min(0).default(0),
})
// Workflow statistics schema
const workflowStatsSchema = z.object({
  workflowId: z.string(),
  timeRange: z.enum(['1h', '24h', '7d', '30d', '90d']).default('24h'),
})
// Detailed workflow statistics schema
const workflowDetailedStatsSchema = z.object({
  workflowId: z.string(),
  timeRange: z
    .enum([
      'today',
      'last7days',
      'last4weeks',
      'last3months',
      'last12months',
      'monthToDate',
      'quarterToDate',
      'yearToDate',
      'allTime',
      'custom',
    ])
    .default('last7days'),
  customDateRange: z
    .object({
      from: z.date(),
      to: z.date(),
    })
    .optional(),
})
// Processing mode schema
const processingModeSchema = z.object({ mode: z.enum(['RULES_ONLY', 'WORKFLOWS_ONLY', 'HYBRID']) })

/**
 * `workflow.update` fields that are workflow SETTINGS or SHARING rather than
 * authoring, and therefore sit on the Full rung (plan 30 §4: "Settings, Delete"
 * and "Share tokens" are Full, while Save/Publish are Edit).
 *
 * `update` is a single fat mutation fed by three different surfaces — the
 * canvas auto-save (`use-workflow-save.ts`), the settings panel's enable
 * toggle, and the access-settings panel — so the tier can't come from the
 * procedure alone. Presence of ANY of these keys escalates the assert from
 * `assertEditInstance` to `assertAdminInstance`. Everything else (`graph`,
 * `envVars`, `variables`, `triggerType`, `entityDefinitionId`) is authoring.
 */
const ADMIN_ONLY_UPDATE_FIELDS = [
  'name',
  'description',
  'enabled',
  'icon',
  'webEnabled',
  'apiEnabled',
  'accessMode',
  'config',
  'rateLimit',
] as const satisfies readonly (keyof z.infer<typeof updateWorkflowSchema>)[]

/**
 * Per-workflow instance access (plan 30). `workflow` is an
 * `INSTANCE_ACCESS_RESOURCES` key with `baselineAtCreate: false`, so a workflow
 * with no explicit `ResourceAccess` row falls back to the member's `workflows`
 * area level — Read ⇒ `view`, Edit ⇒ `edit`, Full ⇒ `admin`.
 *
 * Tiers (plan 30 §4):
 *  - **view** — see it, open it read-only, read versions/runs/stats, RUN it
 *    manually from a record (`view` means "may run it", user decision
 *    2026-07-27), and STOP a run they started themselves (the corollary — see
 *    {@link mayStopWorkflowRun}; someone else's run, an unowned run, and a
 *    system/headless run all need `edit`).
 *  - **edit** — save, publish, test, run single nodes, stop ANY run on the
 *    workflow, manage versions.
 *  - **admin** — delete, rename/settings, share tokens.
 *  - Creating (`create`, `createForResource`, `duplicate`) has no instance to
 *    key on, so it gates on the coarse `workflowsManage` rung.
 *
 * Base procedure: `permissionProcedure(workflowsView)` everywhere the instance
 * assert does the real work. That keeps the `FeatureKey.workflows` plan-AND
 * these procedures have always run (`capabilityProcedure` does NOT run it) and
 * costs nothing — a member composing `workflows: None` who holds one explicit
 * instance grant genuinely HOLDS `workflowsView`, because the composer derives
 * that Read rung from their grants (handoff item 5b, replacing plan 25 §2's
 * front-door waiver). **Every procedure on this base MUST assert on a specific
 * instance**, and must NOT return org-wide data: the derived key says only "this
 * member has some workflow access", never which workflow.
 * `create`/`createForResource` have no instance to assert on and therefore sit
 * on `workflowsManage`, which is never derived. `list` and `getManualWorkflows` are
 * the two exceptions in the other direction: they render passively inside other
 * screens, so they use `capabilityProcedure` and FILTER rather than assert (plan
 * 30 §2.2 — a 403 there is a broken screen, not a denied action).
 *
 * NOT gated by any of this (plan 30 §2.1): **headless execution**. Schedules,
 * record-CRUD events, record rules, message-received, app triggers, webhook
 * endpoints, polling, and resume/approval jobs all run as the system through
 * `@auxx/lib/workflow-engine` and read no member capabilities — a workflow
 * restricted to `none` for every member STILL FIRES. Only user-initiated runs
 * (this router + the SSE test-run REST route) consult instance access.
 *
 * `WorkflowApp.isPublic` is a DIFFERENT axis and deliberately untouched:
 * it exposes a workflow to ANONYMOUS callers via `apps/api`'s unauthenticated
 * `/api/v1/workflows/public/:id` + the share-token pages, where there is no
 * member and no `CapabilitySet` to consult. So (a) `isPublic: true` grants a
 * restricted member NOTHING here — they still can't open, edit, or list it; and
 * (b) restricting a workflow to `none` does NOT close its public URL. Closing
 * that is what `isPublic` / `webEnabled` / `apiEnabled` / `revokeShareToken`
 * are for — all of which are Full-rung, so only an instance admin can flip them.
 */
export const workflowRouter = createTRPCRouter({
  /**
   * Get all workflow apps for the organization
   */
  list: capabilityProcedure.input(listWorkflowsSchema).query(async ({ ctx, input }) => {
    // No coarse assert — narrow to the workflows the member may view
    // (`kb.list` / `dataset.list` precedent). A `workflows: None` member gets an
    // empty list rather than a 403, which matters because this feeds the
    // permission grids' Workflows row (`use-instance-resource-lists.ts`) and the
    // workflows landing page.
    //
    // The filter is computed UP FRONT and handed to the query, so `limit`,
    // `offset`, `total` and `hasMore` all describe the FILTERED set. Filtering
    // the returned page instead (what this did originally) leaves
    // `total`/`hasMore` describing the unfiltered page, returns short pages, and
    // can hand back an EMPTY page with `hasMore: true` — which breaks any client
    // that stops on an empty page.
    //
    // Two shapes, because `instanceListScope` is the list-side twin of
    // `canViewInstance` and that gate now has two regimes (plan 25 §2):
    //  - open `workflows` area → `exclude`, near-empty in practice (`workflow` is
    //    `baselineAtCreate: false`, so the ONLY exclusions are explicitly
    //    restricted workflows — plan 30 §3, restriction is the rare case);
    //  - `workflows: None` + explicit grants → `include`, naming exactly the
    //    workflows shared with this member. Returning an empty list here instead
    //    would contradict `getById`, which lets them open it.
    const scope = ctx.capabilities.instanceListScope('workflow')
    if (scope.kind === 'none') return { workflows: [], total: 0, hasMore: false }

    const workflowService = new WorkflowService(ctx.db)
    try {
      return await workflowService.getAll(ctx.session.organizationId, {
        ...input,
        excludeIds: scope.excludeIds,
        includeIds: scope.includeIds,
      })
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch workflow apps',
      })
    }
  }),
  /**
   * Get a specific workflow app by ID
   */
  getById: permissionProcedure(PermissionKey.workflowsView)
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      // Read — opening a workflow (read-only at `view`, editable at `edit`).
      ctx.capabilities.assertViewInstance('workflow', input.id)
      await assertWorkflowAppNotSystemOwned(ctx.db, {
        workflowAppId: input.id,
        organizationId: ctx.session.organizationId,
        isSuperAdmin: ctx.session.isSuperAdmin,
        allowSuperAdminRead: true,
      })
      const workflowService = new WorkflowService(ctx.db)
      try {
        const workflowApp = await workflowService.getById(input.id, ctx.session.organizationId)
        return toWorkflowAppResponse(workflowApp)
      } catch (error) {
        if (error instanceof Error && error.message === 'Workflow not found') {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Workflow not found' })
        }
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch workflow' })
      }
    }),
  /**
   * Whether a Kopilot turn currently holds this workflow's draft.
   *
   * The builder's canvas edit lock is driven by the `workflow:kopilot-turn`
   * realtime event; this is the RE-DERIVE path for the cases where a local flag
   * cannot be trusted — first mount, and socket reconnect (a release published
   * while the client was disconnected is simply never delivered, which would
   * otherwise leave the canvas read-only until reload).
   *
   * `view` rung, not `edit`: a viewer who cannot edit still renders the canvas
   * and still needs to know the agent is working, and this leaks nothing beyond
   * "a turn is open" on a workflow the caller can already read.
   */
  kopilotTurnStatus: permissionProcedure(PermissionKey.workflowsView)
    .input(z.object({ workflowAppId: z.string() }))
    .query(async ({ ctx, input }) => {
      ctx.capabilities.assertViewInstance('workflow', input.workflowAppId)
      const lock = await readWorkflowTurnLock(input.workflowAppId)
      return { active: lock !== null, turnId: lock?.turnId ?? null }
    }),
  /**
   * Create a new workflow app with initial workflow version
   * Optionally from a template
   */
  create: permissionProcedure(PermissionKey.workflowsManage)
    .input(createWorkflowSchema)
    .mutation(async ({ ctx, input }) => {
      // Full — no instance exists yet to key on, so the coarse rung is the gate.
      await assertWorkflowLimitNotReached(ctx.session.organizationId)

      // Build template data (graph, trigger, resolved app/entity refs) when creating
      // from a template. Resolution stays here since it merges file + admin sources.
      let templateData: TemplateWorkflowData | undefined
      if (input.templateId) {
        const template = await resolveTemplateById(input.templateId)
        if (!template) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found' })
        }
        templateData = await buildTemplateWorkflowData(
          ctx.session.organizationId,
          ctx.session.userId,
          template as TemplateForCreate,
          !!input.icon
        )
      }

      const created = await new WorkflowService(ctx.db).create(
        ctx.session.organizationId,
        ctx.session.userId,
        { ...input, ...templateData }
      )
      await recordAuditFromCtx(ctx, {
        category: 'apps',
        action: 'workflow.created',
        targetType: 'WorkflowApp',
        targetId: (created as { id?: string } | null)?.id ?? null,
        metadata: { name: input.name, templateId: input.templateId ?? null },
      })
      return created
    }),

  /**
   * Create a manual-trigger workflow pre-wired to a resource.
   *
   * Seeds the graph with a single resource-trigger node (operation: 'manual')
   * bound to the given entity definition, so the new workflow already targets
   * the right resource and shows up in the "Run Workflow" dialog once the user
   * builds it out and publishes it. Returns the created workflow app.
   */
  createForResource: permissionProcedure(PermissionKey.workflowsManage)
    .input(z.object({ entityDefinitionId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      // Full — creating, same as `create`.
      await assertWorkflowLimitNotReached(ctx.session.organizationId)

      const created = await new WorkflowService(ctx.db).createForResource(
        ctx.session.organizationId,
        ctx.session.userId,
        input.entityDefinitionId
      )
      await recordAuditFromCtx(ctx, {
        category: 'apps',
        action: 'workflow.created',
        targetType: 'WorkflowApp',
        targetId: (created as { id?: string } | null)?.id ?? null,
        metadata: { entityDefinitionId: input.entityDefinitionId },
      })
      return created
    }),
  /**
   * Update an existing workflow app (updates active workflow)
   */
  update: permissionProcedure(PermissionKey.workflowsView)
    .input(updateWorkflowSchema)
    .mutation(async ({ ctx, input }) => {
      // Write — saving the draft graph / env vars. ESCALATES to Full when the
      // payload also carries settings or sharing fields (see
      // `ADMIN_ONLY_UPDATE_FIELDS`): rename, enable/disable, icon, and the
      // web/API share configuration are all Full-rung actions.
      ctx.capabilities.assertEditInstance('workflow', input.id)
      if (ADMIN_ONLY_UPDATE_FIELDS.some((field) => input[field] !== undefined)) {
        ctx.capabilities.assertAdminInstance('workflow', input.id)
      }
      await assertWorkflowAppNotSystemOwned(ctx.db, {
        workflowAppId: input.id,
        organizationId: ctx.session.organizationId,
        isSuperAdmin: ctx.session.isSuperAdmin,
      })

      // Block demo users from enabling workflows
      if (input.enabled) {
        const { DemoGuard } = await import('@auxx/lib/demo')
        await DemoGuard.requireNotDemo(
          ctx.session.organizationId,
          'enable workflows',
          ctx.session.isSuperAdmin
        )
      }

      const workflowService = new WorkflowService(ctx.db)

      try {
        return await workflowService.update(ctx.session.organizationId, input)
      } catch (error) {
        // Let AuxxErrors (e.g. the draft-save ConflictError → 409) reach
        // `auxxErrorMiddleware` instead of flattening them into a generic 500.
        if (isAuxxError(error)) throw error
        if (error instanceof Error && error.message === 'Workflow not found') {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Workflow not found' })
        }
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update workflow' })
      }
    }),
  /**
   * Delete a workflow app (deletes all versions)
   */
  delete: permissionProcedure(PermissionKey.workflowsView)
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Full — destroying the workflow and every version (KB/dataset/dashboard
      // delete precedent).
      ctx.capabilities.assertAdminInstance('workflow', input.id)
      await assertWorkflowAppNotSystemOwned(ctx.db, {
        workflowAppId: input.id,
        organizationId: ctx.session.organizationId,
        isSuperAdmin: ctx.session.isSuperAdmin,
      })
      const workflowService = new WorkflowService(ctx.db)
      try {
        const result = await workflowService.delete(input.id, ctx.session.organizationId)
        await recordAuditFromCtx(ctx, {
          category: 'apps',
          action: 'workflow.deleted',
          targetType: 'WorkflowApp',
          targetId: input.id,
        })
        return result
      } catch (error) {
        if (error instanceof Error && error.message === 'Workflow not found') {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Workflow not found' })
        }
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to delete workflow' })
      }
    }),
  /**
   * Duplicate a workflow app with its draft workflow
   * Creates a new WorkflowApp and copies the draft workflow data
   */
  duplicate: permissionProcedure(PermissionKey.workflowsManage)
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1, 'Name is required'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Read on the source + the coarse Full rung to create the copy (plan 30
      // §8 open item 3, dashboards precedent: a `view` holder could rebuild it
      // by hand anyway, so `admin` on the source isn't the bar).
      ctx.capabilities.assertViewInstance('workflow', input.id)
      await assertWorkflowAppNotSystemOwned(ctx.db, {
        workflowAppId: input.id,
        organizationId: ctx.session.organizationId,
        isSuperAdmin: ctx.session.isSuperAdmin,
      })
      const workflowService = new WorkflowService(ctx.db)
      try {
        return await workflowService.duplicate(
          input.id,
          input.name,
          ctx.session.organizationId,
          ctx.session.userId
        )
      } catch (error) {
        if (error instanceof Error && error.message === 'Workflow not found') {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Workflow not found' })
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to duplicate workflow',
        })
      }
    }),
  /**
   * Test workflow execution
   */
  test: permissionProcedure(PermissionKey.workflowsView)
    .input(testWorkflowSchema)
    .mutation(async ({ ctx, input }) => {
      // Write — test-running is an authoring action (plan 30 §4), and the SSE
      // sibling `/api/workflows/[workflowId]/run` gates identically.
      ctx.capabilities.assertEditInstance('workflow', input.workflowId)
      await assertWorkflowAppNotSystemOwned(ctx.db, {
        workflowAppId: input.workflowId,
        organizationId: ctx.session.organizationId,
        isSuperAdmin: ctx.session.isSuperAdmin,
        allowSuperAdminRead: true,
      })
      const workflowService = new WorkflowService(ctx.db)
      try {
        return await workflowService.test(input.workflowId, ctx.session.organizationId, input)
      } catch (error) {
        if (error instanceof Error && error.message === 'Workflow not found') {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Workflow not found' })
        }
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to test workflow' })
      }
    }),
  /**
   * Open a TTL'd listening window so `POST /api/workflows/<id>/webhook?test=true`
   * will resolve the DRAFT graph — answering from the draft webhook node's
   * configured response and appending the request to the author's captured-event
   * log.
   *
   * That route is anonymous by design (external callers have no session), so
   * without a window anyone holding a workflow id could read an org's
   * unpublished response config out of it and inject arbitrary headers, query and
   * body into the log the editor renders. Arming is the authenticated half of
   * the pair.
   */
  armWebhookTest: permissionProcedure(PermissionKey.workflowsView)
    .input(z.object({ workflowId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Write — arming delegates draft execution to an unauthenticated caller
      // for the next TTL, so it carries the same authority as running the draft
      // yourself: instance `edit`, matching `workflow.test` and the SSE
      // `/api/workflows/[workflowId]/run` route.
      ctx.capabilities.assertEditInstance('workflow', input.workflowId)
      // Instance access alone does NOT prove the workflow is ours: `workflow` is
      // `baselineAtCreate: false`, so a row-less (i.e. foreign) id falls back to
      // the caller's AREA level and would sail through. Pin it to the org.
      const [workflowApp] = await ctx.db
        .select({ id: schema.WorkflowApp.id })
        .from(schema.WorkflowApp)
        .where(
          and(
            eq(schema.WorkflowApp.id, input.workflowId),
            eq(schema.WorkflowApp.organizationId, ctx.session.organizationId)
          )
        )
        .limit(1)
      if (!workflowApp) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Workflow not found' })
      }
      await assertWorkflowAppNotSystemOwned(ctx.db, {
        workflowAppId: input.workflowId,
        organizationId: ctx.session.organizationId,
        isSuperAdmin: ctx.session.isSuperAdmin,
      })
      await armWebhookTestWindow(input.workflowId)
      return { expiresInSeconds: WEBHOOK_TEST_WINDOW_TTL_SECONDS }
    }),
  /**
   * Get workflow execution statistics
   */
  getStats: permissionProcedure(PermissionKey.workflowsView)
    .input(workflowStatsSchema)
    .query(async ({ ctx, input }) => {
      // Read — observability on a workflow you can already see and run.
      ctx.capabilities.assertViewInstance('workflow', input.workflowId)
      await assertWorkflowAppNotSystemOwned(ctx.db, {
        workflowAppId: input.workflowId,
        organizationId: ctx.session.organizationId,
        isSuperAdmin: ctx.session.isSuperAdmin,
        allowSuperAdminRead: true,
      })
      const statsService = new WorkflowStatsService(ctx.db)
      try {
        return await statsService.getStats(
          input.workflowId,
          ctx.session.organizationId,
          input.timeRange
        )
      } catch (error) {
        if (error instanceof Error && error.message === 'Workflow not found') {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Workflow not found' })
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch workflow statistics',
        })
      }
    }),
  /**
   * Get detailed workflow execution statistics with time-series data
   */
  getDetailedStats: permissionProcedure(PermissionKey.workflowsView)
    .input(workflowDetailedStatsSchema)
    .query(async ({ ctx, input }) => {
      // Read — same as `getStats`.
      ctx.capabilities.assertViewInstance('workflow', input.workflowId)
      await assertWorkflowAppNotSystemOwned(ctx.db, {
        workflowAppId: input.workflowId,
        organizationId: ctx.session.organizationId,
        isSuperAdmin: ctx.session.isSuperAdmin,
        allowSuperAdminRead: true,
      })
      const statsService = new WorkflowStatsService(ctx.db)
      try {
        return await statsService.getDetailedStats(
          input.workflowId,
          ctx.session.organizationId,
          input.timeRange,
          input.customDateRange
        )
      } catch (error) {
        if (error instanceof Error && error.message === 'Published workflow not found') {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Published workflow not found' })
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch detailed workflow statistics',
        })
      }
    }),

  /**
   * Publish a new version of a workflow
   */
  publish: permissionProcedure(PermissionKey.workflowsView)
    .input(z.object({ workflowId: z.string(), versionTitle: z.string().optional() }))
    .use(notDemo('publish workflows'))
    .mutation(async ({ ctx, input }) => {
      // Write — publishing the draft into a new version (plan 30 §4).
      ctx.capabilities.assertEditInstance('workflow', input.workflowId)
      await assertWorkflowAppNotSystemOwned(ctx.db, {
        workflowAppId: input.workflowId,
        organizationId: ctx.session.organizationId,
        isSuperAdmin: ctx.session.isSuperAdmin,
      })
      // The version service validates the draft and throws domain errors
      // (NotFoundError / BadRequestError) that the tRPC layer maps to codes.
      const published = await new WorkflowVersionService(ctx.db).publish(
        input.workflowId,
        ctx.session.organizationId,
        input.versionTitle
      )
      await recordAuditFromCtx(ctx, {
        category: 'apps',
        action: 'workflow.published',
        targetType: 'WorkflowApp',
        targetId: input.workflowId,
        metadata: { versionTitle: input.versionTitle ?? null },
      })
      return published
    }),
  /**
   * Get all versions of a workflow
   */
  getVersions: permissionProcedure(PermissionKey.workflowsView)
    .input(z.object({ workflowId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Read — the versions list is visible at `view`; restore/delete/rename
      // are the Edit-tier half (plan 30 §7).
      ctx.capabilities.assertViewInstance('workflow', input.workflowId)
      await assertWorkflowAppNotSystemOwned(ctx.db, {
        workflowAppId: input.workflowId,
        organizationId: ctx.session.organizationId,
        isSuperAdmin: ctx.session.isSuperAdmin,
        allowSuperAdminRead: true,
      })
      const versionService = new WorkflowVersionService(ctx.db)
      try {
        return await versionService.getVersions(input.workflowId, ctx.session.organizationId)
      } catch (error) {
        if (error instanceof Error && error.message === 'Workflow not found') {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Workflow not found' })
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to get workflow versions',
        })
      }
    }),
  /**
   * Get a specific workflow version
   */
  getVersionById: permissionProcedure(PermissionKey.workflowsView)
    .input(z.object({ workflowId: z.string(), versionId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Read — one version's snapshot.
      ctx.capabilities.assertViewInstance('workflow', input.workflowId)
      await assertWorkflowAppNotSystemOwned(ctx.db, {
        workflowAppId: input.workflowId,
        organizationId: ctx.session.organizationId,
        isSuperAdmin: ctx.session.isSuperAdmin,
        allowSuperAdminRead: true,
      })
      const versionService = new WorkflowVersionService(ctx.db)
      try {
        return await versionService.getVersionById(
          input.workflowId,
          input.versionId,
          ctx.session.organizationId
        )
      } catch (error) {
        if (error instanceof Error && error.message === 'Workflow version not found') {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Workflow version not found' })
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to get workflow version',
        })
      }
    }),
  /**
   * Delete a specific workflow version
   */
  deleteVersion: permissionProcedure(PermissionKey.workflowsView)
    .input(z.object({ workflowId: z.string(), versionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Write — version management is Edit, not Full (plan 30 §4). It destroys a
      // snapshot, never the workflow: the active version is refused downstream.
      ctx.capabilities.assertEditInstance('workflow', input.workflowId)
      await assertWorkflowAppNotSystemOwned(ctx.db, {
        workflowAppId: input.workflowId,
        organizationId: ctx.session.organizationId,
        isSuperAdmin: ctx.session.isSuperAdmin,
      })
      const versionService = new WorkflowVersionService(ctx.db)
      try {
        return await versionService.deleteVersion(
          input.workflowId,
          input.versionId,
          ctx.session.organizationId
        )
      } catch (error) {
        if (error instanceof Error) {
          if (error.message === 'Workflow version not found') {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Workflow version not found' })
          }
          if (error.message === 'Cannot delete the active workflow version') {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Cannot delete the active workflow version',
            })
          }
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to delete workflow version',
        })
      }
    }),
  /**
   * Rename a specific workflow version
   */
  renameVersion: permissionProcedure(PermissionKey.workflowsView)
    .input(
      z.object({
        workflowId: z.string(),
        versionId: z.string(),
        title: z.string().min(1, 'Title is required'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Write — labelling a version, not renaming the workflow (that's `update`
      // with `name`, which escalates to Full).
      ctx.capabilities.assertEditInstance('workflow', input.workflowId)
      await assertWorkflowAppNotSystemOwned(ctx.db, {
        workflowAppId: input.workflowId,
        organizationId: ctx.session.organizationId,
        isSuperAdmin: ctx.session.isSuperAdmin,
      })
      const versionService = new WorkflowVersionService(ctx.db)
      try {
        return await versionService.renameVersion(
          input.workflowId,
          input.versionId,
          input.title,
          ctx.session.organizationId
        )
      } catch (error) {
        if (error instanceof Error && error.message === 'Workflow version not found') {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Workflow version not found' })
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to rename workflow version',
        })
      }
    }),
  /**
   * Stop a workflow run
   */
  stopWorkflowRun: permissionProcedure(PermissionKey.workflowsView)
    .input(z.object({ runId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Run control, keyed on the run's PARENT app — the input names a RUN, so
      // the guard hands the app id back for instance access to key on.
      const workflowAppId = await assertWorkflowRunNotSystemOwned(ctx.db, {
        runId: input.runId,
        organizationId: ctx.session.organizationId,
        isSuperAdmin: ctx.session.isSuperAdmin,
      })
      if (!workflowAppId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Workflow run not found' })
      }
      // Instance `edit` stops ANY run; instance `view` stops only a run the
      // caller started themselves — the corollary of "`view` means you may RUN
      // it" (plan 30 §2). Unowned and system-started runs need `edit`; see
      // {@link mayStopWorkflowRun}.
      const mayStop = await mayStopWorkflowRun({
        db: ctx.db,
        capabilities: ctx.capabilities,
        runId: input.runId,
        workflowAppId,
        organizationId: ctx.session.organizationId,
        userId: ctx.session.userId,
      })
      if (!mayStop) {
        throw new ForbiddenError("You don't have permission to stop this run.")
      }
      const executionService = new WorkflowExecutionService(ctx.db, {
        errorHandler: createTRPCErrorHandler,
      })
      try {
        return await executionService.stopWorkflowRun({
          runId: input.runId,
          userId: ctx.session.userId,
          organizationId: ctx.session.organizationId,
        })
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to stop workflow run',
        })
      }
    }),
  /**
   * Run a single node
   */
  runSingleNode: permissionProcedure(PermissionKey.workflowsView)
    .input(
      z.object({
        workflowAppId: z.string(),
        workflowId: z.string(),
        nodeId: z.string(),
        inputs: z.array(
          z.object({
            variableId: z.string(),
            value: z.any(), // Required, not optional
            nodeId: z.string().optional(),
            type: z.string().optional(),
            lastUpdated: z.number().optional(),
          })
        ),
      })
    )
    .use(notDemo('run workflow nodes'))
    .mutation(async ({ ctx, input }) => {
      // Write — running a single node is a builder/debug action (plan 30 §4).
      ctx.capabilities.assertEditInstance('workflow', input.workflowAppId)
      await assertWorkflowAppNotSystemOwned(ctx.db, {
        workflowAppId: input.workflowAppId,
        organizationId: ctx.session.organizationId,
        isSuperAdmin: ctx.session.isSuperAdmin,
      })
      const executionService = new WorkflowExecutionService(ctx.db, {
        errorHandler: createTRPCErrorHandler,
      })
      try {
        return await executionService.runSingleNode({
          ...input,
          userId: ctx.session.userId,
          organizationId: ctx.session.organizationId,
          userEmail: ctx.session.user.email ?? undefined,
          userName: ctx.session.user.name ?? undefined,
        })
      } catch (error) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to run node' })
      }
    }),
  /**
   * Get workflow run details
   */
  getWorkflowRun: permissionProcedure(PermissionKey.workflowsView)
    .input(z.object({ runId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Read — run detail. Keyed on the run's parent app (see `stopWorkflowRun`).
      const workflowAppId = await assertWorkflowRunNotSystemOwned(ctx.db, {
        runId: input.runId,
        organizationId: ctx.session.organizationId,
        isSuperAdmin: ctx.session.isSuperAdmin,
        allowSuperAdminRead: true,
      })
      if (!workflowAppId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Workflow run not found' })
      }
      ctx.capabilities.assertViewInstance('workflow', workflowAppId)
      const executionService = new WorkflowExecutionService(ctx.db, {
        errorHandler: createTRPCErrorHandler,
      })
      try {
        return await executionService.getWorkflowRun(input.runId, ctx.session.organizationId)
      } catch (error) {
        if (error instanceof Error && error.message === 'Workflow run not found') {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Workflow run not found' })
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to get workflow run',
        })
      }
    }),
  /**
   * List workflow runs
   */
  listWorkflowRuns: permissionProcedure(PermissionKey.workflowsView)
    .input(
      z.object({
        workflowAppId: z.string(),
        limit: z.number().min(1).max(100).default(20),
        cursor: z.string().optional(),
        status: z.enum(WorkflowRunStatus).optional(),
        startDate: z.date().optional(),
        endDate: z.date().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      // Read — run history for a workflow you can see.
      ctx.capabilities.assertViewInstance('workflow', input.workflowAppId)
      await assertWorkflowAppNotSystemOwned(ctx.db, {
        workflowAppId: input.workflowAppId,
        organizationId: ctx.session.organizationId,
        isSuperAdmin: ctx.session.isSuperAdmin,
        allowSuperAdminRead: true,
      })
      const executionService = new WorkflowExecutionService(ctx.db, {
        errorHandler: createTRPCErrorHandler,
      })
      try {
        return await executionService.listWorkflowRuns(
          input.workflowAppId,
          ctx.session.organizationId,
          {
            limit: input.limit,
            cursor: input.cursor,
            status: input.status,
            startDate: input.startDate,
            endDate: input.endDate,
          }
        )
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to list workflow runs',
        })
      }
    }),

  /**
   * Get available manual workflows for an entity
   * Used to populate the workflow selection dropdown
   */
  getManualWorkflows: capabilityProcedure
    .input(
      z.object({
        entityDefinitionId: z.string().min(1),
      })
    )
    .query(async ({ ctx, input }) => {
      const result = await getWorkflowAppsByTrigger({
        triggerType: 'manual',
        entityDefinitionId: input.entityDefinitionId,
        organizationId: ctx.session.organizationId,
      })

      if (result.isErr()) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: result.error.message,
        })
      }

      const apps: { workflowApp: { id: string; name: string; description: string | null } }[] =
        result.value

      // FILTER, never assert (plan 30 §2.2). This dropdown renders inside other
      // features' record UI, so a 403 would be a broken screen rather than a
      // denied action — a member without `view` on a workflow simply doesn't see
      // it offered. `triggerManualResource(Bulk)` asserts for real.
      return apps
        .filter((item) => ctx.capabilities.canViewInstance('workflow', item.workflowApp.id))
        .map((item) => ({
          id: item.workflowApp.id,
          name: item.workflowApp.name,
          description: item.workflowApp.description,
        }))
    }),

  /**
   * Manually trigger a specific workflow for a resource
   *
   * UX: User selects a workflow from dropdown, then triggers it
   * Permissions: instance `view` on the workflow — "`view` means you may RUN
   * it" (plan 30 §2, user decision 2026-07-27). Note the consequence for seats:
   * `workflows` is not in `WORKER_AREAS`, so a field-tech seat composes
   * `workflows: None` and therefore CANNOT trigger a manual workflow from a
   * record. Deliberate (plan 30 §8 item 1).
   */
  triggerManualResource: permissionProcedure(PermissionKey.workflowsView)
    .input(
      z.object({
        workflowAppId: z.string(),
        recordId: recordIdSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Read — user-initiated run. Headless triggers for this same workflow
      // (schedules, record events, rules, webhooks) bypass all of this and keep
      // firing (plan 30 §2.1).
      ctx.capabilities.assertViewInstance('workflow', input.workflowAppId)
      const result = await triggerManualResourceWorkflow({
        workflowAppId: input.workflowAppId,
        recordId: input.recordId as RecordId,
        organizationId: ctx.session.organizationId,
        createdBy: ctx.session.userId,
      })

      if (result.isErr()) {
        // Map service errors to tRPC errors
        const error = result.error

        if (error.code === 'WORKFLOW_APP_NOT_FOUND' || error.code === 'RESOURCE_NOT_FOUND') {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: error.message,
          })
        }

        // No `WORKFLOW_NOT_ENABLED` arm here: only the BULK variant emits that
        // code. Testing for it on the single-record path was dead (TS2367) and
        // read as coverage this branch never had. The bulk mutation below keeps
        // its arm, where the code is real.
        if (error.code === 'WORKFLOW_TYPE_MISMATCH' || error.code === 'WORKFLOW_NOT_PUBLISHED') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: error.message,
          })
        }

        // Generic error
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'Failed to trigger workflow',
        })
      }

      return result.value
    }),

  /**
   * Manually trigger a specific workflow for multiple resources (bulk operation)
   *
   * UX: User selects multiple contacts/tickets, selects workflow from dropdown
   * Strategy: Best-effort execution with detailed results
   * Permissions: instance `view` on the workflow, same as
   * {@link triggerManualResource}.
   */
  triggerManualResourceBulk: permissionProcedure(PermissionKey.workflowsView)
    .input(
      z.object({
        workflowAppId: z.string(),
        recordIds: z.array(recordIdSchema).min(1).max(100), // Limit to 100 resources
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Read — asserted ONCE: the workflow is single, only the records are
      // plural (plan 30 §2.2). Per-record read authority is the record layer's
      // job, not this one's.
      ctx.capabilities.assertViewInstance('workflow', input.workflowAppId)
      const result = await triggerManualResourceWorkflowBulk({
        workflowAppId: input.workflowAppId,
        recordIds: input.recordIds as RecordId[],
        organizationId: ctx.session.organizationId,
        createdBy: ctx.session.userId,
      })

      if (result.isErr()) {
        const error = result.error

        if (error.code === 'WORKFLOW_APP_NOT_FOUND') {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: error.message,
          })
        }

        if (
          error.code === 'WORKFLOW_NOT_ENABLED' ||
          error.code === 'WORKFLOW_TYPE_MISMATCH' ||
          error.code === 'WORKFLOW_NOT_PUBLISHED'
        ) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: error.message,
          })
        }

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'Failed to trigger workflows',
        })
      }

      return result.value
    }),

  /**
   * Generate a new share token for a workflow
   */
  generateShareToken: permissionProcedure(PermissionKey.workflowsView)
    .input(z.object({ id: z.string() }))
    .use(notDemo('share workflows'))
    .mutation(async ({ ctx, input }) => {
      const { id } = input

      // Full — minting a share token opens an ANONYMOUS surface (plan 30 §4).
      // This is the `isPublic`/`webEnabled` axis, not member instance access, so
      // it must sit at the top rung.
      ctx.capabilities.assertAdminInstance('workflow', id)
      await assertWorkflowAppNotSystemOwned(ctx.db, {
        workflowAppId: id,
        organizationId: ctx.session.organizationId,
        isSuperAdmin: ctx.session.isSuperAdmin,
      })

      // Verify ownership
      const workflow = await ctx.db.query.WorkflowApp.findFirst({
        where: and(
          eq(schema.WorkflowApp.id, id),
          eq(schema.WorkflowApp.organizationId, ctx.session.organizationId)
        ),
      })

      if (!workflow) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Workflow not found' })
      }

      // Generate new token
      const shareToken = generateId('share')

      const [updated] = await ctx.db
        .update(schema.WorkflowApp)
        .set({ shareToken, updatedAt: new Date() })
        .where(eq(schema.WorkflowApp.id, id))
        .returning()

      await recordAuditFromCtx(ctx, {
        category: 'apps',
        action: 'workflow.share_token_generated',
        targetType: 'WorkflowApp',
        targetId: id,
      })

      return updated
    }),

  /**
   * Revoke share token (disable sharing)
   */
  revokeShareToken: permissionProcedure(PermissionKey.workflowsView)
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { id } = input

      // Full — closing the anonymous surface, symmetric with generate.
      ctx.capabilities.assertAdminInstance('workflow', id)
      await assertWorkflowAppNotSystemOwned(ctx.db, {
        workflowAppId: id,
        organizationId: ctx.session.organizationId,
        isSuperAdmin: ctx.session.isSuperAdmin,
      })

      // Verify ownership
      const workflow = await ctx.db.query.WorkflowApp.findFirst({
        where: and(
          eq(schema.WorkflowApp.id, id),
          eq(schema.WorkflowApp.organizationId, ctx.session.organizationId)
        ),
      })

      if (!workflow) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Workflow not found' })
      }

      // Remove token and disable sharing
      const [updated] = await ctx.db
        .update(schema.WorkflowApp)
        .set({
          shareToken: null,
          webEnabled: false,
          apiEnabled: false,
          updatedAt: new Date(),
        })
        .where(eq(schema.WorkflowApp.id, id))
        .returning()

      await recordAuditFromCtx(ctx, {
        category: 'apps',
        action: 'workflow.share_token_revoked',
        targetType: 'WorkflowApp',
        targetId: id,
      })

      return updated
    }),

  /**
   * Workflow templates sub-router
   */
  templates: workflowTemplatesRouter,
})
