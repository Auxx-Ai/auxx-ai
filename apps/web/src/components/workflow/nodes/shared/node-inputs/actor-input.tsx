// apps/web/src/components/workflow/nodes/shared/node-inputs/actor-input.tsx

'use client'

import { type ActorId, getActorRawId, isActorId, toActorId } from '@auxx/types/actor'
import { useCallback, useMemo } from 'react'
import { ActorPicker } from '~/components/pickers/actor-picker'
import { createNodeInput, type NodeInputProps } from './base-node-input'

interface ActorInputProps extends NodeInputProps {
  /** Field name */
  name: string
  /** Placeholder text */
  placeholder?: string
  /** Actor target: 'user', 'group', or 'both' */
  target?: 'user' | 'group' | 'both'
  /** Multi-select mode */
  multi?: boolean
  /** Whether to show the clear button on the picker trigger */
  showClear?: boolean
}

/**
 * Actor input for workflow nodes — wraps ActorPicker.
 * Converts between raw user/group IDs (stored in workflow data)
 * and ActorId format (used by ActorPicker).
 */
export const ActorInput = createNodeInput<ActorInputProps>(
  ({
    inputs,
    onChange,
    isLoading,
    name,
    placeholder,
    target = 'user',
    multi = false,
    showClear,
  }) => {
    const value = inputs[name] ?? ''

    /** Convert stored value (raw UUID, ActorId, or JSON array) to ActorId[] for the picker */
    const actorIds = useMemo((): ActorId[] => {
      if (!value) return []

      if (typeof value === 'string') {
        // JSON array string (e.g., '["user:abc","group:xyz"]')
        if (value.startsWith('[')) {
          try {
            const parsed = JSON.parse(value) as string[]
            return parsed.filter(isActorId) as ActorId[]
          } catch {
            return []
          }
        }
        // Already an ActorId format (e.g., "user:abc123")
        if (isActorId(value)) return [value]
        // Raw UUID — wrap as user ActorId (assignee is always a user)
        if (value.length > 0) return [toActorId(target === 'group' ? 'group' : 'user', value)]
      }

      return []
    }, [value, target])

    /** Convert ActorId[] back to stored format */
    const handleChange = useCallback(
      (selected: ActorId[]) => {
        if (multi) {
          if (target === 'both') {
            // Preserve full ActorId format when mixing users and groups
            onChange(name, selected.length > 0 ? JSON.stringify(selected) : '')
          } else {
            // Strip to raw IDs when type is known
            const ids = selected.map(getActorRawId)
            onChange(name, ids.length > 0 ? JSON.stringify(ids) : '')
          }
        } else {
          // Single select: store raw UUID
          const rawId = selected[0] ? getActorRawId(selected[0]) : ''
          onChange(name, rawId)
        }
      },
      [onChange, name, multi, target]
    )

    return (
      <ActorPicker
        value={actorIds}
        onChange={handleChange}
        target={target}
        multi={multi}
        disabled={isLoading}
        emptyLabel={placeholder ?? 'Select...'}
        triggerProps={{
          className: 'w-full pe-1 ps-0',
          showClear: showClear ?? actorIds.length > 0,
        }}
      />
    )
  }
)
