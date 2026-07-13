// apps/web/src/components/money/catalog-group-types.ts

// Client-side types for `catalog_group` entries (product bundles,
// plans/dispatch/money/09-product-groups.md). Nothing server-side reads the
// entries array in v1 — the explode runs in the line builder — so these live
// here instead of `@auxx/lib/money/client`; promote later if that changes.

import { generateId } from '@auxx/utils'

/** One row of a catalog group. Lives in `catalog_group_entries` (JSON field). */
export interface CatalogGroupEntry {
  /** `generateId('cge')` — stable identity for edit/reorder (the fieldMappings entry-array convention). */
  id: string
  /** EntityInstance id of the referenced `catalog_item` (NOT the branded RecordId). */
  catalogItemId: string
  /** Preset quantity, default 1. */
  qty: number
  /** Overrides the item's default description on insert. */
  description?: string | null
  /** Overrides the item's taxable flag on insert; absent = inherit from the item. */
  taxable?: boolean
}

/** New entry for a picked catalog item, qty 1, no overrides. */
export function newCatalogGroupEntry(catalogItemId: string): CatalogGroupEntry {
  return { id: generateId('cge'), catalogItemId, qty: 1 }
}

/**
 * Field-value payload for `catalog_group_entries`. The array is wrapped in an
 * object envelope because the generic field-value save path splits top-level
 * arrays into one row per element (multi-value convention,
 * field-value-mutations.ts) — a bare array would not round-trip.
 */
export function serializeCatalogGroupEntries(entries: CatalogGroupEntry[]): {
  entries: CatalogGroupEntry[]
} {
  return { entries }
}

function isCatalogGroupEntry(entry: unknown): entry is CatalogGroupEntry {
  return (
    !!entry &&
    typeof entry === 'object' &&
    typeof (entry as CatalogGroupEntry).id === 'string' &&
    typeof (entry as CatalogGroupEntry).catalogItemId === 'string' &&
    typeof (entry as CatalogGroupEntry).qty === 'number'
  )
}

/**
 * Defensively parse a raw `catalog_group_entries` field value into a valid
 * entries array. Handles the `{ entries: [...] }` envelope (the storage shape),
 * bare arrays, JSON strings, one-element-array read wrappers, and the
 * `{ type: 'json', value }` typed-value shape. Rows missing the required shape
 * are dropped — dangling `catalogItemId`s are kept (the editor surfaces them as
 * "Deleted item" rows; the explode skips them).
 */
export function parseCatalogGroupEntries(raw: unknown): CatalogGroupEntry[] {
  let value: unknown = raw
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return []
    }
  }
  // Unwrap envelope/wrapper layers until we hit the entries array itself.
  for (let depth = 0; depth < 4; depth++) {
    if (Array.isArray(value)) {
      if (value.length === 0 || value.some(isCatalogGroupEntry)) break
      if (value.length === 1) {
        value = value[0]
        continue
      }
      break
    }
    if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>
      if ('entries' in obj) {
        value = obj.entries
        continue
      }
      if (obj.type === 'json' && 'value' in obj) {
        value = obj.value
        continue
      }
    }
    break
  }
  if (!Array.isArray(value)) return []
  return value.filter(isCatalogGroupEntry)
}
