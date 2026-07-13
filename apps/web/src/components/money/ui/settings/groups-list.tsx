// apps/web/src/components/money/ui/settings/groups-list.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { InputSearch } from '@auxx/ui/components/input-search'
import { Switch } from '@auxx/ui/components/switch'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { Boxes, Plus } from 'lucide-react'
import { useState } from 'react'
import { useSettings } from '~/hooks/use-settings'
import { api } from '~/trpc/react'
import { type CatalogGroup, useCatalogGroups } from '../../hooks/use-catalog-groups'
import { useCatalogItems } from '../../hooks/use-catalog-items'
import { formatMoney } from './format-money'
import type { TaxRate } from './tax-rate-types'

interface GroupsListProps {
  selectedId: string | null
  onSelect: (id: string) => void
  currency: string
}

/**
 * Left column of the Product groups tab: search + "Add group" above a flat
 * `TreeRow` list (products-list.tsx master–detail recipe). Rows show a Boxes
 * icon · name · "N items · computed total" + discount/tax badges when set ·
 * a trailing active `Switch`.
 */
export function GroupsList({ selectedId, onSelect, currency }: GroupsListProps) {
  const { groups, entityDefinitionId, isLoading, refresh, appendRecord } = useCatalogGroups()
  const { itemMap } = useCatalogItems()
  const { getSetting } = useSettings({ scope: 'DOCUMENTS' })
  const taxRates = (getSetting('documents.taxRates') as TaxRate[] | null) ?? []
  const [search, setSearch] = useState('')

  const updateRecord = api.record.update.useMutation()
  const createRecord = api.record.create.useMutation({
    onError: (error) => toastError({ title: 'Error creating group', description: error.message }),
  })

  // Optimistic overlay for the active toggle — `record.update` bypasses the
  // granular field-value store, so reflect the flip locally and invalidate
  // `listAll` in the background rather than waiting on a full refetch.
  const [activeOverride, setActiveOverride] = useState<Record<string, boolean>>({})
  const effectiveActive = (group: CatalogGroup) => activeOverride[group.id] ?? group.active

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
    const next = !effectiveActive(group)
    setActiveOverride((prev) => ({ ...prev, [group.id]: next }))
    updateRecord.mutate(
      { recordId: group.recordId, values: { catalog_group_active: next } },
      {
        onSuccess: () => refresh(),
        onError: (error) => {
          setActiveOverride((prev) => ({ ...prev, [group.id]: !next }))
          toastError({ title: 'Error updating group', description: error.message })
        },
      }
    )
  }

  async function handleAdd() {
    if (!entityDefinitionId) return
    const result = await createRecord.mutateAsync({
      entityDefinitionId,
      values: { catalog_group_name: 'New group' },
    })
    appendRecord({
      ...result.instance,
      recordId: result.recordId,
      fieldValues: { catalog_group_name: 'New group', ...result.values },
    })
    onSelect(result.instance.id)
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
        <Button
          variant='outline'
          size='sm'
          onClick={handleAdd}
          loading={createRecord.isPending}
          loadingText='Adding...'
          disabled={!entityDefinitionId}>
          <Plus />
          Add group
        </Button>
      </div>

      {isLoading ? (
        <div className='p-4 text-center text-sm text-muted-foreground'>Loading…</div>
      ) : filtered.length === 0 ? (
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
                  !effectiveActive(group) && 'opacity-60'
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
                  <Switch
                    size='xs'
                    checked={effectiveActive(group)}
                    onCheckedChange={() => handleToggleActive(group)}
                    disabled={updateRecord.isPending}
                  />
                }
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
