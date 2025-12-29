// packages/services/src/entity-instances/errors.ts

/** Error types for entity instance operations */
export type EntityInstanceError =
  | { code: 'ENTITY_INSTANCE_NOT_FOUND'; message: string; entityInstanceId: string }
  | { code: 'ENTITY_DEFINITION_NOT_FOUND'; message: string; entityDefinitionId: string }
  | { code: 'VALIDATION_ERROR'; message: string; details?: Record<string, string> }
