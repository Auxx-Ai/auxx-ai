import { CredentialService } from '@auxx/credentials'
import { generateSecureToken, hashApiKey } from '@auxx/credentials/api-key'
import { schema } from '@auxx/database'
import { isAdminOrOwner } from '@auxx/lib/members'
import { createScopedLogger } from '@auxx/logger'
import { TRPCError } from '@trpc/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { recordAuditFromCtx } from '../audit-context'
import { createTRPCRouter, notDemo, protectedProcedure } from '../trpc'

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
        channelId: z.string().optional(),
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

      if (input.channelId) {
        return ctx.db
          .select()
          .from(schema.ApiKey)
          .where(
            and(
              eq(schema.ApiKey.organizationId, orgId),
              eq(schema.ApiKey.type, 'chat'),
              eq(schema.ApiKey.referenceId, input.channelId),
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
        type: z.enum(['app', 'workflow', 'chat']).optional().default('app'),
        workflowAppId: z.string().optional(),
        channelId: z.string().optional(),
      })
    )
    .use(notDemo('generate API keys'))
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

      // Chat keys are channel-scoped and admin-gated
      if (input.type === 'chat') {
        if (!input.channelId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'channelId is required for chat API keys',
          })
        }

        if (!(await isAdminOrOwner(orgId, userId))) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You must be an admin or owner to manage chat signing keys',
          })
        }

        const [integration] = await ctx.db
          .select({ id: schema.Integration.id })
          .from(schema.Integration)
          .where(
            and(
              eq(schema.Integration.id, input.channelId),
              eq(schema.Integration.organizationId, orgId)
            )
          )
        if (!integration) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Channel not found',
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
        input.type === 'workflow'
          ? `Workflow Key ...${keySuffix}`
          : input.type === 'chat'
            ? `Chat Key ...${keySuffix}`
            : `Secret key ...${keySuffix}`

      const referenceId =
        input.type === 'workflow'
          ? (input.workflowAppId ?? null)
          : input.type === 'chat'
            ? (input.channelId ?? null)
            : null

      // Chat keys sign customer JWTs — verification needs the original plaintext,
      // which the one-way `hashedKey` cannot recover. Store the secret encrypted
      // (AES-256-GCM via CredentialService) so phase 3's verify-jwt can decrypt
      // and re-derive HS256. Other key types stay hash-only.
      const encryptedSecret =
        input.type === 'chat' ? CredentialService.encrypt({ value: secretKey }) : null

      const [created] = await ctx.db
        .insert(schema.ApiKey)
        .values({
          userId,
          organizationId: orgId,
          name: input.name || defaultName,
          hashedKey,
          encryptedSecret,
          isActive: true,
          type: input.type,
          referenceId,
          updatedAt: new Date(),
        })
        .returning({ id: schema.ApiKey.id })

      await recordAuditFromCtx(ctx, {
        category: 'security',
        action: 'apiKey.created',
        targetType: 'ApiKey',
        targetId: created?.id ?? null,
        metadata: { type: input.type, name: input.name || defaultName, referenceId },
      })

      return { secretKey }
    }),
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.session.organizationId
      const userId = ctx.session.user.id

      const [existing] = await ctx.db
        .select({ type: schema.ApiKey.type })
        .from(schema.ApiKey)
        .where(and(eq(schema.ApiKey.id, input.id), eq(schema.ApiKey.organizationId, orgId)))
        .limit(1)

      if (existing?.type === 'chat' && !(await isAdminOrOwner(orgId, userId))) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You must be an admin or owner to revoke chat signing keys',
        })
      }

      await ctx.db
        .update(schema.ApiKey)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(schema.ApiKey.id, input.id), eq(schema.ApiKey.organizationId, orgId)))

      await recordAuditFromCtx(ctx, {
        category: 'security',
        action: 'apiKey.revoked',
        targetType: 'ApiKey',
        targetId: input.id,
        metadata: { type: existing?.type },
      })
    }),
})
