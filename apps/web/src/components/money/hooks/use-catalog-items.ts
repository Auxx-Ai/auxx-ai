// apps/web/src/components/money/hooks/use-catalog-items.ts

import type { LineItemUnit } from '@auxx/lib/money/client'
import type { RecordId } from '@auxx/lib/resources/client'
import { useMemo } from 'react'
import {
  type AllRecordsItem,
  type FieldInfo,
  useAllRecords,
} from '~/components/resources/hooks/use-all-records'
import type { RecordMeta } from '~/components/resources/store/record-store'

/** Catalog item record shape from `useAllRecords` (systemAttribute-keyed field values). */
export interface CatalogItemRecord extends RecordMeta {
  fieldValues: {
    catalog_item_name?: string
    catalog_item_description?: string | null
    catalog_item_category?: string | string[]
    catalog_item_default_unit_price?: number | null
    catalog_item_default_unit?: string | string[] | null
    catalog_item_taxable?: boolean
    catalog_item_active?: boolean
    catalog_item_part?: RecordId | RecordId[] | null
    catalog_item_cost?: number | null
    catalog_item_markup?: number | null
  }
}

/** Simplified catalog item for UI consumption — SINGLE_SELECT/relation values unwrapped. */
export interface CatalogItem {
  id: string
  recordId: RecordId
  name: string
  description: string | null
  category: string
  /** Stored in cents, matching the CURRENCY field-value convention. */
  defaultUnitPriceCents: number | null
  /** Fixed unit list (money plan 13 §1) — `null` means unitized pricing is off. */
  defaultUnit: LineItemUnit | null
  taxable: boolean
  active: boolean
  partRecordId: RecordId | null
  /** Synced from the linked part's cost by the pricing engine — read-only (money plan 17). */
  cost: number | null
  /** Markup rate as a percentage of cost — `null` pauses auto-pricing (money plan 17). */
  markup: number | null
}

/**
 * `useAllRecords` surfaces SINGLE_SELECT (and some relationship) values as
 * one-element arrays — unwrap so scalar-typed consumers compare correctly.
 * See CLAUDE.md memory: "SINGLE_SELECT field values are ARRAYS".
 */
function scalarValue<T>(value: T | T[] | null | undefined): T | undefined {
  if (Array.isArray(value)) return value[0]
  return value ?? undefined
}

function toCatalogItem(record: CatalogItemRecord): CatalogItem {
  return {
    id: record.id,
    recordId: record.recordId,
    name: record.fieldValues.catalog_item_name ?? record.displayName ?? 'Untitled',
    description: record.fieldValues.catalog_item_description ?? null,
    category: scalarValue(record.fieldValues.catalog_item_category) ?? 'service',
    defaultUnitPriceCents: record.fieldValues.catalog_item_default_unit_price ?? null,
    defaultUnit:
      (scalarValue(record.fieldValues.catalog_item_default_unit) as LineItemUnit | undefined) ??
      null,
    taxable: record.fieldValues.catalog_item_taxable ?? true,
    active: record.fieldValues.catalog_item_active ?? true,
    partRecordId: scalarValue(record.fieldValues.catalog_item_part) ?? null,
    cost: record.fieldValues.catalog_item_cost ?? null,
    markup: record.fieldValues.catalog_item_markup ?? null,
  }
}

interface UseCatalogItemsResult {
  /** All catalog items, active and inactive. */
  items: CatalogItem[]
  /** Lookup by entity instance id (not the branded RecordId). */
  itemMap: Map<string, CatalogItem>
  /** Resolved entityDefinitionId UUID for `catalog_item`, once loaded. */
  entityDefinitionId: string | null
  /** Field key → { id, key, type } map, for resolving fieldIds when saving. */
  fields: Record<string, FieldInfo>
  isLoading: boolean
  refresh: () => void
  /** Append a freshly created item into the `listAll` cache — skips a refetch. */
  appendRecord: (item: AllRecordsItem) => void
  /** Remove a deleted item from the `listAll` cache — skips a refetch. */
  removeRecord: (id: string) => void
}

/**
 * Fetch every catalog item (Products & Services, hidden `catalog_item` system
 * entity) via the generic record system. Same "small dataset, no pagination"
 * shape as `useInboxes`/`useTagHierarchy` — the catalog settings page is the
 * only consumer, so this lives under `money/hooks` rather than `resources`.
 */
export function useCatalogItems(): UseCatalogItemsResult {
  const { records, entityDefinitionId, fields, isLoading, refresh, appendRecord, removeRecord } =
    useAllRecords<CatalogItemRecord>({
      apiSlug: 'catalog-items',
      includeArchived: false,
    })

  const { items, itemMap } = useMemo(() => {
    const list = records.map(toCatalogItem)
    return { items: list, itemMap: new Map(list.map((item) => [item.id, item])) }
  }, [records])

  return {
    items,
    itemMap,
    entityDefinitionId,
    fields,
    isLoading,
    refresh,
    appendRecord,
    removeRecord,
  }
}
