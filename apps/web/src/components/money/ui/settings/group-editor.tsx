// apps/web/src/components/money/ui/settings/group-editor.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { Button } from '@auxx/ui/components/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { CircleCheck, CircleDashed, CircleX, GripVertical, Pencil, Plus, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import {
  type CatalogGroupEntry,
  newCatalogGroupEntry,
  serializeCatalogGroupEntries,
} from '~/components/money/catalog-group-types'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import { BaseType } from '~/components/workflow/types'
import { useDebouncedCallback } from '~/hooks/use-debounced-value'
import { useSettings } from '~/hooks/use-settings'
import { type CatalogGroup, useCatalogGroups } from '../../hooks/use-catalog-groups'
import { type CatalogItem, useCatalogItems } from '../../hooks/use-catalog-items'
import { formatMoney } from './format-money'
import type { TaxRate } from './tax-rate-types'

interface GroupEditorProps {
  selectedId: string | null
  currency: string
}

/**
 * Right column of the Product groups tab: a `FieldPanel` form for the
 * selected group (name/description/tax rate/discount/active, autosaved via
 * `useSaveFieldValue` — mirrors `product-editor.tsx`), plus an entries
 * section below (drag-reorder, qty/description/taxable overrides).
 */
export function GroupEditor({ selectedId, currency }: GroupEditorProps) {
  const { groupMap } = useCatalogGroups()
  const group = selectedId ? groupMap.get(selectedId) : undefined

  if (!group) {
    return <div className='p-4 text-sm text-muted-foreground'>Select a product group to edit.</div>
  }

  return <GroupEditorForm key={group.id} group={group} currency={currency} />
}

