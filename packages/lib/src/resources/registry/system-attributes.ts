// packages/lib/src/resources/registry/system-attributes.ts

import type { SystemAttribute } from '@auxx/types/system-attribute'
import type { ResourceField } from './field-types'

declare const FIELD_SHAPE: unique symbol

/**
 * A `*-fields.ts` map that remembers the literal shape it was declared with.
 *
 * Structurally it IS `Record<string, ResourceField>` — every existing consumer
 * (dynamic indexing in the data migrations, assignment into the registry map)
 * keeps compiling — and the phantom property carries the literal types
 * {@link systemAttributes} reads. A plain `Record<string, ResourceField>`
 * annotation erases them, which is why `defineResourceFields` exists.
 */
export type DeclaredResourceFields<F extends Record<string, ResourceField>> = Record<
  string,
  ResourceField
> & { readonly [FIELD_SHAPE]?: F }

/** Declare a registry field map so its system attributes stay literal-typed; the runtime value is unchanged. */
export function defineResourceFields<F extends Record<string, ResourceField>>(
  fields: F
): DeclaredResourceFields<F> {
  return fields
}

/**
 * The FieldValue-backed system attributes of a declared field map.
 *
 * A field with a `dbColumn` is a column on `EntityInstance`, not a stored value,
 * so it is not an attribute `readSystemRecords` can hand back a cell for.
 */
export type SystemAttributesOf<F> = Extract<
  {
    [K in keyof F]: F[K] extends { dbColumn: string }
      ? never
      : F[K] extends { systemAttribute: infer A }
        ? A
        : never
  }[keyof F],
  SystemAttribute
>

/**
 * The system attributes of a registry field map, for `systemFields`.
 *
 * Give it a map declared with {@link defineResourceFields}; a map annotated
 * `Record<string, ResourceField>` has no literal types left and answers
 * `never[]`, which fails at the call site rather than silently widening.
 */
export function systemAttributes<F extends Record<string, ResourceField>>(
  fields: DeclaredResourceFields<F>
): SystemAttributesOf<F>[] {
  const out = new Set<string>()
  for (const field of Object.values(fields)) {
    if (!field || field.dbColumn || !field.systemAttribute) continue
    out.add(field.systemAttribute)
  }
  return [...out] as SystemAttributesOf<F>[]
}

/**
 * The subset of a declared map's system attributes a module actually reads.
 *
 * {@link systemAttributes} fetches every attribute the def has — 36 on `order`
 * — where most reads want four. The pick is checked against the registry, so a
 * renamed attribute is a compile error rather than a silently `null` field, and
 * the result keeps the picked literals so `cell()` accepts only those names.
 */
export function pickSystemAttributes<
  F extends Record<string, ResourceField>,
  const A extends readonly SystemAttributesOf<F>[],
>(_fields: DeclaredResourceFields<F>, attributes: A): A[number][] {
  return [...attributes]
}
