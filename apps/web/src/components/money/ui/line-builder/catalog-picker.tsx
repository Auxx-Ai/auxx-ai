// apps/web/src/components/money/ui/line-builder/catalog-picker.tsx

'use client'

// The sell-side part picker (107 D7): sellable parts by kind, plus catalog groups.
// Data is loaded once by `LineBuilder`; this component only filters it while open.

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
import { formatCurrency } from '@auxx/utils/currency'
import { Boxes, Package, Plus, Settings2 } from 'lucide-react'
import Link from 'next/link'
import { type ReactNode, useMemo, useState } from 'react'
import type { CatalogGroup } from '~/components/money/hooks/use-catalog-groups'
import type { CatalogPart } from '~/components/money/hooks/use-catalog-parts'
import { useUser } from '~/hooks/use-user'
import {
  groupSellableParts,
  resolveCatalogGroup,
  resolvedCatalogGroupTotal,
} from './catalog-group-resolver'

/** `price` is integer MINOR UNITS (FieldType.CURRENCY storage convention). */
function formatPrice(price: number | null, currencyCode: string): string {
  if (price === null) return 'No price'
  return formatCurrency(price, { currencyCode })
}

const FOOTER_LINK = cn(
  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-muted-foreground text-xs',
  'hover:bg-accent hover:text-accent-foreground'
)

export interface CatalogPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Current free-text search seed (e.g. what's already typed in the name cell). */
  initialQuery?: string
  /** Org currency code (from `organization.currency`) for price display. */
  currencyCode?: string
  /** Every non-archived part, loaded once by `LineBuilder`; the picker lists the sellable ones. */
  parts: CatalogPart[]
  groups: CatalogGroup[]
  partMap: Map<string, CatalogPart>
  isLoading: boolean
  onSelectPart: (part: CatalogPart) => void
  /** Picking a group lets `LineBuilder` resolve and explode its entries. */
  onSelectGroup: (group: CatalogGroup) => void
  /** User typed text with no match — add as an ad-hoc line with no part. */
  onFreeText: (text: string) => void
  /** Return focus to the name input once the picker closes (pick / Escape / outside). */
  onCloseFocus?: () => void
  /** The name cell — used as the popover anchor, so it stays fully typable. */
  children: ReactNode
}

/**
 * Combobox popover anchored to the line builder's name cell. Picking a part copies
 * its values onto the line (a snapshot: later price changes never rewrite lines)
 * and writes `line_item_part`.
 */
export function CatalogPicker({
  open,
  onOpenChange,
  initialQuery = '',
  currencyCode = 'USD',
  parts,
  groups: catalogGroups,
  partMap,
  isLoading,
  onSelectPart,
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
      .map((group) => ({ group, resolved: resolveCatalogGroup(group, partMap) }))
      .sort((a, b) => a.group.name.localeCompare(b.group.name))
  }, [open, catalogGroups, partMap, query])

  const partSections = useMemo(
    () => (open ? groupSellableParts(parts, query) : []),
    [open, parts, query]
  )

  const hasAnyMatch = partSections.length > 0 || groupPicks.length > 0

  const handlePick = (part: CatalogPart) => {
    onSelectPart(part)
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
            placeholder='Search parts & services…'
          />
          <CommandList
            scrollAreaClassName='max-h-none'
            scrollAreaStyle={{
              height: 'min(300px, calc(var(--radix-popover-content-available-height) - 78px))',
            }}>
            {!isLoading && !hasAnyMatch && !query.trim() && (
              <CommandEmpty>No sellable parts or services yet</CommandEmpty>
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

            {partSections.map((section) => (
              <CommandGroup key={section.key} heading={section.label}>
                {section.rows.map((part) => (
                  <CommandDetailItem
                    key={part.id}
                    value={part.id}
                    onSelect={() => handlePick(part)}
                    title={part.name}
                    secondary={
                      part.sku ? (
                        <span className='text-muted-foreground text-xs'>{part.sku}</span>
                      ) : undefined
                    }
                    trailing={
                      <span className='text-muted-foreground text-xs'>
                        {formatPrice(part.sellPriceCents, currencyCode)}
                      </span>
                    }
                  />
                ))}
              </CommandGroup>
            ))}

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
            <Link href='/app/parts' className={FOOTER_LINK} onClick={() => onOpenChange(false)}>
              <Package className='size-3.5' />
              Manage parts & services
            </Link>
            {isAdminOrOwner && (
              <Link href='/app/catalog' className={FOOTER_LINK} onClick={() => onOpenChange(false)}>
                <Settings2 className='size-3.5' />
                Pricing: groups & tax rates
              </Link>
            )}
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
