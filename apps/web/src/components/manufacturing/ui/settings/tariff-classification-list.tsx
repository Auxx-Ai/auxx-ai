// apps/web/src/components/manufacturing/ui/settings/tariff-classification-list.tsx
'use client'

// The left column of the Classification tab (money 30-tariff-offer-surfaces.md
// §6.1): one row for EVERY priced supplier offer, classified or not, so the
// list is a checklist rather than a table dump - the direct analogue of the
// Roles tab on `accounting/settings/accounts`.
//
// Filter chips are client-side over the loaded set. Unclassified is the
// checklist; Override is "who is still on the old hand-keyed number"; a country
// is "show me everything from China", which is 29 §0's literal scenario and the
// reason the pointer lives on the offer and not the part (29 §4).

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { InputSearch } from '@auxx/ui/components/input-search'
import { EmptySection } from '@auxx/ui/components/section'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { Package } from 'lucide-react'
import { useMemo, useState } from 'react'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import type { ClassifiedOffer } from '../../hooks/use-offer-classification'
import { formatPercent } from '../../hooks/use-offer-tariffs'

type Filter = 'all' | 'unclassified' | 'override' | `country:${string}`

interface TariffClassificationListProps {
  offers: ClassifiedOffer[]
  /** ISO-2 -> offer count, for the country chips. */
  countries: Map<string, number>
  /** ISO-2 -> country name. */
  countryLabels: Map<string, string>
  isLoading: boolean
  selectedId: string | null
  onSelect: (id: string | null) => void
}

