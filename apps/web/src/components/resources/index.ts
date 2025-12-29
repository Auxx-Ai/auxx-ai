// apps/web/src/components/resources/index.ts

// Provider
export { ResourceProvider, useResourceProvider } from './providers/resource-provider'

// Hooks
export {
  useAllResources,
  useResource,
  useEntityDefinition,
  useEntityDefinitionById,
  useRelationship,
  useResourceFields,
} from './hooks'

// Store utilities (for advanced use cases)
export { buildRelationshipKey, parseRelationshipKey } from './store'
