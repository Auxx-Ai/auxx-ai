// apps/web/src/components/fields/hooks/use-field-view.ts
'use client'

import type { FieldViewConfig, ViewContextType } from '@auxx/lib/conditions/client'
import { isTrailingMetadataField, type ResourceField } from '@auxx/lib/resources/client'
import { useCallback, useMemo } from 'react'
import {
  useOrgFieldView,
  useViewStoreInitialized,
} from '~/components/dynamic-table/stores/store-selectors'
import { mergeFieldOrder } from '~/components/fields/merge-field-order'

interface UseFieldViewOptions {
  /** Entity definition ID (e.g., 'contact', 'ticket') */
  entityDefinitionId: string
  /** Context type for this view */
  contextType: ViewContextType
  /** All available fields (used for fallback when no view exists) */
  fields: ResourceField[]
  /** Whether to enable the query */
  enabled?: boolean
}

interface UseFieldViewReturn {
  /** Current field view config (from org default or generated) */
  config: FieldViewConfig
  /** Whether an org-wide view exists */
  hasOrgView: boolean
  /** Loading state */
  isLoading: boolean
  /** Get visible fields in configured order */
  getVisibleFields: () => ResourceField[]
  /** Get all fields in configured order (for edit mode) */
  getAllFields: () => ResourceField[]
  /** Check if a specific field is visible */
  isFieldVisible: (fieldId: string) => boolean
}

/**
 * Default visibility for a field a stored view has never seen. In dialog
 * contexts, noisy-by-default fields are hidden: inverse relationships (the
 * reverse side of a relationship pair, e.g. contact → Work Orders), fields
 * opted out via the registry's `showInDialogs: false`, and connector-declared
 * external-id fields (`CustomField.isIdentity`). Explicit `fieldVisibility`
 * entries in a stored view always win — this only governs the fallback.
 */
export function isFieldDefaultHiddenInDialogs(
  field: ResourceField,
  contextType: ViewContextType
): boolean {
  if (contextType !== 'dialog_create' && contextType !== 'dialog_edit') return false
  if (field.relationship?.isInverse) return true
  if (field.showInDialogs === false) return true
  if (field.isIdentity === true) return true
  return false
}

/**
 * Resolve a field's effective visibility for a context.
 *
 * An explicit `fieldVisibility` entry (a real user/org choice) always wins.
 * When there is no explicit entry, fall back to the registry default for the
 * context: `showInPanel === false` hides in the panel, and the dialog
 * default-hidden rule applies in create/edit dialogs. This is the single source
 * of truth used by BOTH the rendered panel list and the edit-mode toggle switch,
 * so they can never disagree (previously `isFieldVisible` ignored `showInPanel`
 * and reported every field as "on" in edit mode for the default view).
 */
export function resolveFieldVisible(
  field: ResourceField,
  contextType: ViewContextType,
  fieldVisibility: Record<string, boolean>
): boolean {
  const fieldId = field.resourceFieldId ?? field.id ?? field.key
  const explicit = fieldVisibility[fieldId]
  if (explicit !== undefined) return explicit
  if (contextType === 'panel' && field.showInPanel === false) return false
  if (isFieldDefaultHiddenInDialogs(field, contextType)) return false
  return true
}

/**
 * Hook for consuming org-wide field view configuration from the store.
 * Returns default config if no org view exists.
 */
