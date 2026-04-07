// packages/lib/src/datasets/services/dataset-embedding-validator.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, eq } from 'drizzle-orm'
import { SystemModelService } from '../../ai/providers/system-model-service'
import { ModelType } from '../../ai/providers/types'

const logger = createScopedLogger('dataset-embedding-validator')

/**
 * Dataset embedding configuration with unified modelId format
 */
export interface DatasetEmbeddingConfig {
  modelId: string // "provider:model" format
  dimensions: number
}

export interface ValidationResult {
  isValid: boolean
  errors: string[]
  warnings: string[]
  suggestedConfig?: DatasetEmbeddingConfig
}

/**
 * Default embedding model ID - application-level default
 */
const DEFAULT_EMBEDDING_MODEL_ID = 'openai:text-embedding-3-small'
const DEFAULT_EMBEDDING_DIMENSIONS = 1536

/**
 * Model dimension mappings for common embedding models
 */
const MODEL_DIMENSIONS: Record<string, number> = {
  // OpenAI models
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
  // Google models
  'gemini-embedding-2-preview': 3072,
  'gemini-embedding-001': 768,
  'text-embedding-004': 768,
  'textembedding-gecko@001': 768,
  'textembedding-gecko@003': 768,
  // Cohere models
  'embed-english-v3.0': 1024,
  'embed-multilingual-v3.0': 1024,
  // HuggingFace models
  'sentence-transformers/all-MiniLM-L6-v2': 384,
  'sentence-transformers/all-mpnet-base-v2': 768,
}

export class DatasetEmbeddingValidator {
  /**
   * Get default embedding configuration - used when creating datasets without explicit config
   */
  static getDefaultEmbeddingConfig(): DatasetEmbeddingConfig {
    return {
      modelId: DEFAULT_EMBEDDING_MODEL_ID,
      dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
    }
  }

  /**
   * Check if organization has an enabled system provider for the given provider name.
   * System providers (platform-managed credentials) don't require explicit ModelConfiguration rows.
   */
  private static async hasEnabledSystemProvider(
    organizationId: string,
    provider: string
  ): Promise<boolean> {
    const [systemProvider] = await db
      .select({ id: schema.ProviderConfiguration.id })
      .from(schema.ProviderConfiguration)
      .where(
        and(
          eq(schema.ProviderConfiguration.organizationId, organizationId),
          eq(schema.ProviderConfiguration.provider, provider),
          eq(schema.ProviderConfiguration.providerType, 'SYSTEM'),
          eq(schema.ProviderConfiguration.isEnabled, true)
        )
      )
      .limit(1)

    return !!systemProvider
  }

  /**
   * Validate that dataset embedding configuration is available in organization
   * @param modelId - Model ID in "provider:model" format
   */
  static async validateEmbeddingConfig(
    modelId: string,
    organizationId: string
  ): Promise<ValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []

