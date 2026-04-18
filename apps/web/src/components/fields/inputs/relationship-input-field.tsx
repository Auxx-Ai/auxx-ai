// apps/web/src/components/fields/inputs/relationship-input-field.tsx

import {
  extractRelationshipRecordIds,
  getInstanceId,
  parseRecordId,
  type RecordId,
} from '@auxx/lib/field-values/client'
import {
  getInverseFieldId,
  getRelatedEntityDefinitionId,
  isSelfReferentialRelationship,
  type RelationshipConfig,
} from '@auxx/types/custom-field'
import { toResourceFieldId } from '@auxx/types/field'
import { isSingleRelationship } from '@auxx/utils'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EntityInstanceDialog } from '~/components/custom-fields/ui/entity-instance-dialog'
import { RecordPickerContent } from '~/components/pickers/record-picker'
import { getRelationshipStoreState, toRecordId, useResource } from '~/components/resources'
import { api } from '~/trpc/react'
import { useFieldNavigationOptional } from '../field-navigation-context'
import { usePropertyContext } from '../property-provider'

/**
 * Input component for RELATIONSHIP field type.
 * Uses RecordPicker for the UI and manages save-on-close pattern.
 *
 * Save-on-close
 * - Local state for selection tracking
 * - Uses onBeforeClose hook for fire-and-forget save
 * - Delegates UI to RecordPicker component
 */
