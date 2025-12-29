// apps/web/src/components/custom-fields/hooks/use-custom-field.tsx

import { type ModelType } from '@auxx/lib/resources/client'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { api } from '~/trpc/react'

/** Props for useCustomField hook */
interface UseCustomFieldProps {
  modelType: ModelType
  entityDefinitionId?: string
}

/** Hook for managing custom fields */
export function useCustomField({ modelType, entityDefinitionId }: UseCustomFieldProps) {
  const utils = api.useUtils()

  // API hooks - include entityDefinitionId for custom entities
  const { data: fields, refetch, isLoading } = api.customField.getAll.useQuery({
    modelType,
    entityDefinitionId,
  })

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
      toastError({ title: 'Error creating custom field', description: error.message })
    },
  })

  const updateField = api.customField.update.useMutation({
    onSuccess: () => {
      invalidateCustomFieldQueries()
      invalidateResourceDefinitions()
      toastSuccess({
        title: 'Custom field updated',
        description: 'The custom field has been updated successfully',
      })
    },
    onError: (error) => {
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

  const updatePositions = api.customField.updatePositions.useMutation({
    onSuccess: () => {
      invalidateResourceDefinitions()
      toastSuccess({
        title: 'Custom field positions updated',
        description: 'The custom field positions have been updated successfully',
      })
    },
    onError: (error) => {
      toastError({ title: 'Error updating custom field positions', description: error.message })
    },
  })

  // Handle form submission
  // function handleSubmit(values: FieldFormValues) {
  //   if (editingFieldId) {
  //     updateField.mutate({ id: editingFieldId, ...values })
  //   } else {
  //     createField.mutate(values)
  //   }
  // }

  // Handle inline add
  // function handleAddInTable(values: FieldFormValues) {
  //   createField.mutate(values)
  // }

  // Handle edit action
  // function handleEdit(field: any) {
  //   setEditingFieldId(field.id)

  //   // Set initial values for the form
  //   setInitialValues({
  //     name: field.name,
  //     type: field.type,
  //     description: field.description || '',
  //     required: field.required,
  //     defaultValue: field.defaultValue || '',
  //     options: field.options,
  //     addressComponents: field.addressComponents,
  //   })
  // }

  // Handle delete action
  // function handleDelete(id: string) {
  //   if (confirm('Are you sure you want to delete this custom field?')) {
  //     deleteField.mutate({ id })
  //   }
  // }

  // Reset form state
  // function resetForm() {
  //   setEditingFieldId(null)
  //   setInitialValues(undefined)
  // }

  return {
    fields,
    isLoading,
    isPending: createField.isPending || updateField.isPending || deleteField.isPending,
    updatePositions,
    refetch,
    create: createField,
    update: updateField,
    destroy: deleteField,

    // reset: resetForm,
  }
}
