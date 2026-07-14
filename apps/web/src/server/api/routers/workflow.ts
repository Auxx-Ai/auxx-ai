// apps/web/src/server/api/routers/workflow.ts

import { schema } from '@auxx/database'
import { WorkflowRunStatus } from '@auxx/database/enums'
import { getCachedWorkflowAppCount } from '@auxx/lib/cache'
import { FeatureKey, FeaturePermissionService } from '@auxx/lib/permissions'
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
import { getWorkflowAppsByTrigger } from '@auxx/services/workflows'
import { type RecordId, recordIdSchema } from '@auxx/types/resource'
import { generateId } from '@auxx/utils/generateId'
import { TRPCError } from '@trpc/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { recordAuditFromCtx } from '~/server/api/audit-context'
import { createTRPCRouter, notDemo, protectedProcedure } from '~/server/api/trpc'
import { resolveTemplateById } from '~/server/api/workflow-template-resolver'
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
export const workflowRouter = createTRPCRouter({
  /**
   * Get all workflow apps for the organization
   */
  list: protectedProcedure.input(listWorkflowsSchema).query(async ({ ctx, input }) => {
    const workflowService = new WorkflowService(ctx.db)
    try {
      return await workflowService.getAll(ctx.session.organizationId, input)
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
  getById: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
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
   * Create a new workflow app with initial workflow version
   * Optionally from a template
   */
  create: protectedProcedure.input(createWorkflowSchema).mutation(async ({ ctx, input }) => {
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
  createForResource: protectedProcedure
    .input(z.object({ entityDefinitionId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
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
  update: protectedProcedure.input(updateWorkflowSchema).mutation(async ({ ctx, input }) => {
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
      if (error instanceof Error && error.message === 'Workflow not found') {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Workflow not found' })
      }
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update workflow' })
    }
  }),
  /**
   * Delete a workflow app (deletes all versions)
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
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
  duplicate: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1, 'Name is required'),
      })
    )
    .mutation(async ({ ctx, input }) => {
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
  test: protectedProcedure.input(testWorkflowSchema).mutation(async ({ ctx, input }) => {
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
   * Get workflow execution statistics
   */
  getStats: protectedProcedure.input(workflowStatsSchema).query(async ({ ctx, input }) => {
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
  getDetailedStats: protectedProcedure
    .input(workflowDetailedStatsSchema)
    .query(async ({ ctx, input }) => {
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
  publish: protectedProcedure
    .input(z.object({ workflowId: z.string(), versionTitle: z.string().optional() }))
    .use(notDemo('publish workflows'))
    .mutation(async ({ ctx, input }) => {
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
  getVersions: protectedProcedure
    .input(z.object({ workflowId: z.string() }))
    .query(async ({ ctx, input }) => {
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
  getVersionById: protectedProcedure
    .input(z.object({ workflowId: z.string(), versionId: z.string() }))
    .query(async ({ ctx, input }) => {
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
  deleteVersion: protectedProcedure
    .input(z.object({ workflowId: z.string(), versionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
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
  renameVersion: protectedProcedure
    .input(
      z.object({
        workflowId: z.string(),
        versionId: z.string(),
        title: z.string().min(1, 'Title is required'),
      })
    )
    .mutation(async ({ ctx, input }) => {
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
  stopWorkflowRun: protectedProcedure
    .input(z.object({ runId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertWorkflowRunNotSystemOwned(ctx.db, {
        runId: input.runId,
        organizationId: ctx.session.organizationId,
        isSuperAdmin: ctx.session.isSuperAdmin,
      })
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
  runSingleNode: protectedProcedure
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
  getWorkflowRun: protectedProcedure
    .input(z.object({ runId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertWorkflowRunNotSystemOwned(ctx.db, {
        runId: input.runId,
        organizationId: ctx.session.organizationId,
        isSuperAdmin: ctx.session.isSuperAdmin,
        allowSuperAdminRead: true,
      })
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
  listWorkflowRuns: protectedProcedure
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
  getManualWorkflows: protectedProcedure
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

      // Map to simpler format for UI
      return result.value.map((item) => ({
        id: item.workflowApp.id,
        name: item.workflowApp.name,
        description: item.workflowApp.description,
      }))
    }),

  /**
   * Manually trigger a specific workflow for a resource
   *
   * UX: User selects a workflow from dropdown, then triggers it
   * Permissions: Any authenticated team member
   */
  triggerManualResource: protectedProcedure
    .input(
      z.object({
        workflowAppId: z.string(),
        recordId: recordIdSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
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
   * Permissions: Any authenticated team member
   */
  triggerManualResourceBulk: protectedProcedure
    .input(
      z.object({
        workflowAppId: z.string(),
        recordIds: z.array(recordIdSchema).min(1).max(100), // Limit to 100 resources
      })
    )
    .mutation(async ({ ctx, input }) => {
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
  generateShareToken: protectedProcedure
    .input(z.object({ id: z.string() }))
    .use(notDemo('share workflows'))
    .mutation(async ({ ctx, input }) => {
      const { id } = input

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
  revokeShareToken: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { id } = input

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