    try {
      // Parse modelId
      const [provider, ...modelParts] = modelId.split(':')
      const model = modelParts.join(':')

      if (!provider || !model) {
        errors.push('Invalid modelId format. Expected "provider:model"')
        return { isValid: false, errors, warnings }
      }

      // Check if organization has this provider configured (any type: SYSTEM or CUSTOM)
      const [providerConfig] = await db
        .select()
        .from(schema.ProviderConfiguration)
        .where(
          and(
            eq(schema.ProviderConfiguration.organizationId, organizationId),
            eq(schema.ProviderConfiguration.provider, provider)
          )
        )
        .limit(1)

      if (!providerConfig) {
        errors.push(`Provider '${provider}' is not configured for this organization`)
      } else if (!providerConfig.isEnabled) {
        errors.push(`Provider '${provider}' is disabled for this organization`)
      }

      // Check if the specific model is configured for text embedding
      const [modelConfig] = await db
        .select()
        .from(schema.ModelConfiguration)
        .where(
          and(
            eq(schema.ModelConfiguration.organizationId, organizationId),
            eq(schema.ModelConfiguration.model, model),
            eq(schema.ModelConfiguration.modelType, 'text-embedding'),
            eq(schema.ModelConfiguration.enabled, true)
          )
        )
        .limit(1)

      if (!modelConfig) {
        // Check if we have any embedding models for this organization
        const [anyEmbeddingModel] = await db
          .select()
          .from(schema.ModelConfiguration)
          .where(
            and(
              eq(schema.ModelConfiguration.organizationId, organizationId),
              eq(schema.ModelConfiguration.modelType, 'text-embedding'),
              eq(schema.ModelConfiguration.enabled, true)
            )
          )
          .limit(1)

        if (anyEmbeddingModel) {
          warnings.push(
            `Model '${model}' not found. Consider using '${anyEmbeddingModel.model}' instead`
          )
        } else {
          // No explicit ModelConfiguration rows — check if org has a system provider
          // that can serve embedding requests (system credit orgs don't need model config)
          const hasSystemProvider = await DatasetEmbeddingValidator.hasEnabledSystemProvider(
            organizationId,
            provider
          )

          if (!hasSystemProvider) {
            errors.push(`No embedding models configured for this organization`)
          }
        }
      }

      // If there are errors, suggest a working configuration
      let suggestedConfig: DatasetEmbeddingConfig | undefined
      if (errors.length > 0) {
        suggestedConfig =
          await DatasetEmbeddingValidator.getRecommendedEmbeddingConfig(organizationId)
      }

      return {
        isValid: errors.length === 0,
        errors,
        warnings,
        suggestedConfig,
      }
    } catch (error) {
      logger.error('Failed to validate embedding configuration', {
        error: error instanceof Error ? error.message : error,
        modelId,
        organizationId,
      })

      return {
        isValid: false,
        errors: ['Validation failed due to internal error'],
        warnings,
      }
    }
  }

  /**
   * Get recommended embedding configuration for organization using SystemModelService
   */
  static async getRecommendedEmbeddingConfig(
    organizationId: string
  ): Promise<DatasetEmbeddingConfig> {
    try {
      // First check if there's a system default for TEXT_EMBEDDING
      const systemModelService = new SystemModelService(db, organizationId)
      const systemDefault = await systemModelService.getDefault(ModelType.TEXT_EMBEDDING)

      if (systemDefault) {
        const modelId = `${systemDefault.provider}:${systemDefault.model}`
        return {
          modelId,
          dimensions: DatasetEmbeddingValidator.getModelDimensions(systemDefault.model),
        }
      }

      // Find the best available embedding model configuration
      const modelConfigResult = await db
        .select({
          id: schema.ModelConfiguration.id,
          model: schema.ModelConfiguration.model,
          provider: schema.ModelConfiguration.provider,
        })
        .from(schema.ModelConfiguration)
        .where(
          and(
            eq(schema.ModelConfiguration.organizationId, organizationId),
            eq(schema.ModelConfiguration.modelType, 'text-embedding'),
            eq(schema.ModelConfiguration.enabled, true)
          )
        )
        .orderBy(asc(schema.ModelConfiguration.model))
        .limit(1)

      const modelConfig = modelConfigResult[0] || null

      if (modelConfig) {
        const modelId = `${modelConfig.provider}:${modelConfig.model}`
        return {
          modelId,
          dimensions: DatasetEmbeddingValidator.getModelDimensions(modelConfig.model),
        }
      }

      // No ModelConfiguration rows — check if org has a system provider that can serve embeddings.
      // System credit orgs get ProviderConfiguration (SYSTEM) but no ModelConfiguration rows.
      const hasOpenAiSystem = await DatasetEmbeddingValidator.hasEnabledSystemProvider(
        organizationId,
        'openai'
      )

      if (hasOpenAiSystem) {
        logger.info('Using system provider default embedding config for organization', {
          organizationId,
        })
        return DatasetEmbeddingValidator.getDefaultEmbeddingConfig()
      }

      // No system providers either - return defaults (will fail validation but provides guidance)
      logger.warn('No embedding models or system providers configured for organization', {
        organizationId,
      })
      return DatasetEmbeddingValidator.getDefaultEmbeddingConfig()
    } catch (error) {
      logger.error('Failed to get recommended embedding configuration', {
        error: error instanceof Error ? error.message : error,
        organizationId,
      })

      // Return safe defaults
      return DatasetEmbeddingValidator.getDefaultEmbeddingConfig()
    }
  }

  /**
   * Get available embedding configurations for organization
   */
  static async getAvailableEmbeddingConfigs(
    organizationId: string
  ): Promise<DatasetEmbeddingConfig[]> {
    try {
      const modelConfigs = await db
        .select({
          id: schema.ModelConfiguration.id,
          model: schema.ModelConfiguration.model,
          provider: schema.ModelConfiguration.provider,
        })
        .from(schema.ModelConfiguration)
        .where(
          and(
            eq(schema.ModelConfiguration.organizationId, organizationId),
            eq(schema.ModelConfiguration.modelType, 'text-embedding'),
            eq(schema.ModelConfiguration.enabled, true)
          )
        )
        .orderBy(asc(schema.ModelConfiguration.model))

      const configs = modelConfigs
        .filter((config) => config.provider)
        .map((config) => ({
          modelId: `${config.provider}:${config.model}`,
          dimensions: DatasetEmbeddingValidator.getModelDimensions(config.model),
        }))

      // If no explicit model configs, include system provider defaults
      if (configs.length === 0) {
        const hasOpenAiSystem = await DatasetEmbeddingValidator.hasEnabledSystemProvider(
          organizationId,
          'openai'
        )

        if (hasOpenAiSystem) {
          configs.push(DatasetEmbeddingValidator.getDefaultEmbeddingConfig())
        }
      }

      return configs
    } catch (error) {
      logger.error('Failed to get available embedding configurations', {
        error: error instanceof Error ? error.message : error,
        organizationId,
      })
      return []
    }
  }

  /**
   * Get dimensions for embedding model (with fallback to reasonable default)
   */
  static getModelDimensions(model: string): number {
    return MODEL_DIMENSIONS[model] || DEFAULT_EMBEDDING_DIMENSIONS
  }

  /**
   * Resolve embedding configuration - uses provided modelId or falls back to recommendations
   */
  static async resolveEmbeddingConfig(
    providedModelId: string | undefined,
    providedDimensions: number | undefined,
    organizationId: string
  ): Promise<DatasetEmbeddingConfig> {
    // If modelId is provided, validate and return
    if (providedModelId) {
      const validation = await DatasetEmbeddingValidator.validateEmbeddingConfig(
        providedModelId,
        organizationId
      )

      if (validation.isValid) {
        // Parse to get model name for dimensions lookup
        const [, ...modelParts] = providedModelId.split(':')
        const model = modelParts.join(':')
        return {
          modelId: providedModelId,
          dimensions: providedDimensions || DatasetEmbeddingValidator.getModelDimensions(model),
        }
      }

      // If provided config is invalid, log warning and fall through to recommendations
      logger.warn('Provided embedding configuration is invalid, using recommended config', {
        providedModelId,
        providedDimensions,
        errors: validation.errors,
        organizationId,
      })
    }

    // Get recommended configuration based on organization's available models
    const recommendedConfig =
      await DatasetEmbeddingValidator.getRecommendedEmbeddingConfig(organizationId)

    logger.info('Resolved embedding configuration for dataset', {
      provided: { providedModelId, providedDimensions },
      resolved: recommendedConfig,
      organizationId,
    })

    return {
      modelId: recommendedConfig.modelId,
      dimensions: providedDimensions || recommendedConfig.dimensions,
    }
  }

  /**
   * Ensure dataset has valid embedding configuration (for existing datasets)
   * Updates dataset to use modelId format if needed
   */
  static async ensureValidEmbeddingConfig(
    datasetId: string,
    organizationId: string
  ): Promise<void> {
    try {
      const [dataset] = await db
        .select({
          embeddingModel: schema.Dataset.embeddingModel,
          vectorDimension: schema.Dataset.vectorDimension,
        })
        .from(schema.Dataset)
        .where(eq(schema.Dataset.id, datasetId))
        .limit(1)

      if (!dataset) {
        throw new Error('Dataset not found')
      }

      // Check if current configuration is valid (embeddingModel in provider:model format)
      const hasValidConfig = dataset.embeddingModel && dataset.vectorDimension

      if (!hasValidConfig) {
        // Missing configuration - set recommended defaults
        const recommendedConfig =
          await DatasetEmbeddingValidator.getRecommendedEmbeddingConfig(organizationId)

        await db
          .update(schema.Dataset)
          .set({
            embeddingModel: recommendedConfig.modelId,
            vectorDimension: recommendedConfig.dimensions,
            updatedAt: new Date(),
          })
          .where(eq(schema.Dataset.id, datasetId))

        logger.info('Updated dataset with recommended embedding configuration', {
          datasetId,
          oldModel: dataset.embeddingModel,
          newModelId: recommendedConfig.modelId,
          newDimensions: recommendedConfig.dimensions,
        })
        return
      }

      // Validate current configuration
      const validation = await DatasetEmbeddingValidator.validateEmbeddingConfig(
        dataset.embeddingModel!,
        organizationId
      )

      // If invalid, update with working configuration
      if (!validation.isValid) {
        const workingConfig =
          validation.suggestedConfig ||
          (await DatasetEmbeddingValidator.getRecommendedEmbeddingConfig(organizationId))

        await db
          .update(schema.Dataset)
          .set({
            embeddingModel: workingConfig.modelId,
            vectorDimension: workingConfig.dimensions,
            updatedAt: new Date(),
          })
          .where(eq(schema.Dataset.id, datasetId))

        logger.info('Updated dataset with working embedding configuration', {
          datasetId,
          oldModel: dataset.embeddingModel,
          newModelId: workingConfig.modelId,
          validationErrors: validation.errors,
        })
      }
    } catch (error) {
      logger.error('Failed to ensure valid embedding configuration', {
        error: error instanceof Error ? error.message : error,
        datasetId,
        organizationId,
      })
      throw error
    }
  }
}
