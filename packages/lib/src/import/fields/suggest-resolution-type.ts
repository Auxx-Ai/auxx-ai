// packages/lib/src/import/fields/suggest-resolution-type.ts

import { deriveRelationResolutionType } from '../resolution/relation-policy'
import type { RelationOnNoMatch, ResolutionType } from '../types/resolution'
import type { ImportableField } from './get-importable-fields'

/** The relation policy a caller has already settled on for this column */
export interface SuggestResolutionTypeOptions {
  /**
   * The target field the column matches on. Auto-map MUST pass this. A
   * relation mapping with no match field is a state only auto-map can produce,
   * and it is the state that made every auto-mapped relation column
   * unresolvable (03 §2.1), the picker's drill-down cannot commit without one.
   */
  matchField?: string | null
  /** The column's no-match policy; drives `relation:create` vs `relation:match` */
  onNoMatch?: RelationOnNoMatch
}

/**
 * Suggest the best resolution type for a field based on its type and name.
 *
 * @param field - The importable field
 * @param options - Relation policy already settled for this column, if any
 * @returns Suggested resolution type
 */
export function suggestResolutionType(
  field: ImportableField,
  options: SuggestResolutionTypeOptions = {}
): ResolutionType {
  // Check for relation fields. The type is DERIVED from the policy, hardcoding
  // `relation:match` here (and in the wizard's `handleMappingChange`) is what
  // made `relation:create` unreachable from the UI at all.
  if (field.isRelation) {
    return deriveRelationResolutionType({
      matchField: options.matchField ?? relationMatchFieldFor(field),
      onNoMatch: options.onNoMatch,
    })
  }

  // Check for enum/select fields
  if (field.options && field.options.length > 0) {
    return 'select:value'
  }

  // Map field types to resolution types
  switch (field.type) {
    case 'number':
    case 'integer':
      return 'number:integer'

    // Money is stored as INTEGER MINOR UNITS, so a decimal resolver is wrong
    // twice over: `12.34` reaches the write path as `12.34` and is rejected
    // ("CURRENCY values are integer minor units"), while `12` imports silently
    // as 12 cents. `currency:major` scales by the field's own exponent.
    case 'currency':
      return 'currency:major'

    case 'decimal':
    case 'float':
      return 'number:decimal'

    case 'date':
      return 'date:iso'

    case 'datetime':
    case 'timestamp':
      return 'datetime:iso'

    case 'boolean':
      return 'boolean:truthy'

    case 'email':
      return field.multi ? 'email:split' : 'email:value'

    case 'phone':
      return field.multi ? 'phone:split' : 'phone:value'

    // URL fields keep scheme/path — `domain:value` strips them, so the value
    // could never round-trip against the write path's `https://host/...` form.
    case 'url':
      return field.multi ? 'url:split' : 'url:value'

    case 'domain':
      return 'domain:value'

    case 'array':
    case 'tags':
      return 'array:split'

    case 'text':
    case 'string':
    default: {
      // Check for known field names that have specific types
      const key = field.key.toLowerCase()

      if (key === 'email' || key.includes('email')) {
        return field.multi ? 'email:split' : 'email:value'
      }

      if (key === 'phone' || key.includes('phone') || key.includes('mobile')) {
        return field.multi ? 'phone:split' : 'phone:value'
      }

      if (key === 'id' || key === 'externalid' || key.includes('_id')) {
        return 'text:cuid'
      }

      if (key.includes('date') || key.includes('at')) {
        return 'date:iso'
      }

      return 'text:value'
    }
  }
}

/**
 * The match field an importable relation field already knows about, if any.
 *
 * `getImportableFields` may populate `relationConfig.targetResource.displayField`
 * when the target resource was resolvable at build time. It usually is NOT
 * populated today, which is exactly why auto-map has to resolve the target and
 * call `buildRelationColumnPolicy`, see the module note on
 * {@link SuggestResolutionTypeOptions.matchField}.
 *
 * @param field - The importable relation field
 * @returns The known match field key, or undefined
 */
export function relationMatchFieldFor(field: ImportableField): string | undefined {
  return field.relationConfig?.targetResource?.displayField ?? undefined
}

