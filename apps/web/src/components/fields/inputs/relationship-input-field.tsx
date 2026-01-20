// apps/web/src/components/fields/inputs/relationship-input-field.tsx

import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { usePropertyContext } from '../property-provider'
import { useFieldNavigationOptional } from '../field-navigation-context'
import { toRecordId, getRelationshipStoreState, useResource } from '~/components/resources'
import {
  extractRelationshipRecordIds,
  getInstanceId,
  parseRecordId,
  type RecordId,
} from '@auxx/lib/field-values/client'
import {
  getRelatedEntityDefinitionId,
  getInverseFieldId,
  type RelationshipConfig,
} from '@auxx/types/custom-field'
import { EntityInstanceDialog } from '~/components/custom-fields/ui/entity-instance-dialog'
import { RecordPicker } from '~/components/pickers/record-picker'
import { isSingleRelationship } from '@auxx/utils'

/**
 * Input component for RELATIONSHIP field type.
 * Uses RecordPicker for the UI and manages save-on-close pattern.
 *
 * Pattern E: Save-on-close
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
  }, [currentRecordIds])

  // Register save handler for popover close - fire-and-forget
  useEffect(() => {
    onBeforeClose.current = () => {
      const currentIds = localRecordIdsRef.current.map(getInstanceId)
      const originalIds = extractRelationshipRecordIds(value).map(getInstanceId)

      // Only save if selection changed
      const hasChanged =
        currentIds.length !== originalIds.length ||
        currentIds.some((id) => !originalIds.includes(id))

      if (hasChanged) {
        // Wrap IDs with relatedEntityDefinitionId for proper storage
        const values = currentIds.map((id) => ({
          relatedEntityId: id,
          relatedEntityDefinitionId,
        }))
        commitValue(values)
      }
    }
    return () => {
      onBeforeClose.current = undefined
    }
  }, [onBeforeClose, value, commitValue, relatedEntityDefinitionId])

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

    // Parse parent resource info from context
    const { entityDefinitionId: parentEntityDefId, entityInstanceId: parentInstanceId } =
      parseRecordId(recordId)

    if (!parentInstanceId) {
      return undefined
    }

    // Return preset value in relationship field format
    // Format: array of { relatedEntityId, relatedEntityDefinitionId } objects
    return {
      [inverseFieldId]: [
        {
          relatedEntityId: parentInstanceId,
          relatedEntityDefinitionId: parentEntityDefId,
        },
      ],
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
      } else {
        setLocalRecordIds((prev) => [...prev, newRecordId])
      }

      setIsCreateDialogOpen(false)
    },
    [relatedEntityDefinitionId, isSingleSelect]
  )

  if (!relatedEntityDefinitionId) {
    return <span className="text-muted-foreground p-2">Invalid relationship config</span>
  }

  return (
    <div className="">
      <RecordPicker
        value={localRecordIds}
        onChange={handleChange}
        entityDefinitionId={relatedEntityDefinitionId}
        multi={!isSingleSelect}
        onCaptureChange={handleCaptureChange}
        canCreate={canInlineCreate}
        onCreate={handleOpenCreateDialog}
        createLabel={`Create ${relatedResource?.label ?? 'Item'}`}
        placeholder="Search..."
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
