// apps/web/src/server/api/routers/workflow.ts

import { schema } from '@auxx/database'
import { WorkflowRunStatus } from '@auxx/database/enums'
import {
  triggerManualResourceWorkflow,
  triggerManualResourceWorkflowBulk,
  type Workflow,
  WorkflowEngine,
  type WorkflowNode,
  type WorkflowNodeType,
} from '@auxx/lib/workflow-engine'
import {
  TemplateGraphTransformer,
  WORKFLOW_TRIGGER_TYPE_VALUES,
  type WorkflowExecutionError,
  WorkflowExecutionService,
  WorkflowService,
  WorkflowStatsService,
  WorkflowVersionService,
} from '@auxx/lib/workflows'
import { getTemplateById } from '@auxx/services/workflow-templates'
import { getWorkflowAppsByTrigger } from '@auxx/services/workflows'
import { type RecordId, recordIdSchema } from '@auxx/types/resource'
import { generateId } from '@auxx/utils/generateId'
import { TRPCError } from '@trpc/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'
import { workflowTemplatesRouter } from './workflow-templates'

/**
 * Convert database workflow format to workflow-engine format for validation
 */
function convertToEngineFormat(dbWorkflow: any): Workflow {
  // Convert graph nodes to WorkflowNode format
  const nodes: WorkflowNode[] = (dbWorkflow.graph?.nodes || []).map((node: any) => ({
    id: node.id,
    workflowId: dbWorkflow.id,
    nodeId: node.id,
    type: node.data?.type as WorkflowNodeType,
    name: node.data?.title || node.data?.name || 'Untitled Node',
    description: node.data?.description || node.data?.desc,
    data: node.data || {},
    metadata: {
      position: node.position,
      color: node.data?.color,
      icon: node.data?.icon,
    },
  }))
  return {
    id: dbWorkflow.id,
    workflowId: dbWorkflow.id,
    workflowAppId: dbWorkflow.workflowAppId,
    organizationId: dbWorkflow.organizationId || '',
    name: dbWorkflow.name || 'Untitled Workflow',
    description: dbWorkflow.description,
    enabled: dbWorkflow.enabled || false,
    version: dbWorkflow.version || 1,
    triggerType: dbWorkflow.triggerType,
    entityDefinitionId: dbWorkflow.entityDefinitionId,
    nodes,
    graph: dbWorkflow.graph,
    envVars: dbWorkflow.envVars,
    variables: dbWorkflow.variables,
    createdAt: dbWorkflow.createdAt || new Date(),
    updatedAt: dbWorkflow.updatedAt || new Date(),
    createdById: dbWorkflow.createdById,
  }
}
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
} // Create workflow schema
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
  getAll: protectedProcedure.input(listWorkflowsSchema).query(async ({ ctx, input }) => {
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
    const workflowService = new WorkflowService(ctx.db)
    try {
      const workflowApp = await workflowService.getById(input.id, ctx.session.organizationId)
      // Transform to maintain backward compatibility with existing UI
      // Use draft workflow for editing
      const workflowData = workflowApp.draftWorkflow || workflowApp.publishedWorkflow
      const result = {
        id: workflowApp.id,
        name: workflowApp.name,
        description: workflowApp.description,
        enabled: workflowApp.enabled,
        triggerType: workflowData?.triggerType,
        entityDefinitionId: workflowData?.entityDefinitionId,
        version: workflowData?.version || 1,
        graph: workflowData?.graph,
        variables: workflowData?.variables || [],
        envVars: workflowData?.envVars,
        organizationId: workflowApp.organizationId,
        createdById: workflowApp.createdById,
        createdAt: workflowApp.createdAt,
        updatedAt: workflowApp.updatedAt,
        createdBy: workflowApp.createdBy,
        // Add WorkflowApp specific fields
        isPublic: workflowApp.isPublic,
        isUniversal: workflowApp.isUniversal,
        workflowId: workflowApp.draftWorkflowId, // Return draft workflow ID for editing
        workflows: workflowApp.workflows, // All versions
        workflowAppId: workflowApp.id, // Include workflowAppId for frontend use
        // Access settings
        shareToken: workflowApp.shareToken,
        webEnabled: workflowApp.webEnabled,
        apiEnabled: workflowApp.apiEnabled,
        accessMode: workflowApp.accessMode,
        icon: workflowApp.icon,
        config: workflowApp.config,
        rateLimit: workflowApp.rateLimit,
        totalRuns: workflowApp.totalRuns,
        lastRunAt: workflowApp.lastRunAt,
      }
      return result
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
    const workflowService = new WorkflowService(ctx.db)

    try {
      // If templateId is provided, fetch the template and transform it
      let templateData: any

      if (input.templateId) {
        const templateResult = await getTemplateById(input.templateId)

        if (templateResult.isErr()) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found' })
        }

        const template = templateResult.value

        // Transform the template graph and data
        const transformer = new TemplateGraphTransformer()
        const transformed = transformer.transformTemplate({
          graph: template.graph as any,
          triggerType: template.triggerType ?? undefined,
          entityDefinitionId: template.entityDefinitionId ?? undefined,
          envVars: template.envVars ?? undefined,
          variables: template.variables ?? undefined,
        })

        templateData = {
          graph: transformed.graph,
          triggerType: transformed.triggerType,
          entityDefinitionId: transformed.entityDefinitionId,
          envVars: transformed.envVars,
          variables: transformed.variables,
        }
      }

      // Create the workflow with optional template data
      return await workflowService.create(ctx.session.organizationId, ctx.session.userId, {
        ...input,
        ...templateData, // Spread template data if it exists
      })
    } catch (error) {
      if (error instanceof TRPCError) {
        throw error
      }
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create workflow' })
    }
  }),
  /**
   * Update an existing workflow app (updates active workflow)
   */
  update: protectedProcedure.input(updateWorkflowSchema).mutation(async ({ ctx, input }) => {
    const workflowService = new WorkflowService(ctx.db)

    console.log('[workflow.update] Updating workflow with input:', input)
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
      const workflowService = new WorkflowService(ctx.db)
      try {
        return await workflowService.delete(input.id, ctx.session.organizationId)
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
    .mutation(async ({ ctx, input }) => {
      const versionService = new WorkflowVersionService(ctx.db)
      try {
        // Get the workflow app with draft workflow for validation
        const [appResult] = await ctx.db
          .select({ app: schema.WorkflowApp, draft: schema.Workflow })
          .from(schema.WorkflowApp)
          .leftJoin(schema.Workflow, eq(schema.Workflow.id, schema.WorkflowApp.draftWorkflowId))
          .where(
            and(
              eq(schema.WorkflowApp.id, input.workflowId),
              eq(schema.WorkflowApp.organizationId, ctx.session.organizationId)
            )
          )
          .limit(1)
        const workflowApp = appResult?.app
          ? { ...appResult.app, draftWorkflow: appResult.draft ?? null }
          : null
        if (!workflowApp) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Workflow not found' })
        }
        if (!workflowApp.draftWorkflow) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'No draft workflow to publish' })
        }

        // Convert to workflow-engine format and validate
        const engineWorkflow = convertToEngineFormat(workflowApp.draftWorkflow)
        const workflowEngine = new WorkflowEngine()
        await workflowEngine.getNodeRegistry().initializeWithDefaults()
        const validationResult = await workflowEngine.validateWorkflowForPublish(engineWorkflow)
        if (!validationResult.valid) {
          console.error('[workflow.publish] Validation failed:', {
            workflowId: input.workflowId,
            errors: validationResult.errors,
            warnings: validationResult.warnings,
          })
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Workflow has validation errors that must be fixed before publishing',
            cause: {
              errors: validationResult.errors,
              warnings: validationResult.warnings,
            },
          })
        }
        // If validation passes, proceed with publishing
        return await versionService.publish(
          input.workflowId,
          ctx.session.organizationId,
          input.versionTitle
        )
      } catch (error) {
        // Re-throw TRPCError instances
        if (error instanceof TRPCError) {
          throw error
        }
        if (error instanceof Error) {
          if (error.message === 'Workflow not found') {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Workflow not found' })
          }
          if (error.message === 'No active workflow to publish') {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active workflow to publish' })
          }
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to publish workflow version',
        })
      }
    }),
  /**
   * Get all versions of a workflow
   */
  getVersions: protectedProcedure
    .input(z.object({ workflowId: z.string() }))
    .query(async ({ ctx, input }) => {
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
        userEmail: z.string().optional(),
        userName: z.string().optional(),
        organizationName: z.string().optional(),
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
    .mutation(async ({ ctx, input }) => {
      const executionService = new WorkflowExecutionService(ctx.db, {
        errorHandler: createTRPCErrorHandler,
      })
      try {
        return await executionService.runSingleNode({
          ...input,
          userId: ctx.session.userId,
          organizationId: ctx.session.organizationId,
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
    .mutation(async ({ ctx, input }) => {
      const { id } = input

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

      return updated
    }),

  /**
   * Revoke share token (disable sharing)
   */
  revokeShareToken: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { id } = input

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

      return updated
    }),

  /**
   * Workflow templates sub-router
   */
  templates: workflowTemplatesRouter,
})
