// apps/web/src/components/money/hooks/use-catalog-parts.ts

import type { LineItemUnit } from '@auxx/lib/accounting/sales/client'
import { isServicePartKind } from '@auxx/lib/inventory/costing/client'
import type { RecordId } from '@auxx/lib/resources/client'
import { useMemo } from 'react'
import { useAllRecords } from '~/components/resources/hooks/use-all-records'
import type { RecordMeta } from '~/components/resources/store/record-store'

/** Part record shape from `useAllRecords` (systemAttribute-keyed field values). */
interface PartRecord extends RecordMeta {
  recordId: RecordId
  fieldValues: {
    part_title?: string
    part_description?: string | null
    part_sku?: string | null
    part_kind?: string | string[] | null
    part_unit?: string | string[] | null
    part_sell_price?: number | null
    part_taxable?: boolean | null
    part_sellable?: boolean | null
  }
}

/** A part as the line builder and the Pricing page's groups consume it. */
export interface CatalogPart {
  id: string
  recordId: RecordId
  name: string
  description: string | null
  sku: string | null
  isService: boolean
  /** Per-unit sell price in minor units (CURRENCY RATE convention). */
  sellPriceCents: number | null
  unit: LineItemUnit | null
  taxable: boolean
  sellable: boolean
}

/** `useAllRecords` surfaces SINGLE_SELECT values as one-element arrays. */
function scalarValue<T>(value: T | T[] | null | undefined): T | undefined {
  if (Array.isArray(value)) return value[0]
  return value ?? undefined
}

function toCatalogPart(record: PartRecord): CatalogPart {
  const values = record.fieldValues
  return {
    id: record.id,
    recordId: record.recordId,
    name: values.part_title ?? record.displayName ?? 'Untitled',
    description: values.part_description ?? null,
    sku: values.part_sku ?? null,
    isService: isServicePartKind(scalarValue(values.part_kind)),
    sellPriceCents: values.part_sell_price ?? null,
    unit: (scalarValue(values.part_unit) as LineItemUnit | undefined) ?? null,
    taxable: values.part_taxable !== false,
    sellable: values.part_sellable === true,
  }
}

/** Every non-archived part, for the sell-side picker and catalog groups. */
export function useCatalogParts(options: { enabled?: boolean } = {}) {
  const { enabled = true } = options
  const { records, entityDefinitionId, isLoading, refresh } = useAllRecords<PartRecord>({
    apiSlug: 'parts',
    includeArchived: false,
    enabled,
  })

  const { parts, partMap } = useMemo(() => {
    const list = records.map(toCatalogPart)
    return { parts: list, partMap: new Map(list.map((part) => [part.id, part])) }
  }, [records])

  return { parts, partMap, entityDefinitionId, isLoading, refresh }
}
