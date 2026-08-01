// apps/web/src/components/fields/hooks/use-toggle-field-visibility.ts
'use client'

import type { FieldViewConfig, ViewContextType } from '@auxx/lib/conditions/client'
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
  const setInitialized = useDynamicTableStore((s) => s.setInitialized)
  const utils = api.useUtils()

  // Mutation for updating an existing view. The optimistic update and its
  // rollback live in `toggle` (below) rather than in `onMutate`/`onError`:
  // `tableView.update` has no `resourceFieldId`/`visible` input — they were
  // being smuggled through the router's `.passthrough()` and ignored server-side
  // purely to carry rollback state. `toggle` already has both in scope.
  const updateView = api.tableView.update.useMutation()

  // Mutation for creating new view (lazy creation when no view exists)
  const createView = api.tableView.create.useMutation({
    onSuccess: (newView) => {
      // Add the newly created view to the store
      addView(newView)
    },
    onError: async (error) => {
      // Most common cause: a default view already exists server-side but this
      // tab's store is stale (e.g. views seeded by a migration after the store
      // hydrated) — the insert then trips the one-default-per-context unique
      // index. Rehydrate so the next toggle finds the view and updates it.
      await utils.tableView.listAll.invalidate()
      setInitialized(false)
      toastError({
        title: 'Failed to save field view',
        description: `${error.message}. Views have been refreshed — please try again.`,
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
        // View exists - update it. `TableView.config` is typed as the table
        // `ViewConfig`, but panel/dialog views store a `FieldViewConfig` in the
        // same column (the router's input accepts either) — hence the widening
        // hop. See the burndown referral on `TableView.config`.
        const config = view.config as unknown as FieldViewConfig | undefined
        const previousVisible = config?.fieldVisibility?.[resourceFieldId] ?? true

        toggleFieldVisibility(entityDefinitionId, contextType, resourceFieldId, visible)

        // `fieldOrder`/`showLabels` are required by `fieldViewConfigSchema`; fall
        // back rather than sending a config the router would reject outright.
        const nextConfig: FieldViewConfig = {
          ...config,
          fieldVisibility: { ...config?.fieldVisibility, [resourceFieldId]: visible },
          fieldOrder: config?.fieldOrder ?? fieldIds,
          showLabels: config?.showLabels ?? true,
        }

        updateView.mutate(
          { id: view.id, config: nextConfig },
          {
            onError: (error) => {
              toggleFieldVisibility(
                entityDefinitionId,
                contextType,
                resourceFieldId,
                previousVisible
              )
              toastError({ title: 'Failed to update visibility', description: error.message })
            },
          }
        )
      } else {
        // No view exists - create one storing ONLY this field's choice.
        // The config is sparse: every other field keeps resolving to its
        // registry default (showInPanel / dialog rule) via resolveFieldVisible,
        // so toggling one field no longer snapshots all fields as visible.
        const configWithChange: FieldViewConfig = {
          fieldVisibility: { [resourceFieldId]: visible },
          fieldOrder: fieldIds,
          showLabels: true,
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
    [view, fieldIds, entityDefinitionId, contextType, updateView, createView, toggleFieldVisibility]
  )

  return { toggle, isPending: updateView.isPending || createView.isPending }
}
