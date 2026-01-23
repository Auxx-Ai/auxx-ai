// packages/lib/src/field-values/converters/actor.ts

import type {
  TypedFieldValueInput,
  TypedFieldValue,
  ActorFieldValue,
  ActorFieldValueInput,
} from '@auxx/types/field-value'
import type { ActorId } from '@auxx/types/actor'
import { isActorId, parseActorId, toActorId } from '@auxx/types/actor'
import type { FieldValueConverter, FieldOptions } from './index'

/**
 * Converter for ACTOR field type.
 *
 * ACTOR fields reference a user or group (entity group).
 * - For 'user' type: stores in actorId column (references User.id)
 * - For 'group' type: stores in relatedEntityId/relatedEntityDefinitionId columns
 */
export const actorConverter: FieldValueConverter = {
  /**
   * Convert raw input to TypedFieldValueInput.
   * Accepts various input formats:
   * - ActorId string (e.g., "user:abc123" or "group:xyz789")
   * - string (raw ID, assumes 'user' type)
   * - { actorType: 'user' | 'group', id: string }
   * - { type?: 'user' | 'group', id: string }
   */
  toTypedInput(value: unknown): TypedFieldValueInput | null {
    if (value === null || value === undefined) {
      return null
    }

    // Handle already-typed values (pass through, but ensure id is raw)
    if (typeof value === 'object' && value !== null && 'type' in value) {
      const typed = value as { type: string }
      if (typed.type === 'actor') {
        const actorValue = typed as ActorFieldValueInput
        if (!actorValue.id) return null
        // Parse id if it's in ActorId format
        const rawId = isActorId(actorValue.id) ? parseActorId(actorValue.id as ActorId).id : actorValue.id
        return { type: 'actor', actorType: actorValue.actorType, id: rawId }
      }
    }

    // Handle object with actorType and id
    if (typeof value === 'object' && value !== null) {
      const obj = value as Record<string, unknown>

      // Check for actorType or type property
      const actorType = (obj.actorType ?? obj.type) as 'user' | 'group' | undefined
      const id = obj.id as string | undefined

      if (id) {
        // Parse id if it's in ActorId format
        const rawId = isActorId(id) ? parseActorId(id as ActorId).id : id
        return {
          type: 'actor',
          actorType: actorType ?? 'user',
          id: rawId,
        }
      }
    }

    // Handle string input
    if (typeof value === 'string' && value.trim() !== '') {
      const trimmed = value.trim()

      // Check if it's an ActorId format (e.g., "user:abc123")
      if (isActorId(trimmed)) {
        const { type, id } = parseActorId(trimmed as ActorId)
        return { type: 'actor', actorType: type, id }
      }

      // Plain string - assume user type with raw ID
      return { type: 'actor', actorType: 'user', id: trimmed }
    }

    return null
  },

  /**
   * Convert TypedFieldValue/Input to raw object value.
   * Returns { actorType, id, actorId } for API calls.
   */
  toRawValue(value: TypedFieldValue | TypedFieldValueInput | unknown): unknown {
    if (value === null || value === undefined) {
      return null
    }

    // Handle TypedFieldValue or TypedFieldValueInput
    if (typeof value === 'object' && value !== null && 'type' in value) {
      const typed = value as { type: string }
      if (typed.type === 'actor') {
        const actorValue = typed as ActorFieldValue | ActorFieldValueInput
        // Use existing actorId if available, otherwise generate it
        const actorId =
          'actorId' in actorValue && actorValue.actorId
            ? actorValue.actorId
            : toActorId(actorValue.actorType, actorValue.id)
        return { actorType: actorValue.actorType, id: actorValue.id, actorId }
      }
      return null
    }

    // Handle raw object passthrough
    if (typeof value === 'object' && value !== null) {
      const obj = value as Record<string, unknown>
      if ('actorType' in obj && 'id' in obj) {
        const actorType = obj.actorType as 'user' | 'group'
        const id = obj.id as string
        const actorId = obj.actorId ?? toActorId(actorType, id)
        return { actorType, id, actorId }
      }
      if ('type' in obj && 'id' in obj) {
        const actorType = obj.type as 'user' | 'group'
        const id = obj.id as string
        const actorId = obj.actorId ?? toActorId(actorType, id)
        return { actorType, id, actorId }
      }
    }

    // Handle string - assume user type
    if (typeof value === 'string') {
      return { actorType: 'user', id: value, actorId: toActorId('user', value) }
    }

    return null
  },

  /**
   * Convert TypedFieldValue to display string.
   * Returns the display name if available, otherwise the ID.
   */
  toDisplayValue(value: TypedFieldValue, _displayOptions?: FieldOptions): string {
    if (!value) {
      return ''
    }

    const typed = value as ActorFieldValue
    if (typed.type !== 'actor') {
      return ''
    }

    // Return displayName if available, otherwise the ID
    return typed.displayName ?? typed.id ?? ''
  },
}
