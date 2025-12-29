// packages/lib/src/datasets/utils/embedding-columns.ts

/**
 * Supported embedding dimensions for database storage.
 * These correspond to the embedding_XXX columns in DocumentSegment.
 */
export const EMBEDDING_DIMENSIONS = [512, 768, 1024, 1536, 3072] as const

/** Type for supported embedding dimensions */
export type EmbeddingDimension = (typeof EMBEDDING_DIMENSIONS)[number]

/**
 * Map dimension to column name
 * @param dimension - The embedding dimension
 * @returns The database column name for this dimension
 * @throws Error if dimension is not supported
 */
export function getEmbeddingColumnName(dimension: number): string {
  if (!EMBEDDING_DIMENSIONS.includes(dimension as EmbeddingDimension)) {
    throw new Error(
      `Unsupported embedding dimension: ${dimension}. ` +
        `Supported: ${EMBEDDING_DIMENSIONS.join(', ')}`
    )
  }
  return `embedding_${dimension}`
}

/**
 * Normalize dimension to nearest supported value.
 * Used when a model produces a dimension we don't have a column for.
 * @param dimension - The requested dimension
 * @returns The closest supported dimension
 */
export function normalizeToSupportedDimension(dimension: number): EmbeddingDimension {
  const closest = EMBEDDING_DIMENSIONS.reduce((prev, curr) =>
    Math.abs(curr - dimension) < Math.abs(prev - dimension) ? curr : prev
  )
  return closest
}

/**
 * Check if dimension is supported for database storage
 * @param dimension - The dimension to check
 * @returns True if the dimension is supported
 */
export function isSupportedDimension(dimension: number): dimension is EmbeddingDimension {
  return EMBEDDING_DIMENSIONS.includes(dimension as EmbeddingDimension)
}

/** Type for model definition with parameter rules */
interface ModelDefinitionWithRules {
  parameterRules?: Array<{
    name: string
    default?: number
    options?: number[]
    help?: string
  }>
}

/**
 * Get model's default dimension from its parameterRules.
 * This queries the model definition - the single source of truth.
 *
 * @param modelDefinition - The model definition object from provider defaults
 * @returns The default dimension from parameterRules, or 1536 as fallback
 */
export function getModelDefaultDimensionFromDefinition(
  modelDefinition: ModelDefinitionWithRules | undefined
): EmbeddingDimension {
  if (!modelDefinition?.parameterRules) return 1536

  const dimensionRule = modelDefinition.parameterRules.find((rule) => rule.name === 'dimensions')

  if (dimensionRule?.default && isSupportedDimension(dimensionRule.default)) {
    return dimensionRule.default
  }

  return 1536
}

/**
 * Get available dimension options from model's parameterRules,
 * filtered to only those we support in the database.
 *
 * @param modelDefinition - The model definition object from provider defaults
 * @returns Array of supported dimensions, or null if model has fixed dimensions
 */
export function getModelDimensionOptions(
  modelDefinition: ModelDefinitionWithRules | undefined
): EmbeddingDimension[] | null {
  if (!modelDefinition?.parameterRules) return null

  const dimensionRule = modelDefinition.parameterRules.find((rule) => rule.name === 'dimensions')

  if (!dimensionRule?.options || dimensionRule.options.length <= 1) {
    return null // Fixed dimension model
  }

  // Filter to dimensions we support in database
  const supported = dimensionRule.options.filter(isSupportedDimension) as EmbeddingDimension[]
  return supported.length > 0 ? supported : null
}

/**
 * Get dimension help text from model's parameterRules
 * @param modelDefinition - The model definition object
 * @returns Help text or default description
 */
export function getModelDimensionHelp(modelDefinition: ModelDefinitionWithRules | undefined): string {
  if (!modelDefinition?.parameterRules) {
    return 'Smaller dimensions use less storage but may reduce accuracy.'
  }

  const dimensionRule = modelDefinition.parameterRules.find((rule) => rule.name === 'dimensions')
  return dimensionRule?.help || 'Smaller dimensions use less storage but may reduce accuracy.'
}
