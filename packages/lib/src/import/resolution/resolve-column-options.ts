// packages/lib/src/import/resolution/resolve-column-options.ts

import type { SelectOption } from '@auxx/types/custom-field'
import { findCachedResource } from '../../cache'
import { getFieldOutputKey } from '../../resources/registry/field-types'
import { getFieldOptions } from '../../resources/registry/option-helpers'

/** What {@link resolveColumnOptions} needs to answer for a whole mapping */
export interface ResolveColumnOptionsInput {
  organizationId: string
  /** `ImportMapping.entityDefinitionId` — the resource every column targets */
  entityDefinitionId: string
  /** `targetFieldKey` of every column resolved with `select:*` / `multiselect:*` */
  targetFieldKeys: string[]
}

/**
 * Resolve the LIVE option list each select-ish column must match against,
 * keyed by `targetFieldKey`.
 *
 * 🛑 Resolved at RUN time, and the stored copy is not trusted. The option list
 * on a column's `resolutionConfig` is **client-asserted**: `saveMappingProperty`
 * writes whatever array the browser sent when the user picked the field, and
 * the server never checks it against the field. It is then never refreshed, so
 * every later change — the field editor, a record-side tag, another import —
 * is invisible to a mapping that already exists.
 *
 * That makes `options` a member of the same family as
 * {@link resolveColumnCurrencyCodes}' `currencyCode`: a fact about the target
 * field, not a decision the user made about the column. Facts are resolved per
 * run. Policy (`identityRole`, `mergeStrategy`, `relationConfig`) stays
 * persisted, because re-deriving THOSE would silently revert a user's choice.
 *
 * Batched deliberately: the resource is read once for the whole mapping, so a
 * 40-column file with six select columns is one cache lookup, not six.
 *
 * Returns entries only for keys that resolve to a real field carrying options;
 * a caller leaves the column's stored list in place for anything absent, which
 * is the best available answer for a field that has since vanished.
 *
 * @param input - Org, target resource, and the select columns' field keys
 * @returns Map of `targetFieldKey` → the field's current option list
 */
export async function resolveColumnOptions(
  input: ResolveColumnOptionsInput
): Promise<Map<string, SelectOption[]>> {
  const live = new Map<string, SelectOption[]>()
  if (input.targetFieldKeys.length === 0) return live

  const resource = await findCachedResource(input.organizationId, input.entityDefinitionId)
  if (!resource) return live

  const wanted = new Set(input.targetFieldKeys)
  for (const field of resource.fields) {
    const key = getFieldOutputKey(field)
    if (!wanted.has(key)) continue
    const options = getFieldOptions(field)
    if (options.length === 0) continue
    live.set(
      key,
      options.map((option) => ({
        // The key a `FieldValue` would store, matching `optionKey`'s write rule:
        // an explicit `id` wins, else `value`. Dropping the `id` here would make
        // the resolver hand back a label-shaped orphan for an id-carrying option.
        value: option.id ?? option.value,
        label: option.label ?? option.value,
        ...(option.color ? { color: option.color } : {}),
      }))
    )
  }

  return live
}
