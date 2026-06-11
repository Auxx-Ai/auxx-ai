// apps/web/src/components/templates/ui/template-gallery-dialog.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Dialog, DialogContent } from '@auxx/ui/components/dialog'
import { DialogNav, DialogNavPage, DialogNavPages } from '@auxx/ui/components/dialog-nav'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@auxx/ui/components/empty'
import { EntityIcon } from '@auxx/ui/components/icons'
import { InputSearch } from '@auxx/ui/components/input-search'
import { Kbd } from '@auxx/ui/components/kbd'
import { RadioGroup } from '@auxx/ui/components/radio-group'
import { RadioGroupItemCard } from '@auxx/ui/components/radio-group-item'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { cn } from '@auxx/ui/lib/utils'
import { Search } from 'lucide-react'
import { type ComponentProps, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'

/** Minimum shape a gallery item must satisfy. Search matches name + description. */
export interface TemplateGalleryItem {
  id: string
  name: string
  description: string
  categories: string[]
}

export interface TemplateGalleryCategory {
  value: string // 'all' must be included by the caller (all features already do)
  label: string
  icon?: string // ICON_DATA iconId, rendered via EntityIcon
}

/** Helpers handed to detail render props for navigating out of the detail page. */
interface DetailHelpers {
  back: () => void
  close: () => void
}

interface TemplateGalleryDialogProps<T extends TemplateGalleryItem> {
  open: boolean
  onOpenChange: (open: boolean) => void

  // Header
  title: string // sr-only DialogTitle
  description: string // sr-only DialogDescription
  crumbLabel: string // list-page crumb, e.g. 'Agent templates'
  crumbIcon?: ReactNode // e.g. <Plug /> (MCP)

  // Data — features keep their own queries/hooks and pass results down
  items: T[]
  isLoading?: boolean
  categories: readonly TemplateGalleryCategory[]
  /** Noun for counts/copy: 'template' (default) or 'prompt'. */
  itemNoun?: string

  // Row slots
  /** List presentation: a single-column row list (default) or a 2-col card grid. */
  layout?: 'rows' | 'cards'
  renderIcon: (item: T) => ReactNode // EntityIcon / AppIcon / img per feature
  /** Trailing badges. Default: outline badges from item.categories. */
  renderBadges?: (item: T) => ReactNode
  /** Extra inline badge next to the name (e.g. field count, Popular). */
  renderNameBadge?: (item: T) => ReactNode

  // Selection
  /**
   * One-click mode: perform the action directly (agent create, MCP OAuth connect).
   * When `renderDetail` is set, the shell switches to the detail page instead —
   * unless this returns `'handled'`, letting features mix one-click and detail
   * per item (MCP: OAuth templates connect directly, var templates open fields).
   */
  onSelectItem?: (item: T) => void | 'handled' | Promise<void | 'handled'>
  /** Marks one row busy and disables the rest (creatingTemplateId / connectingId). */
  busyItemId?: string | null

  // Detail page (optional)
  renderDetail?: (item: T, helpers: DetailHelpers) => ReactNode
  detailSize?: ComponentProps<typeof DialogNavPage>['size'] // default '3xl'; MCP: 'sm'
  detailCrumb?: (item: T) => string // default item.name
  /** Detail-page footer actions rendered next to Cancel (the feature's CTA button). */
  renderDetailFooter?: (item: T, helpers: DetailHelpers) => ReactNode
  /** Disable Back/Cancel while a mutation is pending (feature owns pending state). */
  detailBusy?: boolean
  /** Called when leaving the detail page (back or close) so features reset side state. */
  onDetailExit?: () => void

  /**
   * Controlled selection — only entity needs this (preSelectedTemplateIds opens
   * straight into the detail page). Uncontrolled when omitted.
   */
  selectedId?: string | null
  onSelectedIdChange?: (id: string | null) => void

  /** Spread onto DialogContent — entity passes useUnsavedChangesGuard's guardProps. */
  contentProps?: Partial<ComponentProps<typeof DialogContent>>
}

/**
 * Shared "create from template" gallery dialog. Owns the MCP-style shell:
 * `DialogNavPages` with an animated list ↔ detail transition, a category sidebar
 * with live counts, search + autofocus, the shared category/search filter,
 * skeleton/empty states, the slot-based row list, a global Cancel footer (with a
 * muted "Showing N" count on the list page), and state reset on close. Features
 * keep their own data/mutations and feed results + row/detail render props down.
 */
export function TemplateGalleryDialog<T extends TemplateGalleryItem>({
  open,
  onOpenChange,
  title,
  description,
  crumbLabel,
  crumbIcon,
  items,
  isLoading,
  categories,
  itemNoun = 'template',
  layout = 'rows',
  renderIcon,
  renderBadges,
  renderNameBadge,
  onSelectItem,
  busyItemId,
  renderDetail,
  detailSize = '3xl',
  detailCrumb,
  renderDetailFooter,
  detailBusy,
  onDetailExit,
  selectedId,
  onSelectedIdChange,
  contentProps,
}: TemplateGalleryDialogProps<T>) {
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null)

  const isControlled = selectedId !== undefined
  const currentSelectedId = isControlled ? (selectedId ?? null) : internalSelectedId

  // Keep close-time callbacks current without re-running the reset effect on
  // every render (deps stay [open]).
  const callbacks = useRef({ onDetailExit, onSelectedIdChange })
  callbacks.current = { onDetailExit, onSelectedIdChange }

  // Reset shell state exactly once per open→close transition. This covers every
  // close path — Cancel, X, escape/outside, the guard's confirmed-close, or the
  // consumer flipping `open` — so features don't hand-roll resets anymore.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open) {
      wasOpen.current = true
      return
    }
    if (!wasOpen.current) return
    wasOpen.current = false
    setSearchQuery('')
    setSelectedCategory('all')
    setInternalSelectedId(null)
    callbacks.current.onSelectedIdChange?.(null)
    callbacks.current.onDetailExit?.()
  }, [open])

  const noun = itemNoun
  const categoryLabels = useMemo(
    () => new Map(categories.map((c) => [c.value, c.label])),
    [categories]
  )

  const filteredItems = useMemo(() => {
    let list = items
    if (selectedCategory !== 'all') {
      list = list.filter((item) => item.categories.includes(selectedCategory))
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      list = list.filter(
        (item) => item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q)
      )
    }
    return list
  }, [items, selectedCategory, searchQuery])

  const selectedItem = useMemo(
    () => (currentSelectedId ? (items.find((i) => i.id === currentSelectedId) ?? null) : null),
    [items, currentSelectedId]
  )

  const page = currentSelectedId != null && renderDetail ? 'detail' : 'list'

  function setSelected(id: string | null) {
    if (!isControlled) setInternalSelectedId(id)
    onSelectedIdChange?.(id)
  }

  function close() {
    onOpenChange(false)
  }

  function back() {
    setSelected(null)
    onDetailExit?.()
  }

  const helpers: DetailHelpers = { back, close }

  async function handleSelect(item: T) {
    if (busyItemId) return
    if (onSelectItem) {
      const result = await onSelectItem(item)
      if (result === 'handled') return
    }
    if (renderDetail) setSelected(item.id)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent
        innerClassName='p-0'
        position='tc'
        size='content'
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          searchInputRef.current?.focus()
        }}
        {...contentProps}>
        <div className='flex flex-col'>
          <DialogNav
            title={title}
            description={description}
            onBack={page === 'detail' ? back : undefined}
            backDisabled={detailBusy}
            crumbs={
              page === 'detail' && selectedItem
                ? [
                    { label: crumbLabel, icon: crumbIcon, onClick: back },
                    { label: detailCrumb?.(selectedItem) ?? selectedItem.name },
                  ]
                : [{ label: crumbLabel, icon: crumbIcon }]
            }
          />

          <DialogNavPages value={page}>
            <DialogNavPage value='list' size='3xl'>
              {renderList()}
            </DialogNavPage>
            <DialogNavPage value='detail' size={detailSize}>
              {selectedItem && renderDetail?.(selectedItem, helpers)}
            </DialogNavPage>
          </DialogNavPages>

          <div className='flex items-center justify-between gap-2 border-t p-3'>
            <div className='min-w-0 text-xs text-muted-foreground'>
              {page === 'list' && !isLoading && filteredItems.length > 0
                ? `Showing ${filteredItems.length} ${noun}${filteredItems.length !== 1 ? 's' : ''}`
                : null}
            </div>
            <div className='flex items-center gap-2'>
              <Button size='sm' variant='ghost' onClick={close} disabled={detailBusy}>
                Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
              </Button>
              {page === 'detail' && selectedItem && renderDetailFooter?.(selectedItem, helpers)}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )

  function renderList() {
    return (
      <div className='flex w-full min-h-0 flex-col justify-start sm:flex-row'>
        {/* Category sidebar */}
        <div className='hidden w-56 flex-col border-r bg-muted/30 sm:flex'>
          <ScrollArea className='max-h-[440px]'>
            <h3 className='sticky top-0 p-3 pb-0 text-sm font-semibold text-muted-foreground'>
              Categories
            </h3>
            <div className='p-3 pb-5 pe-5'>
              <RadioGroup value={selectedCategory} onValueChange={setSelectedCategory}>
                {categories.map((category) => {
                  const count =
                    category.value === 'all'
                      ? items.length
                      : items.filter((i) => i.categories.includes(category.value)).length
                  return (
                    <RadioGroupItemCard
                      key={category.value}
                      label={category.label}
                      value={category.value}
                      description={
                        isLoading ? 'Loading...' : `${count} ${noun}${count !== 1 ? 's' : ''}`
                      }
                      icon={
                        category.icon ? (
                          <EntityIcon iconId={category.icon} variant='bare' />
                        ) : undefined
                      }
                    />
                  )
                })}
              </RadioGroup>
            </div>
          </ScrollArea>
        </div>

        {/* Item list */}
        <div className='flex min-w-0 flex-1 flex-col overflow-hidden'>
          <div className='px-3 py-3'>
            <InputSearch
              ref={searchInputRef}
              placeholder={`Search ${noun}s...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onClear={() => setSearchQuery('')}
            />
          </div>

          {isLoading ? (
            layout === 'cards' ? (
              <div className='grid gap-3 p-3 pt-0 sm:grid-cols-2'>
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className='h-20 animate-pulse rounded-2xl border bg-muted/40' />
                ))}
              </div>
            ) : (
              <div className='space-y-2 p-3 pt-0'>
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className='h-14 animate-pulse rounded-2xl border bg-muted/40' />
                ))}
              </div>
            )
          ) : filteredItems.length > 0 ? (
            <ScrollArea className='max-h-[400px]'>
              {layout === 'cards' ? (
                <div className='grid gap-3 p-3 pt-0 pb-5 pe-5 sm:grid-cols-2'>
                  {filteredItems.map((item) => renderCard(item))}
                </div>
              ) : (
                <div className='space-y-2 p-3 pt-0 pb-5 pe-5'>
                  {filteredItems.map((item) => renderRow(item))}
                </div>
              )}
            </ScrollArea>
          ) : (
            <Empty className='py-10'>
              <EmptyHeader>
                <EmptyMedia variant='icon'>
                  <Search />
                </EmptyMedia>
                <EmptyTitle>No {noun}s found</EmptyTitle>
                <EmptyDescription>
                  {searchQuery
                    ? `No ${noun}s match your search. Try adjusting your query.`
                    : `No ${noun}s available in this category.`}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
      </div>
    )
  }

  function renderRow(item: T) {
    const isBusy = busyItemId === item.id
    const isAnyBusy = busyItemId != null
    return (
      <button
        type='button'
        key={item.id}
        onClick={() => handleSelect(item)}
        disabled={isAnyBusy && !isBusy}
        className={cn(
          'group flex w-full cursor-pointer items-center justify-between gap-3 rounded-2xl border px-3 py-2 text-left transition-colors duration-200 hover:bg-muted',
          isAnyBusy && !isBusy && 'cursor-default opacity-50',
          isBusy && 'bg-muted'
        )}>
        <div className='flex min-w-0 flex-1 items-start gap-3'>
          {renderIcon(item)}
          <div className='flex min-w-0 flex-1 flex-col'>
            <div className='flex items-center gap-2'>
              <span className='truncate text-sm font-medium'>{item.name}</span>
              {renderNameBadge?.(item)}
            </div>
            <span className='mt-0.5 line-clamp-1 text-xs text-muted-foreground'>
              {item.description}
            </span>
          </div>
        </div>
        <div className='flex shrink-0 gap-1'>
          {renderBadges
            ? renderBadges(item)
            : item.categories.map((cat) => (
                <Badge key={cat} variant='outline' className='text-xs'>
                  {categoryLabels.get(cat) ?? cat}
                </Badge>
              ))}
        </div>
      </button>
    )
  }

  function renderCard(item: T) {
    const isBusy = busyItemId === item.id
    const isAnyBusy = busyItemId != null
    return (
      <button
        type='button'
        key={item.id}
        onClick={() => handleSelect(item)}
        disabled={isAnyBusy && !isBusy}
        className={cn(
          'group flex cursor-pointer flex-col gap-2 rounded-2xl border p-3 text-left transition-colors duration-200 hover:bg-muted',
          isAnyBusy && !isBusy && 'cursor-default opacity-50',
          isBusy && 'bg-muted'
        )}>
        <div className='flex items-start gap-3'>
          {renderIcon(item)}
          <div className='flex min-w-0 flex-1 flex-col'>
            <div className='flex items-center gap-2'>
              <span className='truncate text-sm font-semibold'>{item.name}</span>
              {renderNameBadge?.(item)}
            </div>
            <span className='mt-0.5 line-clamp-2 text-xs text-muted-foreground'>
              {item.description}
            </span>
          </div>
        </div>
        {renderBadges && <div className='flex flex-wrap gap-1'>{renderBadges(item)}</div>}
      </button>
    )
  }
}
