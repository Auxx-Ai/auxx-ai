// apps/web/src/components/money/hooks/use-catalog-groups.ts

import type { RecordId } from '@auxx/lib/resources/client'
import { useMemo } from 'react'
import {
  type CatalogGroupEntry,
  parseCatalogGroupEntries,
} from '~/components/money/catalog-group-types'
import { type FieldInfo, useAllRecords } from '~/components/resources/hooks/use-all-records'
import type { RecordMeta } from '~/components/resources/store/record-store'

/** Catalog group record shape from `useAllRecords` (systemAttribute-keyed field values). */
export interface CatalogGroupRecord extends RecordMeta {
  fieldValues: {
    catalog_group_name?: string
    catalog_group_description?: string | null
    catalog_group_entries?: unknown
    catalog_group_tax_rate_id?: string | null
    catalog_group_discount_type?: string | string[] | null
    catalog_group_discount_value?: number | null
    catalog_group_active?: boolean
  }
}

/** Simplified catalog group for UI consumption — SINGLE_SELECT values unwrapped, entries parsed. */
export interface CatalogGroup {
  id: string
  recordId: RecordId
  name: string
  description: string | null
  entries: CatalogGroupEntry[]
  /** Id of a `documents.taxRates` preset — resolved live, not snapshotted. */
  taxRateId: string | null
  discountType: 'percent' | 'amount' | null
  /** Percent = plain number; amount = integer cents (same convention as `quote_discount_value`). */
  discountValue: number | null
  active: boolean
}

/**
 * `useAllRecords` surfaces SINGLE_SELECT values as one-element arrays — unwrap
 * so scalar-typed consumers compare correctly. See CLAUDE.md memory: "SINGLE_SELECT
 * field values are ARRAYS".
 */
function scalarValue<T>(value: T | T[] | null | undefined): T | undefined {
  if (Array.isArray(value)) return value[0]
  return value ?? undefined
}

function toCatalogGroup(record: CatalogGroupRecord): CatalogGroup {
  return {
    id: record.id,
    recordId: record.recordId,
    name: record.fieldValues.catalog_group_name ?? record.displayName ?? 'Untitled',
    description: record.fieldValues.catalog_group_description ?? null,
    entries: parseCatalogGroupEntries(record.fieldValues.catalog_group_entries),
    taxRateId: record.fieldValues.catalog_group_tax_rate_id ?? null,
    discountType:
      (scalarValue(record.fieldValues.catalog_group_discount_type) as
        | 'percent'
        | 'amount'
        | undefined) ?? null,
    discountValue: record.fieldValues.catalog_group_discount_value ?? null,
    active: record.fieldValues.catalog_group_active ?? true,
  }
}

interface UseCatalogGroupsResult {
  /** All catalog groups, active and inactive. */
  groups: CatalogGroup[]
  /** Lookup by entity instance id (not the branded RecordId). */
  groupMap: Map<string, CatalogGroup>
  /** Resolved entityDefinitionId UUID for `catalog_group`, once loaded. */
  entityDefinitionId: string | null
  /** Field key → { id, key, type } map, for resolving fieldIds when saving. */
  fields: Record<string, FieldInfo>
  isLoading: boolean
  refresh: () => void
}

/**
 * Fetch every catalog group (Product Groups tab, hidden `catalog_group` system
 * entity — plans/dispatch/money/09-product-groups.md) via the generic record
 * system. Same "small dataset, no pagination" shape as `useCatalogItems`.
 */
export function useCatalogGroups(): UseCatalogGroupsResult {
  const { records, entityDefinitionId, fields, isLoading, refresh } =
    useAllRecords<CatalogGroupRecord>({
      apiSlug: 'catalog-groups',
      includeArchived: false,
    })

  const { groups, groupMap } = useMemo(() => {
    const list = records.map(toCatalogGroup)
    return { groups: list, groupMap: new Map(list.map((group) => [group.id, group])) }
  }, [records])

  return { groups, groupMap, entityDefinitionId, fields, isLoading, refresh }
}
