// packages/lib/src/entity-definitions/index.ts

export { checkSlugExists } from './check-slug-exists'
export {
  type CreateEntityDefinitionParams,
  createEntityDefinition,
} from './create-entity-definition'
export {
  deleteEntityDefinitionDeep,
  type EntityDefinitionDeleteSummary,
  selectCalcFieldsToDisable,
  selectPartnerFieldIds,
  selectStreamsWithoutRoot,
} from './delete-entity-definition'
export { deleteEntityDefinition } from './delete-entity-definition-row'
export { EntityDefinitionService } from './entity-definition-service'
export type { EntityDefinitionError } from './errors'
export { getEntityDefinition } from './get-entity-definition'
export { getEntityDefinitionBySlug } from './get-entity-definition-by-slug'
export { listEntityDefinitions } from './list-entity-definitions'
export { notifyEntityDefChanged } from './notify'
export {
  type CreateEntityDefinitionInput,
  createEntityDefinitionSchema,
  type EntityType,
  type StandardType,
  type UpdateEntityDefinitionInput,
  updateEntityDefinitionSchema,
} from './types'
export {
  type UpdateEntityDefinitionParams,
  updateEntityDefinition,
} from './update-entity-definition'
