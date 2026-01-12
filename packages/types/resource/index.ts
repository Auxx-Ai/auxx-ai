// packages/types/resource/index.ts

/**
 * Branded string type for resource identification.
 * Format: `${entityDefinitionId}:${entityInstanceId}`
 *
 * Example: "contact:abc123" or "cm1abc123xyz:inst456"
 */
export type ResourceId = string & { readonly __brand: 'ResourceId' }

export { resourceIdSchema } from './schema'
