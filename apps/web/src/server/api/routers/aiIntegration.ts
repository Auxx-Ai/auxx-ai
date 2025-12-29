// apps/web/src/server/api/routers/aiIntegration.ts

import { z } from 'zod'
import { ModelConfigurationModel } from '@auxx/database/models'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'
import { TRPCError } from '@trpc/server'
import {
  ProviderManager,
  ProviderRegistry,
  ProviderConfigurationService,
  SystemModelService,
  QuotaService,
  UsageTrackingService,
} from '@auxx/lib/ai'
import { eq } from 'drizzle-orm'
import { schema } from '@auxx/database'
import { ModelType, ProviderType, PLAN_CREDIT_LIMITS, type PlanTier } from '@auxx/lib/ai/providers/types'

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
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      if (!organizationId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID is required.' })
      }

      const providerManager = new ProviderManager(ctx.db, organizationId, userId)
      return await providerManager.getUnifiedModelData({
        includeDefaults: input.includeDefaults,
        modelTypes: input.modelTypes,
        includeUnconfigured: input.includeUnconfigured,
      })
    }),

  /**
   * Toggle model enabled state for organization
   */
  toggleModel: protectedProcedure
    .input(z.object({ provider: z.string(), model: z.string(), enabled: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const { userId, organizationId } = ctx.session

      if (!organizationId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID is required.' })
      }

      const providerManager = new ProviderManager(ctx.db, organizationId, userId)
      await providerManager.toggleModel(input.provider, input.model, input.enabled)

      return { success: true }
    }),

  /**
   * Update model parameter configuration
   */
  updateModelConfig: protectedProcedure
    .input(
      z.object({ provider: z.string(), model: z.string(), config: z.record(z.string(), z.any()) })
    )
    .mutation(async ({ input, ctx }) => {
      const { userId, organizationId } = ctx.session

      if (!organizationId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID is required.' })
      }

      const providerManager = new ProviderManager(ctx.db, organizationId, userId)
      await providerManager.updateModelConfig(input.provider, input.model, input.config)

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

      // Use ProviderManager but still need ProviderConfigurationService for getEffectiveConfig
      // TODO: Move getEffectiveConfig to ProviderManager in future refactor
      const configService = new ProviderConfigurationService(ctx.db, organizationId, userId)
      const effectiveConfig = await configService.getEffectiveConfig(input.provider, input.model)

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

      // Use ProviderManager for all provider operations
      const providerManager = new ProviderManager(ctx.db, organizationId, userId)

      try {
        // Both create and edit modes can use the same saveProvider method
        await providerManager.saveProvider(provider, credentials)

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
        // Handle specific error types from ProviderConfigurationService
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
    .mutation(async ({ input, ctx }) => {
      const { userId, organizationId } = ctx.session

      if (!organizationId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID is required.' })
      }

      const providerManager = new ProviderManager(ctx.db, organizationId, userId)
      const result = await providerManager.removeCustomCredentials(input.provider)

      return {
        success: true,
        ...result,
        message: result.hasQuota
          ? `API key removed. Now using system credits.`
          : `API key removed.`,
      }
    }),

  /**
   * Test provider credentials (replaces aiModel.retest)
   */
  testProviderCredentials: protectedProcedure
    .input(
      z.object({ provider: z.string(), credentials: z.record(z.string(), z.any()).optional() })
    )
    .mutation(async ({ input, ctx }) => {
      const { userId, organizationId } = ctx.session

      if (!organizationId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID is required.' })
      }

      const providerManager = new ProviderManager(ctx.db, organizationId, userId)

      try {
        const isValid = await providerManager.testProvider(input.provider, input.credentials || {})
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
   * Uses existing getCurrentCredentials with mode-specific parameters
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

      const providerManager = new ProviderManager(ctx.db, organizationId, userId)

      try {
        // Use existing getCurrentCredentials for both modes
        const result = await providerManager.getCurrentCredentials(
          provider,
          mode === 'provider' ? null : model!,
          mode === 'provider' ? null : ModelType.LLM
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
    .mutation(async ({ input, ctx }) => {
      const { userId, organizationId } = ctx.session

      if (!organizationId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID is required.' })
      }

      const { provider, modelId, modelType, credentials, mode } = input

      // Validate provider exists in registry
      const { ProviderRegistry } = await import('@auxx/lib/ai')
      const providerCaps = ProviderRegistry.getProviderCapabilities(provider)
      if (!providerCaps) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Provider '${provider}' not found in registry`,
        })
      }

      // For create mode, check if model ID is already taken
      if (mode === 'create') {
        const mcModel = new ModelConfigurationModel(organizationId)
        const existingRes = await mcModel.findByComposite({ provider, model: modelId, modelType })
        const existingModel = existingRes.ok ? existingRes.value : null

        if (existingModel) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `A model with ID '${modelId}' already exists for provider '${provider}'`,
          })
        }
      }

      const { ProviderManager } = await import('@auxx/lib/ai')
      const providerManager = new ProviderManager(ctx.db, organizationId, userId)

      try {
        await providerManager.saveCustomModel({
          provider,
          modelId,
          modelType: modelType as any,
          credentials,
          mode,
        })

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
    .mutation(async ({ input, ctx }) => {
      const { userId, organizationId } = ctx.session

      if (!organizationId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID is required.' })
      }

      const { ProviderManager } = await import('@auxx/lib/ai')
      const providerManager = new ProviderManager(ctx.db, organizationId, userId)

      try {
        const result = await providerManager.deleteCustomModel({
          provider: input.provider,
          modelId: input.modelId,
        })

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
        modelType: z.nativeEnum(ModelType),
        provider: z.string(),
        model: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      if (!organizationId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID is required.' })
      }

      const systemModelService = new SystemModelService(ctx.db, organizationId)
      await systemModelService.setDefault(input.modelType, input.provider, input.model)

      return { success: true }
    }),

  /**
   * Remove a system default model for a specific model type
   */
  removeSystemModelDefault: protectedProcedure
    .input(
      z.object({
        modelType: z.nativeEnum(ModelType),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      if (!organizationId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID is required.' })
      }

      const systemModelService = new SystemModelService(ctx.db, organizationId)
      await systemModelService.removeDefault(input.modelType)

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
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      if (!organizationId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID is required.' })
      }

      const configService = new ProviderConfigurationService(ctx.db, organizationId, userId)
      await configService.switchProviderType(
        input.provider,
        input.providerType === 'system' ? ProviderType.SYSTEM : ProviderType.CUSTOM
      )

      return { success: true }
    }),

  /**
   * Upgrade organization to paid tier (called after successful subscription)
   */
  upgradeToPaid: protectedProcedure
    .input(
      z.object({
        planTier: z.enum(['starter', 'growth', 'business', 'enterprise']),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      if (!organizationId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID is required.' })
      }

      const creditLimit = PLAN_CREDIT_LIMITS[input.planTier as PlanTier]
      const quotaService = new QuotaService(ctx.db, organizationId)
      await quotaService.upgradeToPaid(creditLimit)

      return { success: true, creditLimit }
    }),

  /**
   * Downgrade organization to free tier (called after subscription cancellation)
   */
  downgradeToFree: protectedProcedure.mutation(async ({ ctx }) => {
    const { organizationId } = ctx.session
    if (!organizationId) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Organization ID is required.' })
    }

    const quotaService = new QuotaService(ctx.db, organizationId)
    await quotaService.downgradeToFree()

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
