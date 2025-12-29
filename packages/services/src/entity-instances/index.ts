// packages/services/src/entity-instances/index.ts

export {
  createEntityInstance,
  type CreateEntityInstanceParams,
} from './create-entity-instance'
export { getEntityInstance, type GetEntityInstanceParams } from './get-entity-instance'
export { listEntityInstances, type ListEntityInstancesParams } from './list-entity-instances'
export {
  updateEntityInstance,
  type UpdateEntityInstanceParams,
} from './update-entity-instance'
export { deleteEntityInstance, type DeleteEntityInstanceParams } from './delete-entity-instance'
export type { EntityInstanceError } from './errors'
