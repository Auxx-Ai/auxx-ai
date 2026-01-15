// apps/web/src/components/fields/inputs/relationship-input-field.tsx

import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { usePropertyContext } from '../property-provider'
import { useFieldNavigationOptional } from '../field-navigation-context'
import { toResourceId, getRelationshipStoreState, useResourceStore } from '~/components/resources'
import { useResourceIdFromField } from '../hooks/use-resource-id-from-field'
import {
  extractRelationshipResourceIds,
  getInstanceId,
  parseResourceId,
  type ResourceId,
} from '@auxx/lib/field-values/client'
import { api } from '~/trpc/react'
import { isCustomResource } from '@auxx/lib/resources/client'
import { EntityInstanceDialog } from '~/components/custom-fields/ui/entity-instance-dialog'
import { ResourcePicker } from '~/components/pickers/resource-picker'

/**
 * Input component for RELATIONSHIP field type.
 * Uses ResourcePicker for the UI and manages save-on-close pattern.
 *
 * Pattern E: Save-on-close
 * - Local state for selection tracking
 * - Uses onBeforeClose hook for fire-and-forget save
 * - Delegates UI to ResourcePicker component
 */
export function RelationshipInputField() {
  const { value, field, commitValue, onBeforeClose, resourceId } = usePropertyContext()
  const nav = useFieldNavigationOptional()

  const relationship = field.options?.relationship
  const isSingleSelect =
    relationship?.relationshipType === 'belongs_to' || relationship?.relationshipType === 'has_one'

  // Get relatedEntityDefinitionId for storing with values
  // relatedEntityDefinitionId is the unified ID for both system and custom resources
  const relatedEntityDefinitionId = useMemo(() => {
    if (relationship?.relatedEntityDefinitionId) {
      return relationship.relatedEntityDefinitionId
    }
    console.warn('[RelationshipInputField] relatedEntityDefinitionId not found')
    return ''
  }, [relationship])

  // Determine resourceId using hook - returns { tableId, entityDefinitionId? } or null
  const resourceRef = useResourceIdFromField(field)

  // Dialog state for inline create
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)

  // Get resource by ID to determine label and if inline create is supported
  const getResourceById = useResourceStore((s) => s.getResourceById)

  // Get the related resource for label and inline create capability
  const relatedResource = useMemo(() => {
    if (!resourceRef) return null
    return getResourceById(resourceRef.entityDefinitionId)
  }, [resourceRef, getResourceById])

  // Only custom resources support inline create (system resources have dedicated flows)
  const canInlineCreate = true //relatedResource && isCustomResource(relatedResource)

  // Convert field value to ResourceId[] for ResourcePicker
  const currentResourceIds = useMemo<ResourceId[]>(() => {
    if (!resourceRef) return []
    return extractRelationshipResourceIds(value)
  }, [value, resourceRef])

  // Track current selection in local state for save-on-close pattern
  const [localResourceIds, setLocalResourceIds] = useState<ResourceId[]>(currentResourceIds)

  // Ref to track current selection for save-on-close
  const localResourceIdsRef = useRef<ResourceId[]>(localResourceIds)

  // Keep ref in sync with state
  useEffect(() => {
    localResourceIdsRef.current = localResourceIds
  }, [localResourceIds])

  // Reset selection state when value prop changes from parent
  useEffect(() => {
    setLocalResourceIds(currentResourceIds)
    localResourceIdsRef.current = currentResourceIds
  }, [currentResourceIds])

  // Register save handler for popover close - fire-and-forget
  useEffect(() => {
    onBeforeClose.current = () => {
      const currentIds = localResourceIdsRef.current.map(getInstanceId)
      const originalIds = extractRelationshipResourceIds(value).map(getInstanceId)

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
   * Handle selection change from ResourcePicker
   */
  const handleChange = useCallback((selected: ResourceId[]) => {
    setLocalResourceIds(selected)
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
    const inverseFieldId = relationship?.inverseFieldId
    if (!inverseFieldId || !resourceRef || !resourceId) {
      return undefined
    }

    // Parse parent resource info from context
    const { entityDefinitionId: parentEntityDefId, entityInstanceId: parentInstanceId } =
      parseResourceId(resourceId)

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
  }, [relationship, resourceRef, resourceId])

  // Get tRPC utils for fetching
  const utils = api.useUtils()

  /**
   * Handle newly created entity instance
   * - Fetches the new item for hydration
   * - Adds to relationship store
   * - Selects the new item
   * - Closes the dialog
   */
  const handleCreatedInstance = useCallback(
    async (instanceId: string) => {
      if (!resourceRef) return

      try {
        // Fetch the newly created item to get display info
        const newItem = await utils.resource.getById.fetch({
          entityDefinitionId: resourceRef.entityDefinitionId,
          id: instanceId,
        })

        if (newItem) {
          // Add to relationship store for immediate hydration
          const key = toResourceId(resourceRef.entityDefinitionId, instanceId)
          getRelationshipStoreState().addHydratedItems({ [key]: newItem })
        }
      } catch (error) {
        // Non-critical: item will be fetched on next hydration cycle
        console.warn('Failed to fetch newly created item:', error)
      }

      // Create the new ResourceId
      const newResourceId = toResourceId(resourceRef.entityDefinitionId, instanceId)

      // Select the new item
      if (isSingleSelect) {
        setLocalResourceIds([newResourceId])
      } else {
        setLocalResourceIds((prev) => [...prev, newResourceId])
      }

      // Close dialog
      setIsCreateDialogOpen(false)
    },
    [resourceRef, isSingleSelect, utils]
  )

  if (!resourceRef) {
    return <span className="text-muted-foreground p-2">Invalid relationship config</span>
  }

  return (
    <div className="">
      <ResourcePicker
        value={localResourceIds}
        onChange={handleChange}
        entityDefinitionId={resourceRef.entityDefinitionId}
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
          entityDefinitionId={relatedResource.entityDefinitionId!}
          onSaved={handleCreatedInstance}
          presetValues={computePresetValues()}
        />
      )}
    </div>
  )
}
