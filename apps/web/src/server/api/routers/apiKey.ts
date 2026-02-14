import { generateSecureToken, hashApiKey } from '@auxx/credentials/api-key'
import { ApiKeyModel, WorkflowAppModel } from '@auxx/database/models'
import { createScopedLogger } from '@auxx/logger'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'

const logger = createScopedLogger('Api Key Action')

export const apiKeyRouter = createTRPCRouter({
  /**
   * Get all API keys for the current user
   * Optionally filter by workflowAppId for workflow-scoped keys
   */
  getAll: protectedProcedure
    .input(
      z.object({
        workflowAppId: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const model = new ApiKeyModel(ctx.session.organizationId)

      if (input.workflowAppId) {
        // Get workflow-scoped keys for specific workflow
        const res = await model.listActiveByWorkflow(input.workflowAppId)
        if (!res.ok) throw res.error
        return res.value
      }

      // Default: get user's org-level keys (existing behavior)
      const res = await model.listActiveByUser(ctx.session.user.id)
      if (!res.ok) throw res.error
      return res.value
    }),

  /**
   * Create a new API key
   * Supports both org-level (app) keys and workflow-scoped keys
   */
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().optional(),
        type: z.enum(['app', 'workflow']).optional().default('app'),
        workflowAppId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id

      // Validate workflow ownership if creating workflow key
      if (input.type === 'workflow') {
        if (!input.workflowAppId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'workflowAppId is required for workflow API keys',
          })
        }

        // Verify user's org owns the workflow
        const workflowModel = new WorkflowAppModel(ctx.session.organizationId)
        const workflowRes = await workflowModel.findById(input.workflowAppId)
        if (!workflowRes.ok || !workflowRes.value) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Workflow not found',
          })
        }
      }

      const model = new ApiKeyModel(ctx.session.organizationId)

      // Check for duplicate name (only for same type/reference)
      const existsRes = await model.findByNameForUser(userId, input.name)
      const exists = existsRes.ok ? existsRes.value : null
      if (exists) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'API key with this name already exists',
        })
      }

      logger.info('Creating API key', { userId, type: input.type })

      const secretKey = generateSecureToken()
      const hashedKey = hashApiKey(secretKey)

      // Extract last 5 characters from the key for identification
      const keySuffix = secretKey.slice(-5).toUpperCase()
      const defaultName =
        input.type === 'workflow' ? `Workflow Key ...${keySuffix}` : `Secret key ...${keySuffix}`

      await model.create({
        userId,
        name: (input.name || defaultName) as any,
        hashedKey,
        isActive: true,
        type: input.type,
        referenceId: input.type === 'workflow' ? input.workflowAppId : null,
      } as any)

      return { secretKey }
    }),
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id
      const model = new ApiKeyModel(ctx.session.organizationId)
      await model.update(input.id, { isActive: false } as any)

      // const account = new GoogleAccount(acc)
      // return await account.deleteWebhook(input.webhookId)
    }),
})