export function RelationshipInputField() {
  const { value, field, commitValue, onBeforeClose, recordId } = usePropertyContext()
  const nav = useFieldNavigationOptional()

  const relationship = field.options?.relationship as RelationshipConfig | undefined
  const isSingleSelect = isSingleRelationship(relationship?.relationshipType)

  // Get relatedEntityDefinitionId for storing with values
  // Derived from inverseResourceFieldId using helper function
  const relatedEntityDefinitionId = useMemo(() => {
    if (!relationship) return ''
    const id = getRelatedEntityDefinitionId(relationship)
    if (!id) {
      console.warn('[RelationshipInputField] relatedEntityDefinitionId not found')
      return ''
    }
    return id
  }, [relationship])

  const { resource: relatedResource } = useResource(relatedEntityDefinitionId)

  // Detect if this is a self-referential relationship
  const isSelfReferential = useMemo(() => {
    if (!relationship || !recordId) return false
    const { entityDefinitionId } = parseRecordId(recordId)
    return isSelfReferentialRelationship(entityDefinitionId, relationship)
  }, [relationship, recordId])

  // Build ResourceFieldId for the parent field (e.g., "tag:parent")
  const resourceFieldId = useMemo(() => {
    if (!isSelfReferential || !field.key || !recordId) return undefined
    const { entityDefinitionId } = parseRecordId(recordId)
    return toResourceFieldId(entityDefinitionId, field.key)
  }, [isSelfReferential, field.key, recordId])

  // Fetch descendants for self-referential exclusion
  // Returns RecordIds of all descendants (e.g., ["tag:child1", "tag:child2"])
  const { data: descendantRecordIds } = api.record.getDescendantRecordIds.useQuery(
    {
      recordId: recordId!,
      resourceFieldId: resourceFieldId!,
    },
    {
      enabled: isSelfReferential && !!recordId && !!resourceFieldId,
      staleTime: 30_000,
    }
  )

  // Combine excludeRecordIds: self + descendants
  const excludeRecordIds = useMemo(() => {
    const ids: RecordId[] = []

    // Exclude self
    if (isSelfReferential && recordId) {
      ids.push(recordId)
    }

    // Exclude descendants
    if (descendantRecordIds) {
      for (const id of descendantRecordIds) {
        ids.push(id as RecordId)
      }
    }

    return ids
  }, [isSelfReferential, recordId, descendantRecordIds])

  // Dialog state for inline create
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)

  // Only custom resources support inline create (system resources have dedicated flows)
  const canInlineCreate = true

  // Convert field value to RecordId[] for RecordPicker
  const currentRecordIds = useMemo<RecordId[]>(() => {
    if (!relatedEntityDefinitionId) return []
    return extractRelationshipRecordIds(value)
  }, [value, relatedEntityDefinitionId])

  // Track current selection in local state for save-on-close pattern
  const [localRecordIds, setLocalRecordIds] = useState<RecordId[]>(currentRecordIds)

  // RecordIds created inline while the picker is open. Passed as `pinnedSelectedIds`
  // so the new record appears in the Selected section even though it's not in the
  // picker's mount snapshot or the current search results.
  const [createdRecordIds, setCreatedRecordIds] = useState<RecordId[]>([])

  // Ref to track current selection for save-on-close
  const localRecordIdsRef = useRef<RecordId[]>(localRecordIds)

  // Keep ref in sync with state
  useEffect(() => {
    localRecordIdsRef.current = localRecordIds
  }, [localRecordIds])

  // Reset selection state when value prop changes from parent
  useEffect(() => {
    setLocalRecordIds(currentRecordIds)
    localRecordIdsRef.current = currentRecordIds
    setCreatedRecordIds([])
  }, [currentRecordIds])

  // Register save handler for popover close - fire-and-forget
  useEffect(() => {
    onBeforeClose.current = () => {
      const currentRecordIds = localRecordIdsRef.current
      const originalRecordIds = extractRelationshipRecordIds(value)

      // Only save if selection changed (compare instance IDs)
      const currentIds = currentRecordIds.map(getInstanceId)
      const originalIds = originalRecordIds.map(getInstanceId)
      const hasChanged =
        currentIds.length !== originalIds.length ||
        currentIds.some((id) => !originalIds.includes(id))

      if (hasChanged) {
        // Pass RecordIds directly - converter handles wrapping
        commitValue(currentRecordIds)
      }
    }
    return () => {
      onBeforeClose.current = undefined
    }
  }, [onBeforeClose, value, commitValue])

  /**
   * Handle selection change from RecordPicker
   */
  const handleChange = useCallback((selected: RecordId[]) => {
    setLocalRecordIds(selected)
  }, [])

  /**
   * Handle arrow key capture state changes
   */
  const handleCaptureChange = useCallback(
    (capturing: boolean) => {
      nav?.setPopoverCapturing(capturing)
    },
    [nav]
  )

  /**
   * Open the create dialog for inline entity creation
   */
  const handleOpenCreateDialog = useCallback(() => {
    setIsCreateDialogOpen(true)
  }, [])

  /**
   * Compute preset values for the inverse relationship field.
   * When creating a new related entity, automatically link back to the parent.
   */
  const computePresetValues = useCallback((): Record<string, unknown> | undefined => {
    // Only preset if we have an inverse relationship configured
    const inverseFieldId = relationship ? getInverseFieldId(relationship) : null
    if (!inverseFieldId || !relatedEntityDefinitionId || !recordId) {
      return undefined
    }

    // Return preset value as RecordId array - the new format
    return {
      [inverseFieldId]: [recordId],
    }
  }, [relationship, relatedEntityDefinitionId, recordId])

  /**
   * Handle newly created entity instance.
   * Requests hydration and selects the new item.
   */
  const handleCreatedInstance = useCallback(
    (instanceId: string) => {
      if (!relatedEntityDefinitionId) return

      const newRecordId = toRecordId(relatedEntityDefinitionId, instanceId)

      // Request hydration - store will batch fetch for display
      getRelationshipStoreState().requestHydration([newRecordId])

      // Select the new item
      if (isSingleSelect) {
        setLocalRecordIds([newRecordId])
        setCreatedRecordIds([newRecordId])
      } else {
        setLocalRecordIds((prev) => [...prev, newRecordId])
        setCreatedRecordIds((prev) => (prev.includes(newRecordId) ? prev : [...prev, newRecordId]))
      }

      setIsCreateDialogOpen(false)
    },
    [relatedEntityDefinitionId, isSingleSelect]
  )

  if (!relatedEntityDefinitionId) {
    return <span className='text-muted-foreground p-2'>Invalid relationship config</span>
  }

  return (
    <div className=''>
      <RecordPickerContent
        value={localRecordIds}
        onChange={handleChange}
        entityDefinitionId={relatedEntityDefinitionId}
        multi={!isSingleSelect}
        onCaptureChange={handleCaptureChange}
        canCreate={canInlineCreate}
        onCreate={handleOpenCreateDialog}
        createLabel={`Create ${relatedResource?.label ?? 'Item'}`}
        placeholder='Search...'
        excludeIds={excludeRecordIds}
        pinnedSelectedIds={createdRecordIds}
      />

      {/* Inline Create Dialog */}
      {canInlineCreate && relatedResource && (
        <EntityInstanceDialog
          open={isCreateDialogOpen}
          onOpenChange={setIsCreateDialogOpen}
          entityDefinitionId={relatedEntityDefinitionId!}
          onSaved={handleCreatedInstance}
          presetValues={computePresetValues()}
        />
      )}
    </div>
  )
}