export function useFieldView({
  entityDefinitionId,
  contextType,
  fields,
}: UseFieldViewOptions): UseFieldViewReturn {
  // Get field IDs for default config fallback
  const fieldIds = useMemo(() => fields.map((f) => f.resourceFieldId ?? f.id ?? f.key), [fields])

  // Check if store is initialized
  const initialized = useViewStoreInitialized()

  // Get field view from store (no API call)
  const view = useOrgFieldView(entityDefinitionId, contextType)
  const storedConfig = view?.config as FieldViewConfig | undefined

  // Loading if store not initialized yet
  const isLoading = !initialized

  // Compute effective config (from store or default). The default is SPARSE —
  // an empty `fieldVisibility` so each field resolves to its registry default
  // (showInPanel / dialog rule) via resolveFieldVisible, rather than being
  // forced visible. `fieldOrder` still lists every field for ordering.
  const config = useMemo((): FieldViewConfig => {
    if (storedConfig) return storedConfig
    return { fieldVisibility: {}, fieldOrder: fieldIds, showLabels: true }
  }, [storedConfig, fieldIds])

  // Whether we're using a stored org view or the generated default
  const hasOrgView = !!view

  // Fast lookup for isFieldVisible
  const fieldById = useMemo(
    () =>
      new Map<string, ResourceField>(fields.map((f) => [f.resourceFieldId ?? f.id ?? f.key, f])),
    [fields]
  )

  // The effective order: the stored `fieldOrder` merged against the live
  // baseline (`fieldIds` — CustomField.sortOrder ASC, trailing metadata
  // partitioned last server-side). Computed once here so both getters walk the
  // same array instead of re-deriving it per call.
  const groupedFieldIds = useMemo(
    () => new Set((config.fieldGroups ?? []).flatMap((group) => group.fieldIds)),
    [config.fieldGroups]
  )

  const mergedOrder = useMemo(
    () =>
      mergeFieldOrder({
        baseline: fieldIds,
        storedOrder: config.fieldOrder,
        isTrailing: (fieldId) => {
          const field = fieldById.get(fieldId)
          return field ? isTrailingMetadataField(field) : false
        },
        // A field the stored order has never seen is in no group, so it must not
        // anchor on a grouped field — that would render it inside a group's
        // block without membership and break the contiguity the group walk
        // depends on.
        isGrouped: (fieldId) => groupedFieldIds.has(fieldId),
      }),
    [fieldIds, config.fieldOrder, fieldById, groupedFieldIds]
  )

  // Get visible fields in merged order.
  // `mergedOrder` already contains every baseline field exactly once — stored
  // entries in their stored relative order, unknown fields spliced in at their
  // baseline anchor, ids for deleted fields dropped — so there is nothing to
  // append afterwards.
  // Fields with `capabilities.hidden` are excluded unconditionally — they are
  // system-internal and users must not see them in any view or configuration.
  const getVisibleFields = useCallback((): ResourceField[] => {
    const { fieldVisibility } = config

    const orderedFields: ResourceField[] = []
    for (const fieldId of mergedOrder) {
      const field = fieldById.get(fieldId)
      if (!field) continue
      if (field.capabilities.hidden) continue
      if (!resolveFieldVisible(field, contextType, fieldVisibility)) continue
      orderedFields.push(field)
    }

    return orderedFields
  }, [config, fieldById, mergedOrder, contextType])

  // Get all fields in merged order (for edit mode — includes fields the
  // user has toggled off but NOT registry-hidden fields).
  const getAllFields = useCallback((): ResourceField[] => {
    const orderedFields: ResourceField[] = []
    for (const fieldId of mergedOrder) {
      const field = fieldById.get(fieldId)
      if (!field) continue
      if (field.capabilities.hidden) continue
      orderedFields.push(field)
    }

    return orderedFields
  }, [fieldById, mergedOrder])

  // Check if a field is visible — mirrors getVisibleFields exactly so the
  // edit-mode toggle switch reflects the field's real effective visibility
  // (registry default when there's no explicit user choice), not a blanket "on".
  const isFieldVisible = useCallback(
    (fieldId: string): boolean => {
      const field = fieldById.get(fieldId)
      if (!field) return config.fieldVisibility[fieldId] !== false
      return resolveFieldVisible(field, contextType, config.fieldVisibility)
    },
    [fieldById, config, contextType]
  )

  return {
    config,
    hasOrgView,
    isLoading,
    getVisibleFields,
    getAllFields,
    isFieldVisible,
  }
}
