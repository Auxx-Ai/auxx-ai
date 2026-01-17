// apps/web/src/components/custom-fields/hooks/use-custom-field-mutations.tsx

import { useQueryClient } from '@tanstack/react-query'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { api } from '~/trpc/react'
import { CacheTransaction } from '~/lib/cache/cache-transaction'

/** Props for useCustomFieldMutations hook */
interface UseCustomFieldMutationsProps {
  /** Entity definition ID - system resource (e.g. 'contact') or custom entity UUID */
  entityDefinitionId: string | undefined
}

/** Hook for managing custom field mutations (create, update, delete) */
export function useCustomFieldMutations({ entityDefinitionId }: UseCustomFieldMutationsProps) {
  const utils = api.useUtils()
  const queryClient = useQueryClient()

  /** Invalidate resource definitions cache so workflow nodes get updated fields */
  const invalidateResourceDefinitions = () => {
    utils.resource.getAllResourceTypes.invalidate()
  }

  /** Invalidate all custom field queries to ensure UI is updated */
  const invalidateCustomFieldQueries = () => {
    // Invalidate both query types used by different components
    utils.customField.getAll.invalidate()
    utils.customField.getByEntityDefinition.invalidate()
  }

  const createField = api.customField.create.useMutation({
    onSuccess: () => {
      invalidateCustomFieldQueries()
      invalidateResourceDefinitions()
      toastSuccess({
        title: 'Custom field created',
        description: 'The custom field has been created successfully',
      })
    },
    onError: (error) => {
      const code = (error.data as { code?: string } | undefined)?.code
      if (code === 'DUPLICATE_FIELD_NAME') {
        toastError({ title: 'Field already exists', description: 'A field with this name already exists on this entity.' })
      } else {
        toastError({ title: 'Error creating custom field', description: error.message })
      }
    },
  })

  const updateField = api.customField.update.useMutation({
    onMutate: async (variables) => {
      // Create transaction for automatic rollback on error
      const transaction = new CacheTransaction(queryClient)

      await transaction.execute(async () => {
        // Cancel any outgoing refetches to prevent race conditions
        await utils.resource.getAllResourceTypes.cancel()

        // Optimistically update the resource cache
        utils.resource.getAllResourceTypes.setData(undefined, (oldData) => {
          if (!oldData) return oldData

          return oldData.map((resource) => {
            // Find the resource containing this field
            const fieldIndex = resource.fields.findIndex((f) => f.id === variables.id)
            if (fieldIndex === -1) return resource

            // Update the specific field with new values
            return {
              ...resource,
              fields: resource.fields.map((field) =>
                field.id === variables.id ? { ...field, ...variables } : field
              ),
            }
          })
        })
      })

      return { transaction }
    },
    onSuccess: () => {
      // Only invalidate after server confirms the update
      // This prevents the "bounce" effect from early invalidation
      invalidateCustomFieldQueries()
      invalidateResourceDefinitions()
    },
    onError: (error) => {
      // Transaction automatically rolls back the cache
      toastError({ title: 'Error updating custom field', description: error.message })
    },
  })

  const deleteField = api.customField.delete.useMutation({
    onSuccess: () => {
      invalidateCustomFieldQueries()
      invalidateResourceDefinitions()
      toastSuccess({
        title: 'Custom field deleted',
        description: 'The custom field has been deleted successfully',
      })
    },
    onError: (error) => {
      toastError({ title: 'Error deleting custom field', description: error.message })
    },
  })

  return {
    isPending: createField.isPending || updateField.isPending || deleteField.isPending,
    create: createField,
    update: updateField,
    destroy: deleteField,
  }
}
