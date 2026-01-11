// packages/types/resource/index.ts

/**
 * Reference to a specific entity instance.
 * Used throughout the codebase to identify a record by both its type and ID.
 */
export interface ResourceRef {
  /** The entity definition ID (system resource like 'contact' or custom entity UUID) */
  entityDefinitionId: string
  /** The specific instance ID within that entity type */
  entityInstanceId: string
}

export { resourceRefSchema } from './schema'
