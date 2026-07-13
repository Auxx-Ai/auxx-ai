// apps/web/src/components/money/ui/settings/products-list.tsx
'use client'

import { getOptionColor, type SelectOptionColor } from '@auxx/lib/custom-fields/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { InputSearch } from '@auxx/ui/components/input-search'
import { Switch } from '@auxx/ui/components/switch'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { Package, Plus, Trash2, Wrench } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useResourceFields } from '~/components/resources'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { type CatalogItem, useCatalogItems } from '../../hooks/use-catalog-items'
import { formatMoney } from './format-money'

interface ProductsListProps {
  selectedId: string | null
  onSelect: (id: string) => void
  currency: string
}

/** Category → row icon. Falls back to the generic `service` icon for org-added options. */
function CategoryIcon({ category }: { category: string }) {
  return category === 'material' ? (
    <Package className='size-4 text-muted-foreground' />
  ) : (
    <Wrench className='size-4 text-muted-foreground' />
  )
}

/**
 * Left column of the Products & Services tab: search + "Add item" above a
 * flat `TreeRow` list (mcp-server-tools-tab master–detail recipe). Rows show
 * category icon · name · price + category badge · a trailing active `Switch`.
 */
export function ProductsList({ selectedId, onSelect, currency }: ProductsListProps) {
  const { items, entityDefinitionId, isLoading, refresh, appendRecord } = useCatalogItems()
  const { fields: catalogFields } = useResourceFields('catalog-items')
  const categoryOptions = useMemo(
    () => catalogFields.find((f) => f.key === 'category')?.options?.options ?? [],
    [catalogFields]
  )
  const [search, setSearch] = useState('')
  const [confirm, ConfirmDialog] = useConfirm()

  const updateRecord = api.record.update.useMutation()
  const createRecord = api.record.create.useMutation({
    onError: (error) => toastError({ title: 'Error creating item', description: error.message }),
  })
  const deleteRecord = api.record.delete.useMutation({
    onSuccess: () => refresh(),
    onError: (error) => toastError({ title: 'Error deleting item', description: error.message }),
  })

  async function handleDelete(item: CatalogItem) {
    const confirmed = await confirm({
      title: 'Delete item?',
      description: `“${item.name}” will be removed from the catalog. Existing document lines are unaffected.`,
      confirmText: 'Delete',
      destructive: true,
    })
    if (confirmed) deleteRecord.mutate({ recordId: item.recordId })
  }

  // Optimistic overlay for the active toggle — `record.update` bypasses the
  // granular field-value store, so reflect the flip locally and invalidate
  // `listAll` in the background rather than waiting on a full refetch.
  const [activeOverride, setActiveOverride] = useState<Record<string, boolean>>({})
  const effectiveActive = (item: CatalogItem) => activeOverride[item.id] ?? item.active

  function categoryBadge(category: string) {
    const option = categoryOptions.find((o) => o.value === category)
    const colorData = getOptionColor((option?.color ?? 'gray') as SelectOptionColor)
    return (
      <Badge variant='outline' size='xs' className={cn('border-0', colorData.badgeClasses)}>
        {option?.label ?? category}
      </Badge>
    )
  }

  function handleToggleActive(item: CatalogItem) {
    const next = !effectiveActive(item)
    setActiveOverride((prev) => ({ ...prev, [item.id]: next }))
    updateRecord.mutate(
      { recordId: item.recordId, values: { catalog_item_active: next } },
      {
        onSuccess: () => refresh(),
        onError: (error) => {
          setActiveOverride((prev) => ({ ...prev, [item.id]: !next }))
          toastError({ title: 'Error updating item', description: error.message })
        },
      }
    )
  }

  async function handleAdd() {
    if (!entityDefinitionId) return
    const result = await createRecord.mutateAsync({
      entityDefinitionId,
      values: { catalog_item_name: 'New item' },
    })
    appendRecord({
      ...result.instance,
      recordId: result.recordId,
      fieldValues: { catalog_item_name: 'New item', ...result.values },
    })
    onSelect(result.instance.id)
  }

  const filtered = search
    ? items.filter((item) => item.name.toLowerCase().includes(search.toLowerCase()))
    : items

  return (
    <div className='flex flex-col gap-3 p-3'>
      <div className='flex items-center gap-2'>
        <InputSearch
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder='Search products & services...'
        />
        <Button
          variant='outline'
          size='sm'
          onClick={handleAdd}
          loading={createRecord.isPending}
          loadingText='Adding...'
          disabled={!entityDefinitionId}>
          <Plus />
          Add item
        </Button>
      </div>

      {isLoading ? (
        <div className='p-4 text-center text-sm text-muted-foreground'>Loading…</div>
      ) : filtered.length === 0 ? (
        <div className='p-4 text-center text-sm text-muted-foreground'>
          {search ? 'No matches' : 'No products or services yet — add your first item.'}
        </div>
      ) : (
        <div className='flex flex-col gap-0.5'>
          {filtered.map((item) => (
            <TreeRow
              key={item.id}
              icon={<CategoryIcon category={item.category} />}
              title={item.name}
              onToggleOpen={() => onSelect(item.id)}
              rowClassName={cn(
                'bg-primary-100/50 hover:bg-primary-100',
                selectedId === item.id && 'bg-primary-100 ring-1 ring-primary-200',
                !effectiveActive(item) && 'opacity-60'
              )}
              secondary={
                <span className='flex items-center gap-1.5 text-xs text-muted-foreground'>
                  {formatMoney(item.defaultUnitPriceCents, currency)}
                  {categoryBadge(item.category)}
                </span>
              }
              actions={
                <div className='flex items-center gap-1'>
                  <TreeRowButton
                    tooltipText='Delete item'
                    variant='destructive'
                    onClick={() => handleDelete(item)}>
                    <Trash2 />
                  </TreeRowButton>
                  <Switch
                    size='xs'
                    checked={effectiveActive(item)}
                    onCheckedChange={() => handleToggleActive(item)}
                    disabled={updateRecord.isPending}
                  />
                </div>
              }
            />
          ))}
        </div>
      )}
      <ConfirmDialog />
    </div>
  )
}
