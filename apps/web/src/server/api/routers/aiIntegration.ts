// apps/web/src/server/api/routers/aiIntegration.ts

import { schema } from '@auxx/database'
import {
  deleteCustomModel as deleteCustomModelAction,
  getCredentials,
  getEffectiveConfig,
  getUnifiedModelData,
  ProviderRegistry,
  QuotaService,
  removeCustomCredentials,
  SystemModelService,
  saveCustomModel as saveCustomModelAction,
  saveProvider,
  switchProviderType as switchProviderTypeAction,
  testProvider,
  toggleModel as toggleModelAction,
  UsageTrackingService,
  updateModelConfig as updateModelConfigAction,
} from '@auxx/lib/ai'
import { ModelType, ProviderType } from '@auxx/lib/ai/providers/types'
import { onCacheEvent } from '@auxx/lib/cache'
import { TRPCError } from '@trpc/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { recordAuditFromCtx } from '~/server/api/audit-context'
import { createTRPCRouter, notDemo, protectedProcedure } from '~/server/api/trpc'

export const aiIntegrationRouter = createTRPCRouter({
  /**
   * Get unified model data - combines providers, models, rules, and defaults
   */
  getUnifiedModelData: protectedProcedure
    .input(
      z.object({
        includeDefaults: z.boolean().default(true),
        modelTypes: z.array(z.enum(ModelType)).optional(),
        includeUnconfigured: z.boolean().default(true),
        includeRetired: z.boolean().optional().default(false),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      if (!organizationId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID is required.' })
      }

      return await getUnifiedModelData(
        { db: ctx.db, organizationId, userId },
        {
          includeDefaults: input.includeDefaults,
          modelTypes: input.modelTypes,
          includeUnconfigured: input.includeUnconfigured,
          includeRetired: input.includeRetired,
        }
      )
    }),

  /**
   * Toggle model enabled state for organization
   */
  toggleModel: protectedProcedure
    .input(z.object({ provider: z.string(), model: z.string(), enabled: z.boolean() }))
    .use(notDemo('configure AI models'))
    .mutation(async ({ input, ctx }) => {
      const { userId, organizationId } = ctx.session

      if (!organizationId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID is required.' })
      }

      await toggleModelAction(
        { db: ctx.db, organizationId, userId },
        input.provider,
        input.model,
        input.enabled
      )

      await recordAuditFromCtx(ctx, {
        organizationId,
        category: 'settings',
        action: 'aiModel.toggled',
        targetType: 'AiModel',
        targetId: `${input.provider}:${input.model}`,
        metadata: { provider: input.provider, model: input.model, enabled: input.enabled },
      })

      return { success: true }
    }),

  /**
   * Update model parameter configuration
   */
  updateModelConfig: protectedProcedure
    .input(
      z.object({ provider: z.string(), model: z.string(), config: z.record(z.string(), z.any()) })
    )
    .use(notDemo('configure AI models'))
    .mutation(async ({ input, ctx }) => {
      const { userId, organizationId } = ctx.session

      if (!organizationId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID is required.' })
      }

      await updateModelConfigAction(
        { db: ctx.db, organizationId, userId },
        input.provider,
        input.model,
        input.config
      )

      return { success: true }
    }),

  /**
   * Get parameter rules and current configuration for a model
   */
  getModelParameterRules: protectedProcedure
    .input(z.object({ provider: z.string(), model: z.string() }))
    .query(async ({ input, ctx }) => {
      const { userId, organizationId } = ctx.session

      if (!organizationId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID is required.' })
      }

      const modelCaps = ProviderRegistry.getModelCapabilities(input.model)
      if (!modelCaps) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Model not found in registry' })
      }

      const effectiveConfig = await getEffectiveConfig(
        { db: ctx.db, organizationId, userId },
        input.provider,
        input.model
      )

      return {
        provider: input.provider,
        model: input.model,
        parameterRules: modelCaps.parameterRules,
        currentConfig: effectiveConfig,
      }
    }),

  /**
   * Save provider configuration with dynamic credentials
   */
  saveProviderConfiguration: protectedProcedure
    .input(
      z.object({
        provider: z.string(),
        credentials: z.record(z.string(), z.any()),
        mode: z.enum(['create', 'edit']),
      })
    )
    .use(notDemo('configure AI providers'))
    .mutation(async ({ input, ctx }) => {
      const { userId, organizationId } = ctx.session

      if (!organizationId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID is required.' })
      }

      const { provider, credentials, mode } = input

      // Validate provider exists in registry
      const providerCaps = await ProviderRegistry.getProviderCapabilities(provider)
      if (!providerCaps) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Provider '${provider}' not found in registry`,
        })
      }

      try {
        // Both create and edit modes can use the same saveProvider action
        await saveProvider({ db: ctx.db, organizationId, userId }, provider, credentials)

        await recordAuditFromCtx(ctx, {
          organizationId,
          category: 'settings',
          action: mode === 'create' ? 'aiCredential.added' : 'aiProvider.configured',
          targetType: 'AiProvider',
          targetId: provider,
          metadata: { provider, mode },
        })

        return {
          success: true,
          provider,
          mode,
          message:
            mode === 'create'
              ? `Provider ${providerCaps.displayName} has been configured successfully`
              : `Provider ${providerCaps.displayName} has been updated successfully`,
        }
      } catch (error) {
        // Handle specific error types from the provider config layer
        if (error instanceof Error) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: error.message })
        }

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to save provider configuration: ${error}`,
        })
      }
    }),

  /**
   * Remove custom provider credentials (preserves system quota)
   * Clears credentials and switches to SYSTEM mode
   */
  deleteProviderConfiguration: protectedProcedure
    .input(z.object({ provider: z.string() }))
    .use(notDemo('delete AI providers'))
    .mutation(async ({ input, ctx }) => {
      const { userId, organizationId } = ctx.session

      if (!organizationId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID is required.' })
      }

      const result = await removeCustomCredentials(
        { db: ctx.db, organizationId, userId },
        input.provider
      )

      await recordAuditFromCtx(ctx, {
        organizationId,
        category: 'settings',
        action: 'aiCredential.removed',
        targetType: 'AiProvider',
        targetId: input.provider,
        metadata: { provider: input.provider },
      })

      return {
        success: true,
        ...result,
        message: 'API key removed.',
      }
    }),

  /**
   * Test provider credentials (replaces aiModel.retest)
   */
  testProviderCredentials: protectedProcedure
    .input(
      z.object({ provider: z.string(), credentials: z.record(z.string(), z.any()).optional() })
    )
    .use(notDemo('test AI provider credentials'))
    .mutation(async ({ input, ctx }) => {
      const { userId, organizationId } = ctx.session

      if (!organizationId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID is required.' })
      }

      try {
        const isValid = await testProvider(
          { db: ctx.db, organizationId, userId },
          input.provider,
          input.credentials || {}
        )
        return {
          success: isValid,
          provider: input.provider,
          status: isValid ? 'VALID' : 'INVALID',
          error: isValid ? undefined : 'Credential validation failed',
        }
      } catch (error) {
        return {
          success: false,
          provider: input.provider,
          status: 'INVALID',
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }),

  /**
   * Set provider as default (replaces aiModel.makeDefault)
   */
  setDefaultProvider: protectedProcedure
    .input(z.object({ provider: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const { userId, organizationId } = ctx.session

      if (!organizationId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID is required.' })
      }

      // TODO: Implement default provider logic using ProviderConfigurationService
      // For now, return success
      return {
        success: true,
        provider: input.provider,
        message: `Provider ${input.provider} set as default. NOT IMPLEMENTED`,
      }
    }),

  /**
   * Get credentials for provider or model configuration
   * Uses getCredentials with mode-specific parameters
   */
  getCredentials: protectedProcedure
    .input(
      z.object({
        mode: z.enum(['provider', 'model']),
        provider: z.string(),
        model: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      if (!organizationId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID is required.' })
      }

      const { mode, provider, model } = input

      // Validate model parameter for model mode
      if (mode === 'model' && !model) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Model parameter is required when mode is "model"',
        })
      }

      try {
        // Obfuscate credentials for UI display — raw creds stay in the cache
        const result = await getCredentials(
          { db: ctx.db, organizationId, userId },
          provider,
          mode === 'provider' ? null : model!,
          mode === 'provider' ? null : ModelType.LLM,
          { obfuscate: true }
        )

        return result
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to retrieve credentials: ${error instanceof Error ? error.message : String(error)}`,
        })
      }
    }),

  /**
   * Save custom model configuration (handles both create and update)
   */
  saveCustomModel: protectedProcedure
    .input(
      z.object({
        provider: z.string(),
        modelId: z
          .string()
          .regex(
            /^[a-zA-Z0-9_-]+$/,
            'Model ID must contain only letters, numbers, hyphens, and underscores'
          ),
        modelType: z.string().default('llm'),
        credentials: z.record(z.string(), z.any()),
        mode: z.enum(['create', 'edit']),
      })
    )
    .use(notDemo('create custom AI models'))
    .mutation(async ({ input, ctx }) => {
      const { userId, organizationId } = ctx.session

      if (!organizationId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID is required.' })
      }

      const { provider, modelId, modelType, credentials, mode } = input

      // Validate provider exists in registry
      const providerCaps = ProviderRegistry.getProviderCapabilities(provider)
      if (!providerCaps) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Provider '${provider}' not found in registry`,
        })
      }

      // For create mode, check if model ID is already taken
      if (mode === 'create') {
        const [existingModel] = await ctx.db
          .select({ id: schema.ModelConfiguration.id })
          .from(schema.ModelConfiguration)
          .where(
            and(
              eq(schema.ModelConfiguration.organizationId, organizationId),
              eq(schema.ModelConfiguration.provider, provider),
              eq(schema.ModelConfiguration.model, modelId),
              eq(schema.ModelConfiguration.modelType, modelType as any)
            )
          )
          .limit(1)

        if (existingModel) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `A model with ID '${modelId}' already exists for provider '${provider}'`,
          })
        }
      }

      try {
        await saveCustomModelAction(
          { db: ctx.db, organizationId, userId },
          {
            provider,
            modelId,
            modelType: modelType as any,
            credentials,
            mode,
          }
        )

        return {
          success: true,
          provider,
          modelId,
          displayName: modelId,
          modelType,
          mode,
          message: `Custom model '${modelId}' has been ${mode === 'create' ? 'created' : 'updated'} successfully`,
        }
      } catch (error) {
        if (error instanceof Error) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: error.message })
        }

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to ${mode} custom model: ${error}`,
        })
      }
    }),

  /**
   * Delete custom model configuration
   */
  deleteCustomModel: protectedProcedure
    .input(
      z.object({
        provider: z.string(),
        modelId: z.string(),
      })
    )
    .use(notDemo('delete custom AI models'))
    .mutation(async ({ input, ctx }) => {
      const { userId, organizationId } = ctx.session

      if (!organizationId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID is required.' })
      }

      try {
        const result = await deleteCustomModelAction(
          { db: ctx.db, organizationId, userId },
          {
            provider: input.provider,
            modelId: input.modelId,
          }
        )

        return {
          success: true,
          deleted: result.deleted,
          provider: input.provider,
          modelId: input.modelId,
          message: result.deleted
            ? `Custom model '${input.modelId}' has been deleted successfully`
            : `Custom model '${input.modelId}' was not found`,
        }
      } catch (error) {
        if (error instanceof Error) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: error.message })
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to delete custom model',
        })
      }
    }),

  /**
   * Get all system model defaults for the organization
   */
  getSystemModelDefaults: protectedProcedure.query(async ({ ctx }) => {
    const { organizationId } = ctx.session
    if (!organizationId) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID is required.' })
    }

    const systemModelService = new SystemModelService(ctx.db, organizationId)
    return systemModelService.getAllDefaults()
  }),

  /**
   * Set a system default model for a specific model type
   */
  setSystemModelDefault: protectedProcedure
    .input(
      z.object({
        modelType: z.enum(ModelType),
        provider: z.string(),
        model: z.string(),
      })
    )
    .use(notDemo('set AI model defaults'))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      if (!organizationId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID is required.' })
      }

      const systemModelService = new SystemModelService(ctx.db, organizationId)
      await systemModelService.setDefault(input.modelType, input.provider, input.model)
      await onCacheEvent('ai-default-model.changed', { orgId: organizationId })

      return { success: true }
    }),

  /**
   * Remove a system default model for a specific model type
   */
  removeSystemModelDefault: protectedProcedure
    .input(
      z.object({
        modelType: z.enum(ModelType),
      })
    )
    .use(notDemo('modify AI defaults'))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      if (!organizationId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID is required.' })
      }

      const systemModelService = new SystemModelService(ctx.db, organizationId)
      await systemModelService.removeDefault(input.modelType)
      await onCacheEvent('ai-default-model.changed', { orgId: organizationId })

      return { success: true }
    }),

  // ===== QUOTA MANAGEMENT PROCEDURES =====

  /**
   * Get quota status for the organization's system credentials
   * Returns current usage, limits, and period information
   */
  getQuotaStatus: protectedProcedure.query(async ({ ctx }) => {
    const { organizationId } = ctx.session
    if (!organizationId) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID is required.' })
    }

    const quotaService = new QuotaService(ctx.db, organizationId)
    const status = await quotaService.getQuotaStatus()

    if (!status) {
      return null
    }

    return status
  }),

  /**
   * Check if organization has available quota for system credentials
   */
  checkQuotaAvailable: protectedProcedure.query(async ({ ctx }) => {
    const { organizationId } = ctx.session
    if (!organizationId) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID is required.' })
    }

    const quotaService = new QuotaService(ctx.db, organizationId)
    const hasQuota = await quotaService.hasAvailableQuota()

    return { available: hasQuota }
  }),

  /**
   * Switch provider type preference (system vs custom)
   */
  switchProviderType: protectedProcedure
    .input(
      z.object({
        provider: z.string(),
        providerType: z.enum(['system', 'custom']),
      })
    )
    .use(notDemo('switch AI provider type'))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      if (!organizationId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID is required.' })
      }

      // The action fires `ai-provider.type-switched` after the write, so the cached
      // configs/credentials recompute (the bare mutation only writes ProviderPreference).
      await switchProviderTypeAction(
        { db: ctx.db, organizationId, userId },
        input.provider,
        input.providerType === 'system' ? ProviderType.SYSTEM : ProviderType.CUSTOM
      )

      return { success: true }
    }),

  /**
   * Get AI usage statistics for the organization
   * Used by the AI usage analytics dialog
   */
  getUsageStats: protectedProcedure
    .input(
      z.object({
        days: z.number().optional(), // 7, 30, 90. If undefined = current billing period
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      if (!organizationId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID is required.' })
      }

      const usageService = new UsageTrackingService(ctx.db)

      // If days not specified, get current billing period from PlanSubscription
      if (input.days === undefined) {
        // Get billing cycle period from PlanSubscription
        const subscription = await ctx.db.query.PlanSubscription.findFirst({
          where: eq(schema.PlanSubscription.organizationId, organizationId),
          columns: {
            periodStart: true,
            periodEnd: true,
          },
        })

        return usageService.getUsageStatsByPeriod(organizationId, {
          periodStart: subscription?.periodStart ?? undefined,
          periodEnd: subscription?.periodEnd ?? new Date(),
        })
      }

      // Use days parameter
      return usageService.getUsageStatsByPeriod(organizationId, {
        days: input.days,
      })
    }),
})
