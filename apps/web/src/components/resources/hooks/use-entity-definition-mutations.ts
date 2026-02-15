// apps/web/src/components/resources/hooks/use-entity-definition-mutations.ts

import type { CustomResource, DisplayFieldConfig } from '@auxx/lib/resources/client'
import { toastError } from '@auxx/ui/components/toast'
import { getResourceStoreState } from '~/components/resources/store/resource-store'
import { api } from '~/trpc/react'

/**
 * Hook that provides entity definition mutations with optimistic updates.
 * Updates the resource store immediately for instant UI feedback,
 * then confirms or rolls back based on server response.
 */
export function useEntityDefinitionMutations() {
  const utils = api.useUtils()

  /** Invalidate resource definitions cache so workflow nodes get updated resources */
  const invalidateResourceDefinitions = () => {
    utils.entityDefinition.getAll.invalidate()
    utils.entityDefinition.getBySlug.invalidate()
    utils.entityDefinition.getById.invalidate()
  }

  const createEntity = api.entityDefinition.create.useMutation({
    // No onMutate - we wait for server response to avoid temp_id/real_id mismatch

    onSuccess: (result, variables) => {
      const store = getResourceStoreState()

      // Build resource from server response
      const serverResource: CustomResource = {
        id: result.id,
        entityDefinitionId: result.id,
        apiSlug: variables.apiSlug,
        type: 'custom',
        label: variables.singular,
        plural: variables.plural,
        icon: variables.icon ?? 'Box',
        color: variables.color ?? 'blue',
        organizationId: result.organizationId ?? '',
        display: {
          primaryDisplayField: null,
          secondaryDisplayField: null,
          avatarField: null,
          defaultSortField: 'updatedAt',
          defaultSortDirection: 'desc',
          orgScopingStrategy: 'direct',
        },
        fields: [],
        isVisible: true,
      }

      // Add directly to store with real ID
      store.addServerResource(serverResource)

      // Invalidate to get full server data (system fields, timestamps, etc.)
      invalidateResourceDefinitions()
    },

    onError: (error) => {
      toastError({ title: 'Failed to create entity', description: error.message })
    },
  })

  const updateEntity = api.entityDefinition.update.useMutation({
    onMutate: async (variables) => {
      const store = getResourceStoreState()
      const resource = store.resourceMap.get(variables.id)
      if (!resource) return

      // Increment version for race condition handling
      const version = store.incrementResourceVersion(variables.id)

      // Build optimistic updates from mutation variables
      const optimisticUpdates: Partial<CustomResource> = {}
      if (variables.data.singular !== undefined) optimisticUpdates.label = variables.data.singular
      if (variables.data.plural !== undefined) optimisticUpdates.plural = variables.data.plural
      if (variables.data.icon !== undefined) optimisticUpdates.icon = variables.data.icon
      if (variables.data.color !== undefined) optimisticUpdates.color = variables.data.color

      // Handle display field updates (primaryDisplayFieldId, secondaryDisplayFieldId, avatarFieldId)
      const hasDisplayFieldUpdate =
        variables.data.primaryDisplayFieldId !== undefined ||
        variables.data.secondaryDisplayFieldId !== undefined ||
        variables.data.avatarFieldId !== undefined

      if (hasDisplayFieldUpdate) {
        // Helper to build DisplayFieldConfig from field ID
        const buildDisplayFieldConfig = (
          fieldId: string | null | undefined
        ): DisplayFieldConfig | null => {
          if (fieldId === null || fieldId === undefined) return null
          const field = resource.fields.find((f) => f.id === fieldId)
          if (!field) return null
          return {
            id: field.id,
            name: field.label ?? field.key,
            type: field.fieldType ?? field.type,
          }
        }

        // Build updated display object (spread existing to preserve other properties)
        optimisticUpdates.display = {
          ...resource.display,
          ...(variables.data.primaryDisplayFieldId !== undefined && {
            primaryDisplayField: buildDisplayFieldConfig(variables.data.primaryDisplayFieldId),
          }),
          ...(variables.data.secondaryDisplayFieldId !== undefined && {
            secondaryDisplayField: buildDisplayFieldConfig(variables.data.secondaryDisplayFieldId),
          }),
          ...(variables.data.avatarFieldId !== undefined && {
            avatarField: buildDisplayFieldConfig(variables.data.avatarFieldId),
          }),
        }
      }

      // Only apply optimistic update if there are changes
      if (Object.keys(optimisticUpdates).length > 0) {
        store.setResourceOptimistic(variables.id, optimisticUpdates)
      }

      return { entityDefinitionId: variables.id, version }
    },

    onSuccess: (_result, _variables, context) => {
      if (!context) return
      const store = getResourceStoreState()

      // Check if this mutation is still relevant (not superseded by newer)
      if (context.version < store.getResourceVersion(context.entityDefinitionId)) {
        return // Stale - a newer mutation is in flight
      }

      // Confirm the update and invalidate to get fresh server data
      store.confirmResourceUpdate(context.entityDefinitionId)
      invalidateResourceDefinitions()
    },

    onError: (error, _variables, context) => {
      if (!context) return
      const store = getResourceStoreState()

      // Check if this mutation is still relevant
      if (context.version < store.getResourceVersion(context.entityDefinitionId)) {
        return // Superseded by newer mutation
      }

      store.rollbackResourceUpdate(context.entityDefinitionId)
      toastError({ title: 'Failed to update entity', description: error.message })
    },
  })

  const archiveEntity = api.entityDefinition.archive.useMutation({
    onMutate: async (variables) => {
      const store = getResourceStoreState()
      store.markResourceArchived(variables.id)
      return { entityDefinitionId: variables.id }
    },

    onSuccess: (_result, _variables, context) => {
      if (!context) return
      getResourceStoreState().confirmResourceArchive(context.entityDefinitionId)
      invalidateResourceDefinitions()
    },

    onError: (error, _variables, context) => {
      if (context) {
        getResourceStoreState().rollbackResourceArchive(context.entityDefinitionId)
      }
      toastError({ title: 'Failed to archive entity', description: error.message })
    },
  })

  const restoreEntity = api.entityDefinition.restore.useMutation({
    onMutate: async (variables) => {
      // For restore, we mark that we're expecting this resource to come back
      // The actual resource data will come from server response
      getResourceStoreState().markResourceRestored(variables.id)
      return { entityDefinitionId: variables.id }
    },

    onSuccess: (_result, _variables, context) => {
      if (!context) return
      getResourceStoreState().confirmResourceRestore(context.entityDefinitionId)
      invalidateResourceDefinitions()
    },

    onError: (error, _variables, context) => {
      if (context) {
        getResourceStoreState().rollbackResourceRestore(context.entityDefinitionId)
      }
      toastError({ title: 'Failed to restore entity', description: error.message })
    },
  })

  return {
    createEntity,
    updateEntity,
    archiveEntity,
    restoreEntity,
  }
}
