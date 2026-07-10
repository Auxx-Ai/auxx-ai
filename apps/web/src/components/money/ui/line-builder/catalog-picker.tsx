// apps/web/src/components/money/ui/line-builder/catalog-picker.tsx

'use client'

// Catalog combobox picker (money MQ1 build spec §H.2, 01-ui.md #2) — a `Command`
// combobox in a `Popover`, composed from the `combo-picker.tsx` /
// `record-picker-content.tsx` structural pattern (Popover + Command + grouped
// CommandItems + a trailing "create" affordance), not those components directly —
// our option shape (name + price + category + part) doesn't fit the plain
// Option/OptionGroup shape ComboPicker expects.
//
// Data: `useAllRecords({ apiSlug: 'catalog-items' })` — catalog items are an
// org-scoped small dataset (same shape as tags/inboxes), so the "fetch
// everything with field values in one call" hook fits better than the
// paginated `useRecordList` used for large lists.

import { toRecordId } from '@auxx/lib/resources/client'
import type { RecordId } from '@auxx/types/resource'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@auxx/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { Package, Plus, Settings2 } from 'lucide-react'
import Link from 'next/link'
import { type ReactNode, useMemo, useState } from 'react'
import type { RecordMeta } from '~/components/resources'
import { useAllRecords } from '~/components/resources/hooks/use-all-records'
import { useUser } from '~/hooks/use-user'

/** Value copied onto the line when a catalog item is picked. */
export interface CatalogItemPick {
  recordId: RecordId
  name: string
  description: string | null
  category: string | null
  taxable: boolean
  unitPrice: number | null
}

interface CatalogItemFieldValues {
  catalog_item_name?: string
  catalog_item_description?: string | null
  catalog_item_category?: unknown
  catalog_item_default_unit_price?: number | null
  catalog_item_taxable?: boolean
  catalog_item_active?: boolean
  catalog_item_part?: unknown
}

interface CatalogItemRow extends RecordMeta {
  fieldValues: CatalogItemFieldValues
}

/** SINGLE_SELECT values come back as arrays — normalize to the first value. */
function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return (value[0] ?? null) as T | null
  return (value ?? null) as T | null
}

/** `price` is integer cents (FieldType.CURRENCY storage convention). */
function formatPrice(price: number | null, currencyCode: string): string {
  if (price === null) return 'No price'
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: currencyCode }).format(
    price / 100
  )
}

function titleCase(value: string): string {
  return value.length ? value[0].toUpperCase() + value.slice(1) : value
}

export interface CatalogPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Current free-text search seed (e.g. what's already typed in the name cell). */
  initialQuery?: string
  /** Org currency code (from `organization.currency`) for price display. */
  currencyCode?: string
  onSelectCatalogItem: (item: CatalogItemPick) => void
  /** User typed text with no catalog match — add as an ad-hoc line, no catalog rel. */
  onFreeText: (text: string) => void
  children: ReactNode
}

/**
 * Combobox popover anchored to the line builder's name cell. Doubles as a
 * free-text input: typed text with no match surfaces "Add '<text>' as one-off
 * line". Picking a catalog item copies its values onto the line (snapshot —
 * catalog price changes never rewrite existing lines) and keeps the
 * `catalogItem` relationship for reporting.
 */
export function CatalogPicker({
  open,
  onOpenChange,
  initialQuery = '',
  currencyCode = 'USD',
  onSelectCatalogItem,
  onFreeText,
  children,
}: CatalogPickerProps) {
  const [query, setQuery] = useState(initialQuery)
  const { isAdminOrOwner } = useUser()

  const { records, isLoading } = useAllRecords<CatalogItemRow>({
    apiSlug: 'catalog-items',
    enabled: open,
  })

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const active = records.filter((r) => r.fieldValues.catalog_item_active !== false)
    const filtered = q
      ? active.filter((r) => (r.fieldValues.catalog_item_name ?? '').toLowerCase().includes(q))
      : active

    const byCategory = new Map<string, CatalogItemRow[]>()
    for (const row of filtered) {
      const category = firstOf<string>(row.fieldValues.catalog_item_category) ?? 'other'
      const bucket = byCategory.get(category) ?? []
      bucket.push(row)
      byCategory.set(category, bucket)
    }

    return [...byCategory.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, rows]) => ({
        category,
        label: titleCase(category),
        rows: rows.sort((a, b) =>
          (a.fieldValues.catalog_item_name ?? '').localeCompare(
            b.fieldValues.catalog_item_name ?? ''
          )
        ),
      }))
  }, [records, query])

  const hasAnyMatch = groups.some((g) => g.rows.length > 0)

  const handlePick = (row: CatalogItemRow) => {
    onSelectCatalogItem({
      recordId: toRecordId('catalog_item', row.id),
      name: row.fieldValues.catalog_item_name ?? '',
      description: row.fieldValues.catalog_item_description ?? null,
      category: firstOf<string>(row.fieldValues.catalog_item_category),
      taxable: row.fieldValues.catalog_item_taxable !== false,
      unitPrice: row.fieldValues.catalog_item_default_unit_price ?? null,
    })
    onOpenChange(false)
  }

  const handleFreeText = () => {
    if (!query.trim()) return
    onFreeText(query.trim())
    onOpenChange(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (next) setQuery(initialQuery)
      }}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align='start' className='w-[320px] p-0'>
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder='Search products & services…'
          />
          <CommandList>
            {!isLoading && !hasAnyMatch && (
              <CommandEmpty>
                <button
                  type='button'
                  onClick={handleFreeText}
                  className='flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:text-foreground'>
                  <Plus className='size-4 shrink-0 text-muted-foreground' />
                  <span className='truncate'>
                    Add <span className='font-medium'>&ldquo;{query.trim()}&rdquo;</span> as one-off
                    line
                  </span>
                </button>
              </CommandEmpty>
            )}

            {groups.map(
              (group) =>
                group.rows.length > 0 && (
                  <CommandGroup key={group.category} heading={group.label}>
                    {group.rows.map((row) => (
                      <CommandItem
                        key={row.id}
                        value={row.id}
                        onSelect={() => handlePick(row)}
                        className='flex items-center justify-between gap-2'>
                        <div className='flex min-w-0 flex-col'>
                          <span className='truncate'>{row.fieldValues.catalog_item_name}</span>
                          {row.fieldValues.catalog_item_part != null && (
                            <span className='truncate text-muted-foreground text-xs'>
                              Linked part
                            </span>
                          )}
                        </div>
                        <span className='shrink-0 text-muted-foreground text-xs'>
                          {formatPrice(
                            row.fieldValues.catalog_item_default_unit_price ?? null,
                            currencyCode
                          )}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )
            )}

            {hasAnyMatch && query.trim() && (
              <CommandGroup>
                <CommandItem value={`__one-off__${query}`} onSelect={handleFreeText}>
                  <Plus className='size-4 text-muted-foreground' />
                  Add &ldquo;{query.trim()}&rdquo; as one-off line
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>

          <CommandSeparator />
          <div className='p-1'>
            {isAdminOrOwner ? (
              <Link
                href='/app/dispatch/settings/products'
                className={cn(
                  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-muted-foreground text-xs',
                  'hover:bg-accent hover:text-accent-foreground'
                )}
                onClick={() => onOpenChange(false)}>
                <Settings2 className='size-3.5' />
                Manage products & services
              </Link>
            ) : (
              <div className='flex items-center gap-2 px-2 py-1.5 text-muted-foreground text-xs'>
                <Package className='size-3.5' />
                Ask an admin to manage products & services
              </div>
            )}
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
