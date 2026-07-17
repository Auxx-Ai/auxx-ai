// apps/web/src/components/money/ui/line-builder/catalog-picker.tsx

'use client'

// Catalog combobox picker (money MQ1 build spec §H.2, 01-ui.md #2) — a `Command`
// combobox in a `Popover`, composed from the `combo-picker.tsx` /
// `record-picker-content.tsx` structural pattern (Popover + Command + grouped
// CommandItems + a trailing "create" affordance), not those components directly —
// our option shape (name + price + category + part) doesn't fit the plain
// Option/OptionGroup shape ComboPicker expects.
//
// Data is owned by `LineBuilder`: one `useCatalogItems` / `useCatalogGroups`
// load serves every row. This component only filters the supplied data while
// open and emits the selected domain object.

import {
  Command,
  CommandDetailItem,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandList,
  CommandSeparator,
} from '@auxx/ui/components/command'
import { Popover, PopoverAnchor, PopoverContent } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { Boxes, Package, Plus, Settings2 } from 'lucide-react'
import Link from 'next/link'
import { type ReactNode, useMemo, useState } from 'react'
import type { CatalogGroup } from '~/components/money/hooks/use-catalog-groups'
import type { CatalogItem } from '~/components/money/hooks/use-catalog-items'
import { useUser } from '~/hooks/use-user'
import { resolveCatalogGroup, resolvedCatalogGroupTotal } from './catalog-group-resolver'

/** `price` is integer cents (FieldType.CURRENCY storage convention). */
function formatPrice(price: number | null, currencyCode: string): string {
  if (price === null) return 'No price'
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: currencyCode }).format(
    price / 100
  )
}

function titleCase(value: string): string {
  return value.length ? value.charAt(0).toUpperCase() + value.slice(1) : value
}

export interface CatalogPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Current free-text search seed (e.g. what's already typed in the name cell). */
  initialQuery?: string
  /** Org currency code (from `organization.currency`) for price display. */
  currencyCode?: string
  /** Shared catalog data loaded once by `LineBuilder`. */
  items: CatalogItem[]
  groups: CatalogGroup[]
  itemMap: Map<string, CatalogItem>
  isLoading: boolean
  onSelectCatalogItem: (item: CatalogItem) => void
  /** Picking a group lets `LineBuilder` resolve and explode its entries. */
  onSelectGroup: (group: CatalogGroup) => void
  /** User typed text with no catalog match — add as an ad-hoc line, no catalog rel. */
  onFreeText: (text: string) => void
  /** Return focus to the name input once the picker closes (pick / Escape / outside). */
  onCloseFocus?: () => void
  /** The name cell — used as the popover anchor, so it stays fully typable. */
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
  items,
  groups: catalogGroups,
  itemMap,
  isLoading,
  onSelectCatalogItem,
  onSelectGroup,
  onFreeText,
  onCloseFocus,
  children,
}: CatalogPickerProps) {
  const [query, setQuery] = useState(initialQuery)
  const { isAdminOrOwner } = useUser()

  const groupPicks = useMemo(() => {
    if (!open) return []
    const q = query.trim().toLowerCase()
    const active = catalogGroups.filter((group) => group.active)
    const filtered = q ? active.filter((group) => group.name.toLowerCase().includes(q)) : active

    return filtered
      .map((group) => ({ group, resolved: resolveCatalogGroup(group, itemMap) }))
      .sort((a, b) => a.group.name.localeCompare(b.group.name))
  }, [open, catalogGroups, itemMap, query])

  const itemGroups = useMemo(() => {
    if (!open) return []
    const q = query.trim().toLowerCase()
    const active = items.filter((item) => item.active)
    const filtered = q ? active.filter((item) => item.name.toLowerCase().includes(q)) : active

    const byCategory = new Map<string, CatalogItem[]>()
    for (const item of filtered) {
      const category = item.category || 'other'
      const bucket = byCategory.get(category) ?? []
      bucket.push(item)
      byCategory.set(category, bucket)
    }

    return [...byCategory.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, rows]) => ({
        category,
        label: titleCase(category),
        rows: rows.sort((a, b) => a.name.localeCompare(b.name)),
      }))
  }, [open, items, query])

  const hasAnyMatch = itemGroups.some((group) => group.rows.length > 0) || groupPicks.length > 0

  const handlePick = (item: CatalogItem) => {
    onSelectCatalogItem(item)
    onOpenChange(false)
  }

  const handlePickGroup = (group: CatalogGroup) => {
    onSelectGroup(group)
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
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent
        align='start'
        className='w-[320px] p-0'
        onCloseAutoFocus={(e) => {
          // Radix would refocus the anchor's first focusable; we manage focus
          // ourselves so it lands back on the name input the caret came from.
          e.preventDefault()
          onCloseFocus?.()
        }}>
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder='Search products & services…'
          />
          <CommandList
            scrollAreaClassName='max-h-none'
            scrollAreaStyle={{
              height: 'min(300px, calc(var(--radix-popover-content-available-height) - 78px))',
            }}>
            {!isLoading && !hasAnyMatch && !query.trim() && (
              <CommandEmpty>No products or services yet</CommandEmpty>
            )}

            {groupPicks.length > 0 && (
              <CommandGroup heading='Groups'>
                {groupPicks.map(({ group, resolved }) => {
                  const count = group.entries.length
                  return (
                    <CommandDetailItem
                      key={group.id}
                      value={`group-${group.id}`}
                      onSelect={() => handlePickGroup(group)}
                      icon={<Boxes className='size-4' />}
                      title={group.name}
                      secondary={
                        <span className='text-muted-foreground text-xs'>
                          {count} item{count === 1 ? '' : 's'}
                        </span>
                      }
                      trailing={
                        <span className='text-muted-foreground text-xs'>
                          {formatPrice(resolvedCatalogGroupTotal(resolved), currencyCode)}
                        </span>
                      }
                    />
                  )
                })}
              </CommandGroup>
            )}

            {itemGroups.map(
              (group) =>
                group.rows.length > 0 && (
                  <CommandGroup key={group.category} heading={group.label}>
                    {group.rows.map((item) => (
                      <CommandDetailItem
                        key={item.id}
                        value={item.id}
                        onSelect={() => handlePick(item)}
                        title={item.name}
                        secondary={
                          item.partRecordId ? (
                            <span className='text-muted-foreground text-xs'>Linked part</span>
                          ) : undefined
                        }
                        trailing={
                          <span className='text-muted-foreground text-xs'>
                            {formatPrice(item.defaultUnitPriceCents, currencyCode)}
                          </span>
                        }
                      />
                    ))}
                  </CommandGroup>
                )
            )}

            {query.trim() && (
              <CommandGroup>
                <CommandDetailItem
                  value={`__one-off__${query}`}
                  onSelect={handleFreeText}
                  icon={<Plus className='size-4' />}
                  title={`Add “${query.trim()}” as one-off line`}
                />
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
