// packages/lib/src/field-values/converters/actor.ts

import type {
  TypedFieldValueInput,
  TypedFieldValue,
  ActorFieldValue,
  ActorFieldValueInput,
} from '@auxx/types/field-value'
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
   * - string (assumes 'user' type)
   * - { actorType: 'user' | 'group', id: string }
   * - { type?: 'user' | 'group', id: string }
   */
  toTypedInput(value: unknown): TypedFieldValueInput | null {
    if (value === null || value === undefined) {
      return null
    }

    // Handle already-typed values (pass through)
    if (typeof value === 'object' && value !== null && 'type' in value) {
      const typed = value as { type: string }
      if (typed.type === 'actor') {
        const actorValue = typed as ActorFieldValueInput
        if (!actorValue.id) return null
        return { type: 'actor', actorType: actorValue.actorType, id: actorValue.id }
      }
    }

    // Handle object with actorType and id
    if (typeof value === 'object' && value !== null) {
      const obj = value as Record<string, unknown>

      // Check for actorType or type property
      const actorType = (obj.actorType ?? obj.type) as 'user' | 'group' | undefined
      const id = obj.id as string | undefined

      if (id) {
        return {
          type: 'actor',
          actorType: actorType ?? 'user',
          id,
        }
      }
    }

    // Handle string input - assume user type
    if (typeof value === 'string' && value.trim() !== '') {
      return { type: 'actor', actorType: 'user', id: value.trim() }
    }

    return null
  },

  /**
   * Convert TypedFieldValue/Input to raw object value.
   * Returns { actorType, id } for API calls.
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
        return { actorType: actorValue.actorType, id: actorValue.id }
      }
      return null
    }

    // Handle raw object passthrough
    if (typeof value === 'object' && value !== null) {
      const obj = value as Record<string, unknown>
      if ('actorType' in obj && 'id' in obj) {
        return { actorType: obj.actorType, id: obj.id }
      }
      if ('type' in obj && 'id' in obj) {
        return { actorType: obj.type, id: obj.id }
      }
    }

    // Handle string - assume user type
    if (typeof value === 'string') {
      return { actorType: 'user', id: value }
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