export function TariffClassificationList({
  offers,
  countries,
  countryLabels,
  isLoading,
  selectedId,
  onSelect,
}: TariffClassificationListProps) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  // 🛑 Paged, and not for scroll performance. Every row mounts two
  // `RecordBadge`s (part, supplier), each of which asks the relationship store
  // to hydrate its record, and the store batches those into ONE
  // `record.getByIds` GET - 202 offers put 400 ids on the query string and the
  // dev server answered 431 Request Header Fields Too Large for every batch
  // (driven 2026-09-01). Fifty rows keeps a batch under the limit; the rest
  // arrive on demand.
  const [limit, setLimit] = useState(PAGE_SIZE)
  const changeFilter = (next: Filter) => {
    setFilter(next)
    setLimit(PAGE_SIZE)
  }
  const changeSearch = (next: string) => {
    setSearch(next)
    setLimit(PAGE_SIZE)
  }

  const counts = useMemo(
    () => ({
      unclassified: offers.filter((o) => !o.tariffCodeId && o.tariffRate == null).length,
      override: offers.filter((o) => o.tariffRate != null).length,
    }),
    [offers]
  )

  const query = search.trim().toLowerCase()
  const filtered = offers.filter((offer) => {
    if (filter === 'unclassified' && (offer.tariffCodeId || offer.tariffRate != null)) return false
    if (filter === 'override' && offer.tariffRate == null) return false
    if (filter.startsWith('country:') && offer.country !== filter.slice('country:'.length)) {
      return false
    }
    if (!query) return true
    return (offer.codeLabel ?? '').toLowerCase().includes(query)
  })

  return (
    <div className='flex flex-col gap-3 p-3'>
      <InputSearch
        value={search}
        onChange={(e) => changeSearch(e.target.value)}
        placeholder='Search by tariff code...'
      />

      <div className='flex flex-wrap items-center gap-1.5'>
        <FilterChip active={filter === 'all'} onClick={() => changeFilter('all')}>
          All ({offers.length})
        </FilterChip>
        <FilterChip active={filter === 'unclassified'} onClick={() => changeFilter('unclassified')}>
          Unclassified ({counts.unclassified})
        </FilterChip>
        <FilterChip active={filter === 'override'} onClick={() => changeFilter('override')}>
          Override ({counts.override})
        </FilterChip>
        {[...countries.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([iso, count]) => (
            <FilterChip
              key={iso}
              active={filter === `country:${iso}`}
              onClick={() => changeFilter(`country:${iso}`)}>
              {countryLabels.get(iso) ?? iso} ({count})
            </FilterChip>
          ))}
      </div>

      {isLoading ? (
        <EmptySection loading />
      ) : filtered.length === 0 ? (
        <EmptySection
          icon={<Package className='size-5' />}
          title={
            offers.length === 0
              ? 'No priced supplier offers'
              : filter === 'unclassified'
                ? 'Every priced offer is classified'
                : 'No matches'
          }
          description={
            offers.length === 0
              ? 'Add a supplier with a unit price to a part and it appears here to be classified.'
              : undefined
          }
        />
      ) : (
        <div className={cn('flex flex-col gap-0.5', TREE_SECONDARY_NOTRUNCATE)}>
          {filtered.slice(0, limit).map((offer) => (
            <TreeRow
              key={offer.id}
              icon={<Package className='size-4 text-muted-foreground' />}
              title={
                <span className='flex min-w-0 items-center gap-1.5'>
                  {offer.partRecordId ? (
                    <RecordBadge recordId={offer.partRecordId} showIcon={false} />
                  ) : (
                    <span className='text-muted-foreground'>-</span>
                  )}
                  {offer.supplierRecordId && (
                    <>
                      <span className='text-muted-foreground text-xs'>from</span>
                      <RecordBadge recordId={offer.supplierRecordId} showIcon={false} />
                    </>
                  )}
                </span>
              }
              secondaryFill
              onToggleOpen={() => onSelect(offer.id)}
              rowClassName={cn(
                'bg-primary-100/50 hover:bg-primary-100',
                selectedId === offer.id && 'bg-primary-100 ring-1 ring-primary-200'
              )}
              secondary={<OfferBadges offer={offer} />}
            />
          ))}
          {filtered.length > limit && (
            <Button
              variant='ghost'
              size='sm'
              className='mt-1 self-center'
              onClick={() => setLimit((current) => current + PAGE_SIZE)}>
              Show {Math.min(PAGE_SIZE, filtered.length - limit)} more of {filtered.length}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

const PAGE_SIZE = 50

/**
 * The row's reading. Same three-state discipline as the Codes list, plus the
 * two states only an offer has: Unclassified (no code, no override) and
 * Override (a hand-keyed rate beating whatever the code says).
 */
function OfferBadges({ offer }: { offer: ClassifiedOffer }) {
  const { tariff } = offer
  return (
    <span className='flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs'>
      {offer.codeLabel && <span className='tabular-nums'>{offer.codeLabel}</span>}
      {tariff.source === 'none' && (
        <Badge
          variant='outline'
          size='xs'
          title='No tariff code and no override. Estimated with no duty.'>
          Unclassified
        </Badge>
      )}
      {tariff.source === 'override' && (
        <>
          <Badge
            variant='amber'
            size='xs'
            title='A hand-keyed rate; the schedule is ignored for this offer.'>
            Override
          </Badge>
          <span className='tabular-nums'>{formatPercent(tariff.rate)}</span>
        </>
      )}
      {tariff.source === 'schedule' && tariff.status === 'resolved' && (
        <Badge variant='green' size='xs'>
          {formatPercent(tariff.rate)}
        </Badge>
      )}
      {tariff.source === 'schedule' && tariff.status === 'pending' && (
        <Badge variant='outline' size='xs' title='Every row on this code takes effect after today.'>
          Starts later
        </Badge>
      )}
      {tariff.source === 'schedule' && tariff.status === 'unclassified' && (
        <Badge
          variant='destructive'
          size='xs'
          title='The code has no rate rows, so this offer is estimated with no duty.'>
          No rate on code
        </Badge>
      )}
    </span>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button variant={active ? 'default' : 'outline'} size='xs' onClick={onClick}>
      {children}
    </Button>
  )
}
