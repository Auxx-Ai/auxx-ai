// packages/services/src/entity-definitions/index.ts

export { getEntityDefinition } from './get-entity-definition'
export { listEntityDefinitions } from './list-entity-definitions'
export { getEntityDefinitionBySlug } from './get-entity-definition-by-slug'
export { checkSlugExists } from './check-slug-exists'
export {
  createEntityDefinition,
  type CreateEntityDefinitionParams,
} from './create-entity-definition'
export {
  updateEntityDefinition,
  type UpdateEntityDefinitionParams,
} from './update-entity-definition'
export { deleteEntityDefinition } from './delete-entity-definition'
export type { EntityDefinitionError } from './errors'