function GroupEditorForm({ group, currency }: { group: CatalogGroup; currency: string }) {
  const { itemMap, items } = useCatalogItems()
  const { getSetting } = useSettings({ scope: 'DOCUMENTS' })
  const taxRates = (getSetting('documents.taxRates') as TaxRate[] | null) ?? []
  const taxOptions = useMemo(
    () => taxRates.map((rate) => ({ label: `${rate.name} (${rate.rate}%)`, value: rate.id })),
    [taxRates]
  )

  const { saveFieldValue, saveMultipleAsync } = useSaveFieldValue({})

  const [name, setName] = useState(group.name)
  const [description, setDescription] = useState(group.description ?? '')
  const [discountDraft, setDiscountDraft] = useState<string | null>(null)

  const commitName = useDebouncedCallback((value: string) => {
    saveFieldValue(group.recordId, 'catalog_group_name', value, FieldType.TEXT)
  }, 500)
  const commitDescription = useDebouncedCallback((value: string) => {
    saveFieldValue(group.recordId, 'catalog_group_description', value || null, FieldType.TEXT)
  }, 500)

  // Envelope, not a bare array — the generic save path splits top-level arrays
  // into one row per element (see serializeCatalogGroupEntries).
  function commitEntries(next: CatalogGroupEntry[]) {
    saveFieldValue(
      group.recordId,
      'catalog_group_entries',
      serializeCatalogGroupEntries(next),
      FieldType.JSON
    )
  }

  // Amount discounts are stored as integer cents (CURRENCY convention); percent
  // discounts as plain percentages — the input always shows/accepts the display
  // unit. Mirrors the totals-footer.tsx conversion idiom.
  const discountDisplayValue =
    group.discountValue === null
      ? ''
      : String(group.discountType === 'amount' ? group.discountValue / 100 : group.discountValue)

  const writeDiscount = (type: 'percent' | 'amount' | null, value: number | null) => {
    void saveMultipleAsync(group.recordId, [
      { fieldId: 'catalog_group_discount_type', value: type, fieldType: FieldType.SINGLE_SELECT },
      { fieldId: 'catalog_group_discount_value', value, fieldType: FieldType.NUMBER },
    ])
  }

  const commitDiscountValue = () => {
    if (discountDraft === null) return
    const trimmed = discountDraft.trim()
    setDiscountDraft(null)
    const parsed = trimmed === '' ? null : Number(trimmed)
    if (parsed !== null && Number.isNaN(parsed)) return
    const type = parsed === null ? null : (group.discountType ?? 'percent')
    writeDiscount(type, parsed !== null && type === 'amount' ? Math.round(parsed * 100) : parsed)
  }

  // Type toggle keeps the number the user SEES stable: 10% becomes $10 (1000¢).
  const toggleDiscountType = (type: 'percent' | 'amount') => {
    if (group.discountValue === null) {
      writeDiscount(type, null)
      return
    }
    const displayed =
      group.discountType === 'amount' ? group.discountValue / 100 : group.discountValue
    writeDiscount(type, type === 'amount' ? Math.round(displayed * 100) : displayed)
  }

  return (
    <div className='flex flex-col gap-3 p-3'>
      <FieldPanel
        orientation='horizontal'
        breakpoint='md'
        resizeId='catalog-group-form'
        defaultLabelWidth={140}
        className='p-0'>
        <FieldPanelRow title='Name' type={BaseType.STRING} showIcon isRequired>
          <FieldInputAdapter
            fieldType={FieldType.TEXT}
            value={name}
            onChange={(value) => {
              setName(value as string)
              commitName(value as string)
            }}
            placeholder='Group name'
          />
        </FieldPanelRow>

        <FieldPanelRow title='Description' type={BaseType.STRING} showIcon>
          <FieldInputAdapter
            fieldType={FieldType.TEXT}
            fieldOptions={{ multiline: true }}
            value={description}
            onChange={(value) => {
              setDescription(value as string)
              commitDescription(value as string)
            }}
            placeholder='Admin-facing note'
          />
        </FieldPanelRow>

        <FieldPanelRow title='Tax rate' type={BaseType.ENUM} showIcon>
          <FieldInputAdapter
            fieldType={FieldType.SINGLE_SELECT}
            fieldOptions={{ options: taxOptions }}
            value={group.taxRateId ? [group.taxRateId] : []}
            triggerProps={{ showClear: true, className: 'w-full' }}
            onChange={(value) =>
              saveFieldValue(
                group.recordId,
                'catalog_group_tax_rate_id',
                (value as string[])[0] ?? null,
                FieldType.TEXT
              )
            }
            placeholder='No tax'
          />
        </FieldPanelRow>

        <FieldPanelRow title='Discount' type={BaseType.NUMBER} showIcon>
          <div className='flex items-center gap-1.5'>
            <div className='flex overflow-hidden rounded-md border border-primary-200/60 dark:border-[#2c313a]'>
              {(['percent', 'amount'] as const).map((type) => (
                <button
                  key={type}
                  type='button'
                  onClick={() => toggleDiscountType(type)}
                  className={cn(
                    'px-2 py-1 text-xs leading-none',
                    (group.discountType ?? 'percent') === type
                      ? 'bg-primary-150 text-foreground dark:bg-primary-100'
                      : 'text-muted-foreground hover:bg-primary-100/60'
                  )}>
                  {type === 'percent' ? '%' : '$'}
                </button>
              ))}
            </div>
            <input
              value={discountDraft ?? discountDisplayValue}
              onChange={(e) => setDiscountDraft(e.target.value)}
              onBlur={commitDiscountValue}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') setDiscountDraft(null)
              }}
              inputMode='decimal'
              placeholder='0'
              className='w-20 rounded-md border border-primary-200/60 bg-transparent px-2 py-1 text-sm tabular-nums outline-none hover:bg-primary-100/60 focus:bg-primary-100/80 dark:border-[#2c313a]'
            />
          </div>
        </FieldPanelRow>

        <FieldPanelRow title='Active' type={BaseType.BOOLEAN} showIcon>
          <FieldInputAdapter
            fieldType={FieldType.CHECKBOX}
            fieldOptions={{ variant: 'switch' }}
            value={group.active}
            onChange={(value) =>
              saveFieldValue(group.recordId, 'catalog_group_active', value, FieldType.CHECKBOX)
            }
          />
        </FieldPanelRow>
      </FieldPanel>

      <EntriesSection
        entries={group.entries}
        itemMap={itemMap}
        items={items}
        currency={currency}
        onChange={commitEntries}
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Entries section — drag-reorder list + "Add item" popover
// ─────────────────────────────────────────────────────────────────────────────

