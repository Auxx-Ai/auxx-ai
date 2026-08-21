// apps/web/src/components/money/ui/settings/products-list.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { getOptionColor } from '@auxx/lib/custom-fields/client'
import type { SelectOptionColor } from '@auxx/types/custom-field'
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
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { type CatalogItem, useCatalogItems } from '../../hooks/use-catalog-items'
import type { CatalogDraftHandle } from './catalog-draft-types'
import { formatMoney } from './format-money'

interface ProductsListProps {
  selectedId: string | null
  onSelect: (id: string | null) => void
  currency: string
  /** Phantom draft, owned by `products-services-page.tsx`. */
  draft: CatalogDraftHandle | null
  /** "Add item" — creates a fresh draft, or re-selects the existing one. */
  onAddDraft: () => void
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
 * A phantom draft (if any) renders as a final, action-less row.
 */
export function ProductsList({
  selectedId,
  onSelect,
  currency,
  draft,
  onAddDraft,
}: ProductsListProps) {
  const { items, entityDefinitionId, isLoading, removeRecord } = useCatalogItems()
  const { fields: catalogFields } = useResourceFields('catalog-items')
  const categoryOptions = useMemo(
    () => catalogFields.find((f) => f.key === 'category')?.options?.options ?? [],
    [catalogFields]
  )
  const [search, setSearch] = useState('')
  const [confirm, ConfirmDialog] = useConfirm()

  const { saveFieldValue } = useSaveFieldValue({})
  const deleteRecord = api.record.delete.useMutation({
    onError: (error) => toastError({ title: 'Error deleting item', description: error.message }),
  })

  async function handleDelete(item: CatalogItem) {
    const confirmed = await confirm({
      title: 'Delete item?',
      description: `“${item.name}” will be removed from the catalog. Existing document lines are unaffected.`,
      confirmText: 'Delete',
      destructive: true,
    })
    if (!confirmed) return
    deleteRecord.mutate(
      { recordId: item.recordId },
      {
        onSuccess: () => {
          removeRecord(item.id)
          if (selectedId === item.id) onSelect(null)
        },
      }
    )
  }

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
    saveFieldValue(item.recordId, 'catalog_item_active', !item.active, FieldType.CHECKBOX)
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
        <Button variant='outline' size='sm' onClick={onAddDraft} disabled={!entityDefinitionId}>
          <Plus />
          Add item
        </Button>
      </div>

      {isLoading ? (
        <div className='p-4 text-center text-sm text-muted-foreground'>Loading…</div>
      ) : filtered.length === 0 && !draft ? (
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
                !item.active && 'opacity-60'
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
                    checked={item.active}
                    onCheckedChange={() => handleToggleActive(item)}
                  />
                </div>
              }
            />
          ))}
          {draft && !draft.recordId && (
            <TreeRow
              key={draft.draftId}
              icon={<CategoryIcon category='service' />}
              title={
                <span className={cn('text-sm', !draft.name && 'text-muted-foreground italic')}>
                  {draft.name || 'Untitled item'}
                </span>
              }
              onToggleOpen={() => onSelect(draft.draftId)}
              rowClassName={cn(
                'bg-primary-100/50 hover:bg-primary-100',
                selectedId === draft.draftId && 'bg-primary-100 ring-1 ring-primary-200'
              )}
            />
          )}
        </div>
      )}
      <ConfirmDialog />
    </div>
  )
}
