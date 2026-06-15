// apps/web/src/server/api/routers/admin-workflow-templates.ts

import { getAppCache } from '@auxx/lib/cache'
import { isFileTemplateId, listFileTemplates, normalizeTemplateGraph } from '@auxx/lib/workflows'
import {
  createTemplate,
  deleteTemplate,
  duplicateTemplate,
  getAllTemplates,
  updateTemplate,
} from '@auxx/services/workflow-templates'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { recordAuditFromCtx } from '~/server/api/audit-context'
import { createTRPCRouter, superAdminProcedure } from '~/server/api/trpc'
import { resolveTemplateById } from '~/server/api/workflow-template-resolver'

/** Guard: file templates are repo-managed and cannot be mutated via the admin API. */
function assertNotFileTemplate(id: string): void {
  if (isFileTemplateId(id)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message:
        'File-defined templates are managed in the repo. Duplicate it to make an editable copy.',
    })
  }
}

/**
 * tRPC router for admin workflow template management
 */
export const adminWorkflowTemplatesRouter = createTRPCRouter({
  /**
   * Get all workflow templates
   */
  getAll: superAdminProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).optional(),
        offset: z.number().min(0).optional(),
        search: z.string().optional(),
        status: z.enum(['public', 'private', 'all']).optional(),
        categories: z.array(z.string()).optional(),
      })
    )
    .query(async ({ input }) => {
      const result = await getAllTemplates(input)
      if (result.isErr()) {
        throw new Error(result.error.message)
      }
      // Merge bundled file templates (read-only) with DB rows.
      const fileItems = listFileTemplates({
        search: input.search,
        categories: input.categories,
        status: input.status === 'all' || !input.status ? 'all' : input.status,
      })
      const dbItems = result.value.map((t) => ({ ...t, source: 'admin' as const }))
      return [...fileItems, ...dbItems]
    }),

  /**
   * Get single workflow template (file registry or DB)
   */
  getById: superAdminProcedure
    .input(
      z.object({
        id: z.string(),
      })
    )
    .query(async ({ input }) => {
      const template = await resolveTemplateById(input.id)
      if (!template) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Workflow template not found' })
      }
      return template
    }),

  /**
   * Create new workflow template
   */
  create: superAdminProcedure
    .input(
      z.object({
        name: z.string().min(1),
        description: z.string().min(1),
        categories: z.array(z.string()),
        imgUrl: z.string().optional(),
        icon: z.object({ iconId: z.string(), color: z.string() }).optional(),
        graph: z.any(),
        version: z.number().optional(),
        status: z.enum(['public', 'private']).optional(),
        triggerType: z.string().optional(),
        triggerConfig: z.record(z.string(), z.any()).optional(),
        envVars: z
          .array(
            z.object({
              id: z.string(),
              name: z.string(),
              value: z.any(),
              type: z.enum(['string', 'number', 'boolean', 'array', 'secret']),
            })
          )
          .optional(),
        variables: z.array(z.any()).optional(),
        requiredApps: z
          .array(
            z.object({
              appSlug: z.string(),
              appTitle: z.string(),
              blockIds: z.array(z.string()),
              triggerIds: z.array(z.string()),
              required: z.boolean(),
            })
          )
          .optional(),
        requiredEntities: z.array(z.any()).optional(),
        popularity: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await createTemplate({
        ...input,
        graph: normalizeTemplateGraph(input.graph),
      })
      if (result.isErr()) {
        throw new Error(result.error.message)
      }
      await getAppCache().invalidateAndRecompute(['workflowTemplates'])
      await recordAuditFromCtx(ctx, {
        organizationId: null,
        category: 'apps',
        action: 'workflowTemplate.created',
        actorType: 'admin',
        visibility: 'internal',
        targetType: 'WorkflowTemplate',
        targetId: result.value.id,
        metadata: { name: input.name, status: input.status ?? null },
      })
      return result.value
    }),

  /**
   * Update workflow template
   */
  update: superAdminProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).optional(),
        description: z.string().min(1).optional(),
        categories: z.array(z.string()).optional(),
        imgUrl: z.string().optional(),
        icon: z.object({ iconId: z.string(), color: z.string() }).nullish(),
        graph: z.any().optional(),
        version: z.number().optional(),
        status: z.enum(['public', 'private']).optional(),
        triggerType: z.string().optional(),
        triggerConfig: z.record(z.string(), z.any()).optional(),
        envVars: z
          .array(
            z.object({
              id: z.string(),
              name: z.string(),
              value: z.any(),
              type: z.enum(['string', 'number', 'boolean', 'array', 'secret']),
            })
          )
          .optional(),
        variables: z.array(z.any()).optional(),
        requiredApps: z
          .array(
            z.object({
              appSlug: z.string(),
              appTitle: z.string(),
              blockIds: z.array(z.string()),
              triggerIds: z.array(z.string()),
              required: z.boolean(),
            })
          )
          .optional(),
        requiredEntities: z.array(z.any()).optional(),
        popularity: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertNotFileTemplate(input.id)
      const result = await updateTemplate({
        ...input,
        graph: input.graph === undefined ? undefined : normalizeTemplateGraph(input.graph),
      })
      if (result.isErr()) {
        throw new Error(result.error.message)
      }
      await getAppCache().invalidateAndRecompute(['workflowTemplates'])
      await recordAuditFromCtx(ctx, {
        organizationId: null,
        category: 'apps',
        action: 'workflowTemplate.updated',
        actorType: 'admin',
        visibility: 'internal',
        targetType: 'WorkflowTemplate',
        targetId: input.id,
      })
      return result.value
    }),

  /**
   * Delete workflow template
   */
  delete: superAdminProcedure
    .input(
      z.object({
        id: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertNotFileTemplate(input.id)
      const result = await deleteTemplate(input.id)
      if (result.isErr()) {
        throw new Error(result.error.message)
      }
      await getAppCache().invalidateAndRecompute(['workflowTemplates'])
      await recordAuditFromCtx(ctx, {
        organizationId: null,
        category: 'apps',
        action: 'workflowTemplate.deleted',
        actorType: 'admin',
        visibility: 'internal',
        targetType: 'WorkflowTemplate',
        targetId: input.id,
      })
      return { success: true }
    }),

  /**
   * Duplicate a workflow template
   */
  duplicate: superAdminProcedure
    .input(
      z.object({
        id: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      // File templates aren't DB rows — fork them into an editable admin copy.
      if (isFileTemplateId(input.id)) {
        const source = await resolveTemplateById(input.id)
        if (!source) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Workflow template not found' })
        }
        const created = await createTemplate({
          name: `${source.name} (Copy)`,
          description: source.description,
          categories: source.categories,
          imgUrl: source.imgUrl ?? undefined,
          icon: source.icon ?? undefined,
          graph: source.graph,
          status: 'private',
          triggerType: source.triggerType ?? undefined,
          triggerConfig: source.triggerConfig ?? undefined,
          envVars: source.envVars ?? undefined,
          variables: source.variables ?? undefined,
          requiredApps: source.requiredApps,
          requiredEntities: source.requiredEntities,
          popularity: 0,
        })
        if (created.isErr()) {
          throw new Error(created.error.message)
        }
        await getAppCache().invalidateAndRecompute(['workflowTemplates'])
        return created.value
      }

      const result = await duplicateTemplate(input.id)
      if (result.isErr()) {
        throw new Error(result.error.message)
      }
      await getAppCache().invalidateAndRecompute(['workflowTemplates'])
      return result.value
    }),
})
