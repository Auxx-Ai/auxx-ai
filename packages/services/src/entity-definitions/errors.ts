// packages/services/src/entity-definitions/errors.ts

/**
 * Error types for entity definition operations
 */
export type EntityDefinitionError =
  | { code: 'ENTITY_DEFINITION_NOT_FOUND'; message: string; entityDefinitionId: string }
  | { code: 'SLUG_ALREADY_EXISTS'; message: string; slug: string; organizationId: string }
  | { code: 'ORGANIZATION_NOT_FOUND'; message: string; organizationId: string }
