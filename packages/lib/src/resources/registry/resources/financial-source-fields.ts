// packages/lib/src/resources/registry/resources/financial-source-fields.ts
import { FieldType } from '@auxx/database/enums'
import { toFieldId, toResourceFieldId } from '@auxx/types/field'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { BaseType } from '../../types'
import type { ResourceField } from '../field-types'

/**
 * Ordinary source fields shared by financial records from any writer.
 *
 * `sortOrder` defaults to `'a1'` — fine for a resource whose ENTIRE field set is
 * built from this helper (each call still collides with its siblings, but no
 * other field is there to collide WITH). A resource that also declares its own
 * fields (like `order`) must pass an explicit, unique value per call — see
 * `order-fields.ts`'s `z1`-`z8` block.
 */
export function financialSourceField(
  key: string,
  label: string,
  attribute: SystemAttribute,
  kind: 'text' | 'json' | 'boolean' | 'number' = 'text',
  sortOrder = 'a1'
): ResourceField {
  const types = {
    text: [BaseType.STRING, FieldType.TEXT],
    json: [BaseType.JSON, FieldType.JSON],
    boolean: [BaseType.BOOLEAN, FieldType.CHECKBOX],
    number: [BaseType.NUMBER, FieldType.NUMBER],
  } as const
  const [type, fieldType] = types[kind]
  return {
    id: toFieldId(key),
    key,
    label,
    type,
    fieldType,
    systemAttribute: attribute,
    isSystem: true,
    systemSortOrder: sortOrder,
    nullable: true,
    showInPanel: false,
    showInDialogs: false,
    capabilities: {
      filterable: kind !== 'json',
      sortable: kind !== 'json',
      creatable: true,
      updatable: true,
      configurable: false,
    },
  }
}

/** A standard record relationship, resolved by the normal connector relationship pass. */
export function financialSourceRelationship(
  key: string,
  label: string,
  attribute: SystemAttribute,
  resource: string,
  inverseKey: string,
  many = false,
  sortOrder = 'a1'
): ResourceField {
  return {
    ...financialSourceField(key, label, attribute, 'text', sortOrder),
    type: BaseType.RELATION,
    fieldType: FieldType.RELATIONSHIP,
    relationship: many
      ? {
          relationshipType: 'has_many',
          isInverse: true,
          onDelete: 'restrict',
          inverseResourceFieldId: toResourceFieldId(resource, inverseKey),
        }
      : {
          relationshipType: 'belongs_to',
          isInverse: false,
          inverseResourceFieldId: toResourceFieldId(resource, inverseKey),
        },
  }
}
