// packages/lib/src/resources/hooks/part-hooks.ts

import { PartKind } from '../registry/enum-values'
import type { SystemHook, SystemHookRegistry } from './types'

/** Kinds sold as they are; components and subassemblies are bought and built into something else. */
const SELLABLE_BY_DEFAULT: ReadonlySet<string> = new Set([PartKind.SERVICE, PartKind.FINISHED_GOOD])

/** Read a pre-coercion SINGLE_SELECT value: a bare string, a one-element array, or an option envelope. */
function readOptionValue(raw: unknown): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const inner = value as { optionId?: unknown; value?: unknown }
    if (typeof inner.optionId === 'string') return inner.optionId
    if (typeof inner.value === 'string') return inner.value
  }
  return null
}

/** Whether the part kind defaults to sellable (107 D3). Unset reads as a component. */
export function isSellableByDefault(partKind: string | null): boolean {
  return partKind != null && SELLABLE_BY_DEFAULT.has(partKind)
}

/**
 * Fill `part_sellable` from `part_kind` when a create leaves it out. It has no registry default
 * because `applyDefaults` runs first and would make an omitted value look chosen.
 */
const defaultSellableFromKind: SystemHook = async ({ operation, field, values, allFields }) => {
  if (operation !== 'create') return values

  const keys = [field.systemAttribute, field.id, field.name].filter(Boolean) as string[]
  if (keys.some((key) => key in values && values[key] != null)) return values

  const kindField = allFields.find((f) => f.systemAttribute === 'part_kind')
  const kindKeys = ['part_kind', kindField?.id, kindField?.name].filter(Boolean) as string[]
  const kindKey = kindKeys.find((key) => key in values)
  const kind = kindKey ? readOptionValue(values[kindKey]) : null

  return { ...values, part_sellable: isSellableByDefault(kind) }
}

export const PART_HOOKS: SystemHookRegistry = {
  part_sellable: [defaultSellableFromKind],
}
