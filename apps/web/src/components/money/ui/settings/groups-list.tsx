// apps/web/src/components/money/ui/settings/groups-list.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { InputSearch } from '@auxx/ui/components/input-search'
import { Switch } from '@auxx/ui/components/switch'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { Boxes, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import { useConfirm } from '~/hooks/use-confirm'
import { useSettings } from '~/hooks/use-settings'
import { api } from '~/trpc/react'
import { type CatalogGroup, useCatalogGroups } from '../../hooks/use-catalog-groups'
import { useCatalogItems } from '../../hooks/use-catalog-items'
import type { CatalogDraftHandle } from './catalog-draft-types'
import { formatMoney } from './format-money'
import type { TaxRate } from './tax-rate-types'

interface GroupsListProps {
  selectedId: string | null
  onSelect: (id: string | null) => void
  currency: string
  /** Phantom draft, owned by `products-services-page.tsx`. */
  draft: CatalogDraftHandle | null
  /** "Add group" — creates a fresh draft, or re-selects the existing one. */
  onAddDraft: () => void
}

/**
 * Left column of the Product groups tab: search + "Add group" above a flat
 * `TreeRow` list (products-list.tsx master–detail recipe). Rows show a Boxes
 * icon · name · "N items · computed total" + discount/tax badges when set ·
 * a trailing active `Switch`. A phantom draft (if any) renders as a final,
 * action-less row.
 */
export function GroupsList({ selectedId, onSelect, currency, draft, onAddDraft }: GroupsListProps) {
  const { groups, entityDefinitionId, isLoading, removeRecord } = useCatalogGroups()
  const { itemMap } = useCatalogItems()
  const { getSetting } = useSettings({ scope: 'DOCUMENTS' })
  const taxRates = (getSetting('documents.taxRates') as TaxRate[] | null) ?? []
  const [search, setSearch] = useState('')
  const [confirm, ConfirmDialog] = useConfirm()

  const { saveFieldValue } = useSaveFieldValue({})
  const deleteRecord = api.record.delete.useMutation({
    onError: (error) => toastError({ title: 'Error deleting group', description: error.message }),
  })

  async function handleDelete(group: CatalogGroup) {
    const confirmed = await confirm({
      title: 'Delete group?',
      description: `“${group.name}” will be removed. Its items stay in the catalog.`,
      confirmText: 'Delete',
      destructive: true,
    })
    if (!confirmed) return
    deleteRecord.mutate(
      { recordId: group.recordId },
      {
        onSuccess: () => {
          removeRecord(group.id)
          if (selectedId === group.id) onSelect(null)
        },
      }
    )
  }

  function computeTotal(group: CatalogGroup): number | null {
    let total = 0
    let hasResolved = false
    for (const entry of group.entries) {
      const item = itemMap.get(entry.catalogItemId)
      if (!item || item.defaultUnitPriceCents === null) continue
      hasResolved = true
      total += item.defaultUnitPriceCents * entry.qty
    }
    return hasResolved ? total : null
  }

  function discountBadge(group: CatalogGroup) {
    if (!group.discountType || group.discountValue === null) return null
    const label =
      group.discountType === 'percent'
        ? `${group.discountValue}% off`
        : `${formatMoney(group.discountValue, currency)} off`
    return (
      <Badge variant='outline' size='xs' className='border-0 bg-primary-100 text-foreground'>
        {label}
      </Badge>
    )
  }

  function taxBadge(group: CatalogGroup) {
    if (!group.taxRateId) return null
    const preset = taxRates.find((r) => r.id === group.taxRateId)
    if (!preset) return null
    return (
      <Badge variant='outline' size='xs' className='border-0 bg-primary-100 text-foreground'>
        {preset.name} ({preset.rate}%)
      </Badge>
    )
  }

  function handleToggleActive(group: CatalogGroup) {
    saveFieldValue(group.recordId, 'catalog_group_active', !group.active, FieldType.CHECKBOX)
  }

  const filtered = search
    ? groups.filter((group) => group.name.toLowerCase().includes(search.toLowerCase()))
    : groups

  return (
    <div className='flex flex-col gap-3 p-3'>
      <div className='flex items-center gap-2'>
        <InputSearch
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder='Search product groups...'
        />
        <Button variant='outline' size='sm' onClick={onAddDraft} disabled={!entityDefinitionId}>
          <Plus />
          Add group
        </Button>
      </div>

      {isLoading ? (
        <div className='p-4 text-center text-sm text-muted-foreground'>Loading…</div>
      ) : filtered.length === 0 && !draft ? (
        <div className='p-4 text-center text-sm text-muted-foreground'>
          {search ? 'No matches' : 'No product groups yet — add your first one.'}
        </div>
      ) : (
        <div className='flex flex-col gap-0.5'>
          {filtered.map((group) => {
            const total = computeTotal(group)
            return (
              <TreeRow
                key={group.id}
                icon={<Boxes className='size-4 text-muted-foreground' />}
                title={group.name}
                onToggleOpen={() => onSelect(group.id)}
                rowClassName={cn(
                  'bg-primary-100/50 hover:bg-primary-100',
                  selectedId === group.id && 'bg-primary-100 ring-1 ring-primary-200',
                  !group.active && 'opacity-60'
                )}
                secondary={
                  <span className='flex items-center gap-1.5 text-xs text-muted-foreground'>
                    {group.entries.length} {group.entries.length === 1 ? 'item' : 'items'}
                    {total !== null && ` · ${formatMoney(total, currency)}`}
                    {discountBadge(group)}
                    {taxBadge(group)}
                  </span>
                }
                actions={
                  <div className='flex items-center gap-1'>
                    <TreeRowButton
                      tooltipText='Delete group'
                      variant='destructive'
                      onClick={() => handleDelete(group)}>
                      <Trash2 />
                    </TreeRowButton>
                    <Switch
                      size='xs'
                      checked={group.active}
                      onCheckedChange={() => handleToggleActive(group)}
                    />
                  </div>
                }
              />
            )
          })}
          {draft && !draft.recordId && (
            <TreeRow
              key={draft.draftId}
              icon={<Boxes className='size-4 text-muted-foreground' />}
              title={
                <span className={cn('text-sm', !draft.name && 'text-muted-foreground italic')}>
                  {draft.name || 'Untitled group'}
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