function EntriesSection({
  entries,
  itemMap,
  items,
  currency,
  onChange,
}: {
  entries: CatalogGroupEntry[]
  itemMap: Map<string, CatalogItem>
  items: CatalogItem[]
  currency: string
  onChange: (next: CatalogGroupEntry[]) => void
}) {
  const [addOpen, setAddOpen] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 3 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = entries.findIndex((e) => e.id === active.id)
    const newIndex = entries.findIndex((e) => e.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    onChange(arrayMove(entries, oldIndex, newIndex))
  }

  function handleAddItem(catalogItemId: string) {
    onChange([...entries, newCatalogGroupEntry(catalogItemId)])
    setAddOpen(false)
  }

  function handleRemove(entryId: string) {
    onChange(entries.filter((e) => e.id !== entryId))
  }

  function handlePatch(entryId: string, patch: Partial<CatalogGroupEntry>) {
    onChange(entries.map((e) => (e.id === entryId ? { ...e, ...patch } : e)))
  }

  return (
    <div className='flex flex-col gap-1.5'>
      <div className='flex items-center justify-between px-1'>
        <span className='font-medium text-muted-foreground text-xs'>Items</span>
        <AddItemPopover
          open={addOpen}
          onOpenChange={setAddOpen}
          items={items}
          currency={currency}
          onPick={handleAddItem}
        />
      </div>

      {entries.length === 0 ? (
        <div className='rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground'>
          No items yet — add one to build this group.
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          modifiers={[restrictToVerticalAxis]}>
          <SortableContext items={entries.map((e) => e.id)} strategy={verticalListSortingStrategy}>
            <div className='flex flex-col gap-0.5'>
              {entries.map((entry) => (
                <GroupEntryRow
                  key={entry.id}
                  entry={entry}
                  item={itemMap.get(entry.catalogItemId)}
                  currency={currency}
                  onPatch={(patch) => handlePatch(entry.id, patch)}
                  onRemove={() => handleRemove(entry.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  )
}

function GroupEntryRow({
  entry,
  item,
  currency,
  onPatch,
  onRemove,
}: {
  entry: CatalogGroupEntry
  item: CatalogItem | undefined
  currency: string
  onPatch: (patch: Partial<CatalogGroupEntry>) => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.id,
  })
  const [expanded, setExpanded] = useState(false)
  const [qtyDraft, setQtyDraft] = useState<string | null>(null)
  const [descDraft, setDescDraft] = useState<string | null>(null)

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.8 : 1,
  }

  const dragHandle = (
    <span {...attributes} {...listeners} className='cursor-grab touch-none'>
      <GripVertical className='size-4' />
    </span>
  )

  const commitQty = () => {
    if (qtyDraft === null) return
    const trimmed = qtyDraft.trim()
    setQtyDraft(null)
    const parsed = Number(trimmed)
    if (!trimmed || Number.isNaN(parsed) || parsed <= 0) return
    onPatch({ qty: parsed })
  }

  const commitDescription = () => {
    if (descDraft === null) return
    onPatch({ description: descDraft.trim() || null })
    setDescDraft(null)
  }

  // Tri-state cycle: inherit (absent) → taxable → not taxable → inherit.
  function cycleTaxable() {
    if (entry.taxable === undefined) onPatch({ taxable: true })
    else if (entry.taxable === true) onPatch({ taxable: false })
    else onPatch({ taxable: undefined })
  }

  // Dangling entry — the referenced catalog item no longer resolves. Deleting a
  // product doesn't rewrite groups; this row is where staleness surfaces.
  if (!item) {
    return (
      <div ref={setNodeRef} style={style}>
        <TreeRow
          icon={dragHandle}
          title={<span className='text-destructive text-sm'>Deleted item</span>}
          rowClassName='bg-destructive/5 hover:bg-destructive/10'
          secondary={<span className='text-destructive/70 text-xs'>Qty {entry.qty}</span>}
          actions={
            <TreeRowButton tooltipText='Remove' variant='destructive' onClick={onRemove}>
              <X />
            </TreeRowButton>
          }
        />
      </div>
    )
  }

  const subtotal =
    item.defaultUnitPriceCents === null ? null : item.defaultUnitPriceCents * entry.qty
  const TaxableIcon =
    entry.taxable === undefined ? CircleDashed : entry.taxable ? CircleCheck : CircleX
  const taxableLabel =
    entry.taxable === undefined
      ? `Inherit (${item.taxable ? 'taxable' : 'not taxable'})`
      : entry.taxable
        ? 'Taxable'
        : 'Not taxable'

  return (
    <div ref={setNodeRef} style={style} className='flex flex-col'>
      <TreeRow
        icon={dragHandle}
        title={<span className={cn('text-sm', !item.active && 'opacity-60')}>{item.name}</span>}
        rowClassName='bg-primary-50 hover:bg-primary-100'
        secondary={
          <span className='truncate text-muted-foreground text-xs'>
            {formatMoney(item.defaultUnitPriceCents, currency)} × {entry.qty}
            {subtotal !== null && ` = ${formatMoney(subtotal, currency)}`}
          </span>
        }
        actions={
          <div className='flex items-center gap-1'>
            <input
              value={qtyDraft ?? String(entry.qty)}
              onChange={(e) => setQtyDraft(e.target.value)}
              onBlur={commitQty}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') setQtyDraft(null)
              }}
              inputMode='decimal'
              className='w-10 rounded-sm border-none bg-transparent px-1 text-right text-xs tabular-nums outline-none hover:bg-primary-100/60 focus:bg-primary-100/80'
            />
            <TreeRowButton
              tooltipText='Description override'
              onClick={() => setExpanded((v) => !v)}>
              <Pencil />
            </TreeRowButton>
            <TreeRowButton tooltipText={taxableLabel} onClick={cycleTaxable}>
              <TaxableIcon />
            </TreeRowButton>
            <TreeRowButton tooltipText='Remove' variant='destructive' onClick={onRemove}>
              <X />
            </TreeRowButton>
          </div>
        }
      />
      {expanded && (
        <div className='pb-1.5 pl-9 pr-1'>
          <input
            value={descDraft ?? entry.description ?? ''}
            onChange={(e) => setDescDraft(e.target.value)}
            onBlur={commitDescription}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') setDescDraft(null)
            }}
            placeholder={item.description || 'Description override'}
            className='w-full rounded-md border border-primary-200/60 bg-transparent px-2 py-1 text-xs outline-none dark:border-[#2c313a]'
          />
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// "Add item" popover — a slim local copy of catalog-picker.tsx's grouped
// Command list, over ACTIVE catalog items only (catalog-picker itself is
// line-oriented and doesn't fit this shape).
// ─────────────────────────────────────────────────────────────────────────────

function titleCase(value: string): string {
  return value.length ? value[0].toUpperCase() + value.slice(1) : value
}

function AddItemPopover({
  open,
  onOpenChange,
  items,
  currency,
  onPick,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: CatalogItem[]
  currency: string
  onPick: (catalogItemId: string) => void
}) {
  const [query, setQuery] = useState('')

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const active = items.filter((item) => item.active)
    const filtered = q ? active.filter((item) => item.name.toLowerCase().includes(q)) : active

    const byCategory = new Map<string, CatalogItem[]>()
    for (const item of filtered) {
      const bucket = byCategory.get(item.category) ?? []
      bucket.push(item)
      byCategory.set(item.category, bucket)
    }

    return [...byCategory.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, rows]) => ({
        category,
        rows: rows.sort((a, b) => a.name.localeCompare(b.name)),
      }))
  }, [items, query])

  const hasAnyMatch = groups.some((g) => g.rows.length > 0)

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (next) setQuery('')
      }}>
      <PopoverTrigger asChild>
        <Button variant='outline' size='xs'>
          <Plus />
          Add item
        </Button>
      </PopoverTrigger>
      <PopoverContent align='end' className='w-[280px] p-0'>
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder='Search products & services…'
          />
          <CommandList>
            {!hasAnyMatch && <CommandEmpty>No active items</CommandEmpty>}
            {groups.map(
              (group) =>
                group.rows.length > 0 && (
                  <CommandGroup key={group.category} heading={titleCase(group.category)}>
                    {group.rows.map((item) => (
                      <CommandItem
                        key={item.id}
                        value={item.id}
                        onSelect={() => onPick(item.id)}
                        className='flex items-center justify-between gap-2'>
                        <span className='truncate'>{item.name}</span>
                        <span className='shrink-0 text-muted-foreground text-xs'>
                          {formatMoney(item.defaultUnitPriceCents, currency)}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
