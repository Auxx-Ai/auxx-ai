// packages/lib/src/import/mapping/natural-key.ts

import { getFieldOutputKey } from '../../resources/registry/field-types'
import { getNaturalKeyFields } from '../../resources/registry/field-utils'
import type { Resource } from '../../resources/registry/types'

/**
 * The resource's declared natural key as the field keys an import mapping
 * stores in `ImportMappingProperty.targetFieldKey`, in leg order.
 *
 * One derivation for both writers. Auto-map defaults the key on for the mapping
 * it produces and `saveMappingProperty` does the same for one repaired by hand;
 * the two agreeing on which keys the tuple is IS the contract, so neither
 * re-derives it. `[]` for the resources that declare no natural key, which is
 * most of them.
 *
 * @param resource - Any resource carrying merged registry fields
 * @returns Ordered natural-key field keys, or `[]` when none is declared
 */
export function getNaturalKeyFieldKeys(resource: Resource): string[] {
  return getNaturalKeyFields(resource).map(getFieldOutputKey)
}
