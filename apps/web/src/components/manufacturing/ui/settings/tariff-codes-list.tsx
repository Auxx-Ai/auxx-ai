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
// 🛑 The per-row catalogue button (money 35 §7.2) is a `TreeRowButton` in the
// `actions` slot, hover-revealed by default and `persistent` when that code has
// something waiting - so it doubles as the indicator without a second badge
// competing with the resolved rate. It belongs only inside a `TreeRow`: it is
// styled off the `group/tree-row` hover group and is inert anywhere else, and
// `TreeRow`'s `actions` wrapper already stops propagation, so pressing it does
// not also select the row.
//
// 🛑 The row's delete button is the SAME `onRemove` the detail editor calls -
// the confirm, the `record.delete` and the local list patch all live once, on
// the page. A second delete path here would be a second chance to get the
// "nothing already valued changes" wording wrong. It is hover-revealed and NOT
// `persistent`: unlike the catalogue button it advertises no state, and a
// destructive affordance sitting on every row invites a misclick. It comes
// FIRST in the slot, so the button that appears and disappears with a code's
// pending updates is the one on the outside edge - the delete button then keeps
// one position for every row instead of shifting under the pointer.
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
import { toastError } from '@auxx/ui/components/toast'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { BookOpen, BookOpenCheck, Globe, Plus, Trash2 } from 'lucide-react'
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
  /**
   * Instance id -> how many rows the catalogue would add to that code (money 35
   * §7.2). Read off the ONE plan query the page already runs; a per-row query
   * would be N round trips to render a badge.
   */
  resyncCounts: Map<string, number>
  /** Opens the catalogue-updates dialog filtered to one code. Absent hides the button. */
  onResync?: (codeInstanceId: string) => void
  /**
   * Remove a code. The page's own `handleRemoveCode` - the same one the detail
   * editor's Trash2 calls, confirm copy included. Never a second delete path.
   *
   * It REJECTS on refusal rather than swallowing, because the editor renders
   * the message as a field error. A row has no field for one to land on, so
   * this list catches and toasts - the same call `handleRemoveRate` makes on
   * the page, for the same reason.
   */
  onRemove: (code: TariffCode) => Promise<void>
  /** False when the viewer cannot write `tariff_code` - Add and Remove hide. */
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
  resyncCounts,
  onResync,
  onRemove,
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
            const pending = resyncCounts.get(code.id) ?? 0
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
                actions={
                  <>
                    {canEdit && (
                      <TreeRowButton
                        variant='destructive'
                        tooltipText='Remove code'
                        aria-label={`Remove ${composeTariffLabel(code.code, code.country)}`}
                        onClick={() => {
                          void onRemove(code).catch((error: unknown) => {
                            toastError({
                              title: 'Error removing the code',
                              description:
                                error instanceof Error
                                  ? error.message
                                  : 'Could not remove the tariff code.',
                            })
                          })
                        }}>
                        <Trash2 />
                      </TreeRowButton>
                    )}
                    {onResync && (
                      <TreeRowButton
                        persistent={pending > 0}
                        tooltipText={
                          pending > 0
                            ? `${pending} ${pending === 1 ? 'update' : 'updates'} from the catalogue`
                            : 'Check catalogue'
                        }
                        aria-label='Check the catalogue for this code'
                        onClick={() => onResync(code.id)}>
                        <BookOpenCheck />
                      </TreeRowButton>
                    )}
                  </>
                }
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
