// apps/web/src/components/resources/hooks/use-entity-definition-mutations.ts

import { api } from '~/trpc/react'

/**
 * Hook that provides entity definition mutations with automatic resource cache invalidation.
 * Use this hook instead of calling api.entityDefinition mutations directly to ensure
 * the resource definitions cache is properly invalidated when entities change.
 */
export function useEntityDefinitionMutations() {
  const utils = api.useUtils()

  /** Invalidate resource definitions cache so workflow nodes get updated resources */
  const invalidateResourceDefinitions = () => {
    utils.resource.getAllResourceTypes.invalidate()
  }

  const createEntity = api.entityDefinition.create.useMutation({
    onSuccess: () => {
      invalidateResourceDefinitions()
    },
  })

  const updateEntity = api.entityDefinition.update.useMutation({
    onSuccess: () => {
      invalidateResourceDefinitions()
    },
  })

  const archiveEntity = api.entityDefinition.archive.useMutation({
    onSuccess: () => {
      invalidateResourceDefinitions()
    },
  })

  const restoreEntity = api.entityDefinition.restore.useMutation({
    onSuccess: () => {
      invalidateResourceDefinitions()
    },
  })

  return {
    createEntity,
    updateEntity,
    archiveEntity,
    restoreEntity,
  }
}
