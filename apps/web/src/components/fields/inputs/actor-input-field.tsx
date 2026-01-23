// apps/web/src/components/fields/inputs/actor-input-field.tsx

'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { ActorTarget } from '@auxx/database/enums'
import type { ActorFieldOptions } from '@auxx/types/field'
import type { ActorId, ActorType } from '@auxx/types/actor'
import { ActorPickerContent } from '~/components/pickers/actor-picker'
import { usePropertyContext } from '../property-provider'
import { useFieldNavigationOptional } from '../field-navigation-context'

/**
 * Input component for ACTOR field type.
 * Uses ActorPicker for the UI and manages save-on-close pattern.
 *
 * Pattern E: Save-on-close
 * - Local state for selection tracking
 * - Uses onBeforeClose hook for fire-and-forget save
 * - Delegates UI to ActorPickerContent component
 */
export function ActorInputField() {
  const { value, field, commitValue, onBeforeClose } = usePropertyContext()
  const nav = useFieldNavigationOptional()
  const options = field.options as ActorFieldOptions | undefined

  // Determine which actor types to show based on field options
  const types: ActorType[] = useMemo(() => {
    if (!options?.target) return ['user', 'group']
    if (options.target === ActorTarget.user) return ['user']
    if (options.target === ActorTarget.group) return ['group']
    return ['user', 'group']
  }, [options?.target])

  // Normalize value to array for picker
  // Value can be a single ActorId or an array of ActorIds
  const currentActorIds = useMemo<ActorId[]>(() => {
    if (!value) return []
    if (Array.isArray(value)) return value as ActorId[]
    return [value as ActorId]
  }, [value])

  // Track current selection in local state for save-on-close pattern
  const [localActorIds, setLocalActorIds] = useState<ActorId[]>(currentActorIds)

  // Ref to track current selection for save-on-close
  const localActorIdsRef = useRef<ActorId[]>(localActorIds)

  // Keep ref in sync with state
  useEffect(() => {
    localActorIdsRef.current = localActorIds
  }, [localActorIds])

  // Reset selection state when value prop changes from parent
  useEffect(() => {
    setLocalActorIds(currentActorIds)
    localActorIdsRef.current = currentActorIds
  }, [currentActorIds])

  // Register save handler for popover close - fire-and-forget
  useEffect(() => {
    onBeforeClose.current = () => {
      const current = localActorIdsRef.current
      const original = currentActorIds

      // Only save if selection changed
      const hasChanged =
        current.length !== original.length || current.some((id) => !original.includes(id))

      if (hasChanged) {
        // For single-select (no multiple option currently), store as single value
        // For future multi-select support, store as array
        commitValue(current.length === 1 ? current[0] : current.length === 0 ? null : current)
      }
    }
    return () => {
      onBeforeClose.current = undefined
    }
  }, [onBeforeClose, currentActorIds, commitValue])

  /**
   * Handle selection change from ActorPickerContent
   */
  const handleChange = useCallback((selected: ActorId[]) => {
    setLocalActorIds(selected)
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

  return (
    <ActorPickerContent
      value={localActorIds}
      onChange={handleChange}
      types={types}
      multi={false}
      onCaptureChange={handleCaptureChange}
      placeholder="Search..."
    />
  )
}
