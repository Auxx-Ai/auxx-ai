// apps/web/src/components/fields/hooks/use-toggle-field-visibility.ts
'use client'

import type { FieldViewConfig, ViewContextType } from '@auxx/lib/conditions'
import { createDefaultFieldViewConfig } from '@auxx/lib/conditions'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback } from 'react'
import { useDynamicTableStore } from '~/components/dynamic-table/stores/dynamic-table-store'
import { useOrgFieldView } from '~/components/dynamic-table/stores/store-selectors'
import { api } from '~/trpc/react'

interface UseToggleFieldVisibilityOptions {
  /** Entity definition ID (e.g., 'contact', 'ticket') */
  entityDefinitionId: string
  /** Context type for this view */
  contextType: ViewContextType
  /** All field IDs - needed to create default config if no view exists */
  fieldIds: string[]
}

/**
 * Hook for toggling field visibility in a field view.
 * If no view exists, creates one on first toggle (lazy creation).
 * Performs optimistic update to store, then persists to server.
 */
export function useToggleFieldVisibility({
  entityDefinitionId,
  contextType,
  fieldIds,
}: UseToggleFieldVisibilityOptions) {
  const view = useOrgFieldView(entityDefinitionId, contextType)
  const toggleFieldVisibility = useDynamicTableStore((s) => s.toggleFieldVisibility)
  const addView = useDynamicTableStore((s) => s.addView)

  // Mutation for updating existing view
  const updateView = api.tableView.update.useMutation({
    onMutate: async ({
      resourceFieldId,
      visible,
    }: {
      resourceFieldId: string
      visible: boolean
    }) => {
      // Save previous state for rollback
      const config = view?.config as FieldViewConfig | undefined
      const previousVisible = config?.fieldVisibility?.[resourceFieldId] ?? true

      // Optimistic update
      toggleFieldVisibility(entityDefinitionId, contextType, resourceFieldId, visible)

      return { resourceFieldId, previousVisible }
    },
    onError: (error, _variables, context) => {
      // Rollback
      if (context) {
        toggleFieldVisibility(
          entityDefinitionId,
          contextType,
          context.resourceFieldId,
          context.previousVisible
        )
      }
      toastError({
        title: 'Failed to update visibility',
        description: error.message,
      })
    },
  })

  // Mutation for creating new view (lazy creation when no view exists)
  const createView = api.tableView.create.useMutation({
    onSuccess: (newView) => {
      // Add the newly created view to the store
      addView(newView)
    },
    onError: (error) => {
      toastError({
        title: 'Failed to create field view',
        description: error.message,
      })
    },
  })

  /**
   * Toggle visibility for a specific field.
   * Creates a new view if none exists.
   */
  const toggle = useCallback(
    (resourceFieldId: string, visible: boolean) => {
      if (view) {
        // View exists - update it
        const config = view.config as FieldViewConfig
        updateView.mutate({
          id: view.id,
          resourceFieldId,
          visible,
          config: {
            ...config,
            fieldVisibility: {
              ...config.fieldVisibility,
              [resourceFieldId]: visible,
            },
          },
        })
      } else {
        // No view exists - create one with the visibility change
        const defaultConfig = createDefaultFieldViewConfig(fieldIds)
        const configWithChange: FieldViewConfig = {
          ...defaultConfig,
          fieldVisibility: {
            ...defaultConfig.fieldVisibility,
            [resourceFieldId]: visible,
          },
        }

        createView.mutate({
          tableId: entityDefinitionId,
          name: 'Default Panel View',
          contextType,
          isShared: true,
          isDefault: true,
          config: configWithChange,
        })
      }
    },
    [view, fieldIds, entityDefinitionId, contextType, updateView, createView]
  )

  return { toggle, isPending: updateView.isPending || createView.isPending }
}