/**
 * Get available resolution types for a field, SUGGESTION FIRST.
 *
 * 🛑 Takes the FIELD, not a bare type string. The previous signature could not
 * answer the select cases: `'select'` and `'multiselect'` are NOT `BaseType`
 * values — `mapFieldTypeToBaseType` sends SINGLE_SELECT to `BaseType.ENUM` and
 * MULTI_SELECT to `BaseType.ARRAY` — so those two cases matched no field that
 * has ever existed, and `select:create` was offered to nothing at all. The
 * option-bearing cases are decided by whether the field CARRIES options, the
 * same test `suggestResolutionType` already uses, so the two agree.
 *
 * 🛑 The suggestion is hoisted to the front rather than restated per case,
 * because "the column's suggested type is not in its own alternatives list" is
 * a defect this function has shipped twice: once for an options-bearing TAGS
 * column (fixed by the branch below), and once for every MULTI email / phone /
 * url field, whose suggestion is the `:split` variant that no case listed. The
 * picker reads entry 0 as "suggested" and compares the stored type against it
 * to decide whether the column is customised, so a list whose head disagrees
 * with {@link suggestResolutionType} labels a default column as customised and
 * badges the wrong row. One rule, applied once, instead of N cases kept in sync.
 *
 * @param field - The importable field
 * @returns Array of valid resolution types, the suggested one first
 */
export function getValidResolutionTypes(field: ImportableField): ResolutionType[] {
  const suggested = suggestResolutionType(field)
  const rest = validResolutionTypesFor(field).filter((type) => type !== suggested)
  return [suggested, ...rest]
}

/**
 * The types that are VALID for a field, before the suggestion is hoisted.
 *
 * @param field - The importable field
 * @returns Array of valid resolution types
 */
function validResolutionTypesFor(field: ImportableField): ResolutionType[] {
  // Option-bearing fields are keyed on the options themselves, before the
  // base-type switch: ENUM, ARRAY and TAGS all land here, and only the presence
  // of an option list separates "pick from a taxonomy" from "split a string".
  if (!field.isRelation && field.options && field.options.length > 0) {
    // TAGS and MULTI_SELECT are multi by TYPE (`BaseType.TAGS` / `BaseType.ARRAY`);
    // `field.multi` only reports `options.multi`, which covers scalar multi-value
    // fields and is false for both of those.
    const multi = field.multi || field.type === 'tags' || field.type === 'array'
    const matching: ResolutionType[] = multi
      ? ['multiselect:split', 'select:value']
      : ['select:value']
    // `select:create` is offered only where an automated writer may actually
    // grow the taxonomy — see `canGrowFieldOptions` / `fieldAllowsNewOptions`.
    // Offering it otherwise produces a column that resolves and then silently
    // fails to create anything.
    if (field.canCreateOptions) matching.push('select:create')
    return [...matching, 'array:split', 'text:value']
  }

  switch (field.type) {
    case 'number':
    case 'integer':
      return ['number:integer', 'number:decimal', 'text:value']

    // `number:integer` stays on offer for a file that ALREADY holds minor
    // units (an accounting export in cents). The labels are what keep the two
    // apart — see RESOLUTION_TYPE_LABELS.
    case 'currency':
      return ['currency:major', 'number:integer', 'text:value']

    case 'decimal':
    case 'float':
      return ['number:decimal', 'number:integer', 'text:value']

    case 'date':
      return ['date:iso', 'date:custom', 'text:value']

    case 'datetime':
    case 'timestamp':
      return ['datetime:iso', 'datetime:custom', 'date:iso', 'text:value']

    case 'boolean':
      return ['boolean:truthy', 'text:value']

    case 'email':
      return ['email:value', 'text:value']

    case 'phone':
      return ['phone:value', 'text:value']

    case 'url':
      return ['url:value', 'domain:value', 'text:value']

    case 'domain':
      return ['domain:value', 'text:value']

    // An option-bearing field never reaches here (see the early return). These
    // are the genuinely free-form ones: a TAGS field an org has not populated
    // yet, or a plain string array.
    case 'array':
    case 'tags':
    case 'enum':
      return ['array:split', 'text:value']

    case 'relation':
      return ['relation:id', 'relation:match', 'relation:create', 'text:cuid', 'text:value']

    case 'text':
    case 'string':
    default:
      return [
        'text:value',
        'text:cuid',
        'email:value',
        'phone:value',
        'number:integer',
        'number:decimal',
        'date:iso',
        'boolean:truthy',
      ]
  }
}
