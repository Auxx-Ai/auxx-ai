// apps/web/src/components/manufacturing/ui/settings/tariff-codes-list.tsx
'use client'

// The left column of the Codes tab: search and an Add button above a flat
// `TreeRow` list of the org's `tariff_code` records.
//
// Each row carries its composed label (`8481.80.9005 CN`), its description, and
// the rate it resolves to TODAY. That last one is why this list reads the whole
// rate table rather than the selected code's rows - the resolved number is what
// makes the list a schedule instead of a glossary.
//
// 🛑 The phantom row is what makes the draft's buffering visible. Between "Add
// code" and the Create button becoming enabled, the only evidence that anything
// is happening is this row tracking what is being typed - without it the person
// is filling in a form with no place in the list. `chart-list.tsx` is the
// pattern.
//
// 🛑 A code whose rows are ALL non-blank authorities is marked, not just
// totalled. §3's rule sums one row per authority, so a 301 row with no MFN row
// behind it resolves to 25% instead of 27% - arithmetically consistent, and
// understated by exactly the base duty. That state has to be visible from the
// list, because the number itself gives nothing away.

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { InputSearch } from '@auxx/ui/components/input-search'
import { EmptySection } from '@auxx/ui/components/section'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { BookOpen, Globe, Plus } from 'lucide-react'
import { useState } from 'react'
import {
  composeTariffLabel,
  resolutionBadge,
  resolveScheduleAt,
  type TariffCode,
  type TariffCodeDraft,
  type TariffRate,
} from '../../tariff-types'

interface TariffCodesListProps {
  codes: TariffCode[]
  ratesByCode: Map<string, TariffRate[]>
  /** One `Date` for the whole page, so every row agrees on what "today" is. */
  today: Date
  /** The org's book timezone. Never the viewer's, and never UTC by default. */
  bookTimeZone: string
  /** ISO-2 -> country name, so a row can read `China` rather than only `CN`. */
  countryLabels: Map<string, string>
  /** True while the two `listAll` reads are in flight. An empty schedule and an
   *  unloaded one are different answers and must not render the same. */
  isLoading: boolean
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** The uncommitted draft, if any. Rendered as a phantom row at the top. */
  draft: TariffCodeDraft | null
  onAddDraft: () => void
  /** Opens the "Add from catalogue" dialog (money 32 §3). */
  onAddFromCatalogue: () => void
  /** False when the viewer cannot write `tariff_code` - Add hides. */
  canEdit: boolean
}

export function TariffCodesList({
  codes,
  ratesByCode,
  today,
  bookTimeZone,
  countryLabels,
  isLoading,
  selectedId,
  onSelect,
  draft,
  onAddDraft,
  onAddFromCatalogue,
  canEdit,
}: TariffCodesListProps) {
  const [search, setSearch] = useState('')

  // A schedule is tens of rows, recomputed per keystroke. A `useMemo` here would
  // cost more to read than the loop costs to run.
  const query = search.trim().toLowerCase()
  const filtered = query
    ? codes.filter((code) => {
        const country = code.country ?? ''
        return (
          code.code.toLowerCase().includes(query) ||
          country.toLowerCase().includes(query) ||
          (countryLabels.get(country) ?? '').toLowerCase().includes(query) ||
          (code.description ?? '').toLowerCase().includes(query)
        )
      })
    : codes

  // Hidden once `recordId` is stamped: the real row arrived with the seeded
  // cache, and rendering both would show the same code twice.
  const phantom = draft && !draft.recordId ? draft : null

  return (
    <div className='flex flex-col gap-3 p-3'>
      <div className='flex items-center gap-2'>
        <InputSearch
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder='Search codes, countries, descriptions...'
          className='flex-1'
        />
        {canEdit && (
          <>
            <Button variant='outline' size='sm' onClick={onAddFromCatalogue}>
              <BookOpen />
              From catalogue
            </Button>
            <Button variant='outline' size='sm' onClick={onAddDraft}>
              <Plus />
              Add code
            </Button>
          </>
        )}
      </div>

      {isLoading ? (
        <EmptySection loading />
      ) : filtered.length === 0 && !phantom ? (
        <EmptySection
          icon={<Globe className='size-5' />}
          title={search ? 'No matches' : 'No tariff codes yet'}
          description={
            search
              ? undefined
              : 'A code is a classification for an origin - 8481.80.9005 from China and from Germany are two records. Add the ones you import against, then put the rates behind them.'
          }
        />
      ) : (
        // `TREE_SECONDARY_NOTRUNCATE`: the `secondary` slot truncates by default,
        // which clips a Badge's pill edges. These rows carry badges.
        <div className={cn('flex flex-col gap-0.5', TREE_SECONDARY_NOTRUNCATE)}>
          {phantom && (
            <TreeRow
              key={phantom.draftId}
              icon={<Globe className='size-4 text-muted-foreground' />}
              title={
                <span className='flex items-baseline gap-2'>
                  <span className='text-sm tabular-nums'>
                    {composeTariffLabel(phantom.code || '-', phantom.country)}
                  </span>
                </span>
              }
              secondaryFill
              onToggleOpen={() => onSelect(phantom.draftId)}
              rowClassName={cn(
                'bg-primary-100/50 hover:bg-primary-100',
                selectedId === phantom.draftId && 'bg-primary-100 ring-1 ring-primary-200'
              )}
              secondary={
                <span className='text-muted-foreground text-xs italic'>Not created yet</span>
              }
            />
          )}

          {filtered.map((code) => {
            const resolution = resolveScheduleAt(
              ratesByCode.get(code.id) ?? [],
              today,
              bookTimeZone
            )
            const badge = resolutionBadge(resolution)
            const countryName = code.country ? countryLabels.get(code.country) : undefined
            return (
              <TreeRow
                key={code.id}
                icon={<Globe className='size-4 text-muted-foreground' />}
                title={
                  <span className='text-sm tabular-nums'>
                    {composeTariffLabel(code.code, code.country)}
                  </span>
                }
                secondaryFill
                onToggleOpen={() => onSelect(code.id)}
                rowClassName={cn(
                  'bg-primary-100/50 hover:bg-primary-100',
                  selectedId === code.id && 'bg-primary-100 ring-1 ring-primary-200'
                )}
                secondary={
                  <span className='flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs'>
                    <Badge
                      variant={badge.variant}
                      size='xs'
                      className='shrink-0'
                      title={badge.title}>
                      {badge.label}
                    </Badge>
                    <span className='min-w-0 truncate'>
                      {code.description || countryName || ''}
                    </span>
                  </span>
                }
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
