import { generateSecureToken, hashApiKey } from '@auxx/credentials/api-key'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { TRPCError } from '@trpc/server'
import { and, eq } from 'drizzle-orm'
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
      const orgId = ctx.session.organizationId

      if (input.workflowAppId) {
        return ctx.db
          .select()
          .from(schema.ApiKey)
          .where(
            and(
              eq(schema.ApiKey.organizationId, orgId),
              eq(schema.ApiKey.type, 'workflow'),
              eq(schema.ApiKey.referenceId, input.workflowAppId),
              eq(schema.ApiKey.isActive, true)
            )
          )
      }

      return ctx.db
        .select()
        .from(schema.ApiKey)
        .where(
          and(
            eq(schema.ApiKey.organizationId, orgId),
            eq(schema.ApiKey.userId, ctx.session.user.id),
            eq(schema.ApiKey.isActive, true)
          )
        )
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
      const orgId = ctx.session.organizationId

      // Validate workflow ownership if creating workflow key
      if (input.type === 'workflow') {
        if (!input.workflowAppId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'workflowAppId is required for workflow API keys',
          })
        }

        const [workflowApp] = await ctx.db
          .select()
          .from(schema.WorkflowApp)
          .where(
            and(
              eq(schema.WorkflowApp.id, input.workflowAppId),
              eq(schema.WorkflowApp.organizationId, orgId)
            )
          )
        if (!workflowApp) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Workflow not found',
          })
        }
      }

      // Check for duplicate name
      if (input.name) {
        const [existing] = await ctx.db
          .select()
          .from(schema.ApiKey)
          .where(
            and(
              eq(schema.ApiKey.organizationId, orgId),
              eq(schema.ApiKey.userId, userId),
              eq(schema.ApiKey.name, input.name)
            )
          )
          .limit(1)
        if (existing) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'API key with this name already exists',
          })
        }
      }

      logger.info('Creating API key', { userId, type: input.type })

      const secretKey = generateSecureToken()
      const hashedKey = hashApiKey(secretKey)

      const keySuffix = secretKey.slice(-5).toUpperCase()
      const defaultName =
        input.type === 'workflow' ? `Workflow Key ...${keySuffix}` : `Secret key ...${keySuffix}`

      await ctx.db.insert(schema.ApiKey).values({
        userId,
        organizationId: orgId,
        name: input.name || defaultName,
        hashedKey,
        isActive: true,
        type: input.type,
        referenceId: input.type === 'workflow' ? input.workflowAppId : null,
        updatedAt: new Date(),
      })

      return { secretKey }
    }),
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(schema.ApiKey)
        .set({ isActive: false, updatedAt: new Date() })
        .where(
          and(
            eq(schema.ApiKey.id, input.id),
            eq(schema.ApiKey.organizationId, ctx.session.organizationId)
          )
        )
    }),
})
