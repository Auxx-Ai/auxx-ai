// apps/web/src/components/fields/inputs/actor-input-field.tsx

'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type { ActorFieldOptions } from '@auxx/types/field'
import type { ActorId } from '@auxx/types/actor'
import { isActorId, toActorId } from '@auxx/types/actor'
import { ActorPickerContent } from '~/components/pickers/actor-picker'
import { usePropertyContext } from '../property-provider'
import { useFieldNavigationOptional } from '../field-navigation-context'

/** Actor value object from formatToRawValue */
interface ActorValueObject {
  actorType: 'user' | 'group'
  id: string
  actorId?: ActorId
}

/**
 * Extract ActorId from various value formats.
 * Handles: ActorId string, { actorId }, { actorType, id }
 */
function extractActorId(val: unknown): ActorId | null {
  if (!val) return null

  // Already an ActorId string
  if (typeof val === 'string' && isActorId(val)) {
    return val as ActorId
  }

  // Object with actorId field
  if (typeof val === 'object' && val !== null) {
    const obj = val as ActorValueObject
    if (obj.actorId && isActorId(obj.actorId)) {
      return obj.actorId
    }
    // Fallback: construct from actorType + id
    if (obj.actorType && obj.id) {
      return toActorId(obj.actorType, obj.id)
    }
  }

  return null
}

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
  // Field options are stored as { actor: { multiple, target, ... } }
  const options = (field.options as { actor?: ActorFieldOptions })?.actor

  // Normalize value to array for picker
  // Value can be ActorId string, object { actorType, id, actorId }, or array
  const currentActorIds = useMemo<ActorId[]>(() => {
    if (!value) return []

    // Handle array of values
    if (Array.isArray(value)) {
      return value.map(extractActorId).filter((id): id is ActorId => id !== null)
    }

    // Handle single value
    const actorId = extractActorId(value)
    return actorId ? [actorId] : []
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
  const isMultiple = options?.multiple ?? false
  useEffect(() => {
    onBeforeClose.current = () => {
      const current = localActorIdsRef.current
      const original = currentActorIds

      // Only save if selection changed
      const hasChanged =
        current.length !== original.length || current.some((id) => !original.includes(id))

      if (hasChanged) {
        if (isMultiple) {
          // Multi-select: always pass array (even empty) for DELETE+INSERT strategy
          commitValue(current.length === 0 ? null : current)
        } else {
          // Single-select: unwrap to single value
          commitValue(current.length === 0 ? null : current[0])
        }
      }
    }
    return () => {
      onBeforeClose.current = undefined
    }
  }, [onBeforeClose, currentActorIds, commitValue, isMultiple])

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
      target={options?.target}
      multi={options?.multiple ?? false}
      onCaptureChange={handleCaptureChange}
      placeholder="Search..."
    />
  )
}
