// apps/web/src/components/manufacturing/ui/settings/tariff-starter-dialog.tsx
'use client'

// "Add from catalogue" on Parts > Settings > Tariffs (money 32 §3): pick an
// origin, search the generated HTS general-rate schedule, and adopt the picked
// codes as `tariff_code` + `tariff_rate` rows in one write through
// `purchasing.adoptTariffStarters`.
//
// 🛑 The membership hazard (32 §1.4) is why this dialog exists and it is
// non-negotiable: with the whole HTS schedule pickable, a China-origin code
// nobody has recorded a Section 301 membership for expands to MFN plus the
// origin-wide actions with a base row present, so the ordinary "no base rate"
// warning does NOT fire and the schedule is understated by exactly that list's
// rate with nothing wrong-looking about it. `membershipRecorded === false`
// renders as its own visible chip on the row, never folded into the resolved
// badge.
//
// 🛑 THE TOTAL IS NEVER SHOWN ALONE, same rule as `tariff-code-editor.tsx`'s
// `ResolutionSummary`. The preview resolves each candidate's `StarterRow`s
// through the identical `resolveScheduleAt` / `resolutionBadge` the Codes list
// renders with, by mapping them onto the page's own `TariffRate` shape - one
// resolver, reached from the server write, the Codes list, and this preview.
// The rows are ONE line each: the components live in the row's help tooltip
// (`TreeRow.description`), the resolved badge and the membership chip sit in
// the actions cluster beside the switch. A second line per row was tried and
// overlapped, because `TreeRow` is a one-line primitive.
//
// The catalogue is browsed as a tree - heading, subheading, line - one request
// per opened node. A search term PRUNES that tree at every level rather than
// flattening it: a heading survives when something under it matches and says
// how many, and a level with a single survivor opens itself so a code typed in
// full is two clicks fewer.
//
// 🛑 Pruning is also why the SELECTION TRAY is not optional. The flow this
// dialog is used with is "type a code, check it, type the next one", and the
// next search prunes the checked row straight off the screen. The selection
// itself survives - it is only reset on open and on an origin change - but
// with nothing rendering it the only evidence left was a count in the footer
// button, and there was no way to drop one without hunting it down again. So
// the picked codes are held as their whole `StarterExpansion`, not just their
// code, and rendered as removable chips above the tree.

import { FieldType } from '@auxx/database/enums'
import { toRecordId } from '@auxx/lib/resources/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Dialog, DialogContent, DialogFooter } from '@auxx/ui/components/dialog'
import { DialogNav } from '@auxx/ui/components/dialog-nav'
import { InputSearch } from '@auxx/ui/components/input-search'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { EmptySection } from '@auxx/ui/components/section'
import { Switch } from '@auxx/ui/components/switch'
import { toastError } from '@auxx/ui/components/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@auxx/ui/components/tooltip'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { keepPreviousData } from '@tanstack/react-query'
import { Globe, TriangleAlert, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
import { useDebounce } from '~/hooks/use-debounced-value'
import { api, type RouterOutputs } from '~/trpc/react'
import { useTariffCountryFieldOptions } from '../../hooks/use-tariff-schedule'
import {
  authorityLabel,
  formatRate,
  resolutionBadge,
  resolveScheduleAt,
  type TariffCode,
  type TariffRate,
} from '../../tariff-types'

type AdoptResult = RouterOutputs['purchasing']['adoptTariffStarters']
type TreeLevel = RouterOutputs['purchasing']['listTariffStarterChildren']
type StarterExpansion = TreeLevel['leaves'][number]
type TreeChildrenPage = RouterOutputs['purchasing']['listTariffStarterChildren']
type HtsNode = TreeChildrenPage['nodes'][number]

/**
 * ⚠️ A `SINGLE_SELECT` hands its value back as an ARRAY - `['CN']`. Normalise
 * at the boundary, the same call `tariff-code-editor.tsx` makes.
 */
function firstSelected(value: unknown): string | null {
  if (Array.isArray(value)) return (value[0] as string) ?? null
  return (value as string) || null
}

function digitsOf(code: string): string {
  return code.replace(/\D/g, '')
}

function existingKey(country: string | null, code: string): string {
  return `${country ?? ''}|${digitsOf(code)}`
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/** One `StarterExpansion`'s rows, mapped onto the page's `TariffRate` shape so
 *  the preview goes through the identical resolver the Codes list uses. Ids
 *  are synthesised - nothing has been written yet - through `toRecordId` so
 *  the placeholder is still a well-formed `RecordId` rather than a raw cast. */
function toPreviewRates(entry: StarterExpansion): TariffRate[] {
  return entry.rows.map((row, index) => ({
    id: `${entry.code}:${index}`,
    recordId: toRecordId('tariff-starter-preview', `${entry.code}:${index}`),
    tariffCodeId: null,
    rate: row.rate,
    effectiveFrom: row.effectiveFrom,
    authority: row.authority,
    chapter99Code: row.chapter99Code,
    note: row.note,
  }))
}

interface TariffStarterDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Resolved `entityDefinitionId` for `tariff_code` - the country field lives here. */
  codeDefId: string | null
  /** The org's current registry, so an already-held `(code, country)` renders checked. */
  existingCodes: TariffCode[]
  /** One `Date` for the whole page, so the preview agrees with the Codes list. */
  today: Date
  /** The org's book timezone. Never the viewer's, never UTC by default. */
  bookTimeZone: string
  /** The mutation's result, once adopted. */
  onAdopted: (result: AdoptResult) => void
}

export function TariffStarterDialog({
  open,
  onOpenChange,
  codeDefId,
  existingCodes,
  today,
  bookTimeZone,
  onAdopted,
}: TariffStarterDialogProps) {
  const countryOptions = useTariffCountryFieldOptions(codeDefId)

  const [origin, setOrigin] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  // Keyed by code, valued by the whole expansion, so a chip can render the
  // code, its resolved rate and its membership warning after the search that
  // found it has been replaced by the next one.
  const [selected, setSelected] = useState<Map<string, StarterExpansion>>(new Map())
  // Open headings/subheadings when browsing the tree. A Set of node codes -
  // see the reset on `q` below for why it is per-search-term state.
  const [openNodes, setOpenNodes] = useState<Set<string>>(new Set())
  // Typing must not fire a request per keystroke, and the list must not blank
  // between one debounced search and the next.
  const debouncedSearch = useDebounce(search, 400)

  // A fresh open starts with no origin picked (§7 b: no default) and no stale
  // search or selection carried over from the last time this was opened.
  useEffect(() => {
    if (open) {
      setOrigin(null)
      setSearch('')
      setSelected(new Map())
      setOpenNodes(new Set())
    }
  }, [open])

  // A code checked under one origin is a different `(code, country)` pair
  // under another - the selection does not survive an origin change. Same
  // for which tree nodes are open - a heading's code is origin-specific.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `origin` is the trigger, not a read
  useEffect(() => {
    setSelected(new Map())
    setOpenNodes(new Set())
  }, [origin])

  // The tree's root: the 4-digit headings for this origin, pruned to the
  // search term. One request per opened node from here down. The previous
  // answer stays on screen while the next search resolves.
  const q = debouncedSearch.trim()

  // 🛑 `nodeIsOpen` INVERTS the meaning of `openNodes` for a sole match, so a
  // heading collapsed under one search term renders CLOSED when the next term
  // leaves it the only survivor - with no clue why, and repeated searches
  // inside one chapter hit it constantly. The set is per-search-term state;
  // reset it whenever the term changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `q` is the trigger, not a read
  useEffect(() => {
    setOpenNodes(new Set())
  }, [q])

  const treeQuery = api.purchasing.listTariffStarterChildren.useQuery(
    { country: origin ?? '', parent: null, q },
    { enabled: !!origin, placeholderData: keepPreviousData }
  )

  const adopt = api.purchasing.adoptTariffStarters.useMutation()

  const existingSet = useMemo(
    () => new Set(existingCodes.map((code) => existingKey(code.country, code.code))),
    [existingCodes]
  )

  const toggle = useCallback((entry: StarterExpansion) => {
    setSelected((prev) => {
      const next = new Map(prev)
      if (next.has(entry.code)) next.delete(entry.code)
      else next.set(entry.code, entry)
      return next
    })
  }, [])

  const deselect = useCallback((code: string) => {
    setSelected((prev) => {
      const next = new Map(prev)
      next.delete(code)
      return next
    })
  }, [])

  const toggleOpen = useCallback((code: string) => {
    setOpenNodes((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }, [])

  const handleAdopt = useCallback(async () => {
    if (!origin || selected.size === 0) return
    try {
      const result = await adopt.mutateAsync({
        entries: [...selected.keys()].map((code) => ({ code, country: origin })),
      })
      onAdopted(result)
      onOpenChange(false)
    } catch (error) {
      toastError({
        title: 'Could not add codes',
        description: error instanceof Error ? error.message : 'Could not add the selected codes.',
      })
    }
  }, [origin, selected, adopt, onAdopted, onOpenChange])

  const version = treeQuery.data?.version

  const treeCtx = useMemo<TariffTreeCtx | null>(
    () =>
      origin === null
        ? null
        : {
            origin,
            q,
            openNodes,
            onToggleOpen: toggleOpen,
            selected,
            existingSet,
            onToggleLeaf: toggle,
            today,
            bookTimeZone,
          },
    [origin, q, openNodes, toggleOpen, selected, existingSet, toggle, today, bookTimeZone]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size='3xl' position='tc' innerClassName='p-0'>
        <DialogNav
          title='Add from catalogue'
          description='Pick an origin, then the HTS codes to add. Rates are a starting point, not a filing.'
          crumbs={[{ label: 'Add from catalogue' }]}
        />

        <div className='flex flex-col gap-3 p-3'>
          <FieldPanel
            // The dialog is wide on desktop and phone-width on mobile, where the
            // labels move above the inputs.
            orientation='responsive'
            breakpoint='sm'
            resizeId='tariff-starter-dialog'
            defaultLabelWidth={180}
            className='shrink-0 grow-0 p-0'>
            <FieldPanelRow
              title='Country of origin'
              type={BaseType.ENUM}
              showIcon
              isRequired
              description='Where the goods were MADE. The catalogue is searched for this origin only.'>
              <FieldInputAdapter
                fieldType={FieldType.SINGLE_SELECT}
                fieldOptions={countryOptions}
                value={origin}
                triggerProps={{ className: 'w-full ps-0 pe-1' }}
                onChange={(value) => setOrigin(firstSelected(value))}
                placeholder='Select country'
              />
            </FieldPanelRow>
          </FieldPanel>

          {!origin ? (
            <EmptySection
              icon={<Globe className='size-5' />}
              title='Choose an origin'
              description='The catalogue expands the same code differently per country of origin - pick one to search it.'
            />
          ) : (
            <>
              <InputSearch
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onClear={() => setSearch('')}
                placeholder='Search by code or description...'
              />

              <SelectionTray
                selected={selected}
                today={today}
                bookTimeZone={bookTimeZone}
                onRemove={deselect}
                onClear={() => setSelected(new Map())}
              />

              <ScrollArea viewportClassName='max-h-[24rem]'>
                {treeQuery.isLoading ? (
                  <EmptySection loading />
                ) : (treeQuery.data?.nodes.length ?? 0) === 0 ? (
                  <EmptySection
                    icon={<Globe className='size-5' />}
                    title={q ? 'No matches' : 'Nothing here yet'}
                    description={q ? undefined : 'Nothing in the catalogue for this origin yet.'}
                  />
                ) : (
                  treeCtx && (
                    <div className={cn('flex flex-col gap-0.5 pe-3', TREE_SECONDARY_NOTRUNCATE)}>
                      {treeQuery.data?.nodes.map((node) => (
                        <TariffHeadingRow
                          key={node.code}
                          node={node}
                          ctx={treeCtx}
                          soleMatch={!!q && treeQuery.data?.nodes.length === 1}
                        />
                      ))}
                    </div>
                  )
                )}
              </ScrollArea>
            </>
          )}
        </div>

        <DialogFooter className='items-center gap-3 border-t px-4 py-3 sm:justify-between'>
          <p className='text-muted-foreground text-xs'>
            Starting point from the auxx catalogue, dated {version ?? '-'}. Rates are estimates -
            verify against your broker's entry summary.
          </p>
          <div className='flex shrink-0 gap-2'>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={() => onOpenChange(false)}
              disabled={adopt.isPending}>
              Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
            </Button>
            <Button
              variant='outline'
              size='sm'
              onClick={() => void handleAdopt()}
              disabled={selected.size === 0}
              loading={adopt.isPending}
              loadingText='Adding...'
              data-dialog-submit>
              {`Add ${plural(selected.size, 'code')}`} <KbdSubmit variant='outline' size='sm' />
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The resolved badge for one candidate, through the same resolver the Codes
 *  list and the tree row use. */
function previewBadge(entry: StarterExpansion, today: Date, bookTimeZone: string) {
  return resolutionBadge(resolveScheduleAt(toPreviewRates(entry), today, bookTimeZone))
}

interface SelectionTrayProps {
  selected: Map<string, StarterExpansion>
  today: Date
  bookTimeZone: string
  onRemove: (code: string) => void
  onClear: () => void
}

/**
 * What is picked so far, as removable chips.
 *
 * The tree below is pruned by the search term, so a code checked under one
 * term is gone from the screen the moment the next one is typed. This is the
 * only place the running selection is visible, and the only way to drop one
 * without searching for it again.
 */
function SelectionTray({ selected, today, bookTimeZone, onRemove, onClear }: SelectionTrayProps) {
  if (selected.size === 0) return null

  return (
    <div className='shrink-0 rounded-md border bg-muted/30 p-2'>
      <div className='mb-1.5 flex items-center justify-between gap-2'>
        <span className='text-muted-foreground text-xs'>
          {plural(selected.size, 'code')} selected
        </span>
        <Button type='button' variant='ghost' size='xs' onClick={onClear}>
          Clear all
        </Button>
      </div>
      <div className='flex max-h-20 flex-wrap gap-1 overflow-y-auto'>
        {[...selected.values()].map((entry) => {
          const badge = previewBadge(entry, today, bookTimeZone)
          return (
            <span
              key={entry.code}
              className='flex items-center gap-1 rounded-md border bg-background ps-1.5 pe-0.5 py-0.5'>
              <span className='text-xs tabular-nums' title={entry.description}>
                {entry.code}
              </span>
              {entry.membershipRecorded === false && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge
                      variant='amber'
                      size='xs'
                      className='h-4 min-w-4 justify-center'
                      aria-label='Section 301 membership not recorded'>
                      <TriangleAlert />
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side='top'>
                    Section 301 membership not recorded for this code. The schedule may be
                    understated by that list's rate.
                  </TooltipContent>
                </Tooltip>
              )}
              <Badge variant={badge.variant} size='xs' title={badge.title}>
                {badge.label}
              </Badge>
              <button
                type='button'
                onClick={() => onRemove(entry.code)}
                aria-label={`Remove ${entry.code}`}
                className='flex size-4 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-bad-100 hover:text-bad-500'>
                <X className='size-3' />
              </button>
            </span>
          )
        })}
      </div>
    </div>
  )
}

interface StarterCodeRowProps {
  entry: StarterExpansion
  today: Date
  bookTimeZone: string
  checked: boolean
  alreadyAdded: boolean
  onToggle: () => void
  /** Indent under the subheading. */
  depth?: number
}

function StarterCodeRow({
  entry,
  today,
  bookTimeZone,
  checked,
  alreadyAdded,
  onToggle,
  depth = 0,
}: StarterCodeRowProps) {
  const resolution = resolveScheduleAt(toPreviewRates(entry), today, bookTimeZone)
  const badge = resolutionBadge(resolution)
  const breakdown = resolution.components
    .map((component) => `${authorityLabel(component.authority)} ${formatRate(component.rate)}`)
    .join(' + ')

  return (
    <TreeRow
      depth={depth}
      icon={<Globe className='size-4 text-muted-foreground' />}
      title={
        <span className='flex min-w-0 items-baseline gap-2'>
          <span className='shrink-0 text-sm tabular-nums'>{entry.code}</span>
          <span className='min-w-0 truncate text-muted-foreground text-xs'>
            {entry.description}
          </span>
        </span>
      }
      description={breakdown || undefined}
      onToggleOpen={alreadyAdded ? undefined : onToggle}
      rowClassName={cn(
        'hover:bg-primary-100',
        alreadyAdded && 'opacity-60',
        checked && !alreadyAdded && 'bg-primary-100/50'
      )}
      actions={
        <span className='flex items-center gap-2'>
          {alreadyAdded ? (
            <span className='text-muted-foreground text-xs italic'>Already added</span>
          ) : (
            entry.membershipRecorded === false && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant='amber'
                    size='xs'
                    className='h-4 min-w-4 justify-center'
                    aria-label='Section 301 membership not recorded'>
                    <TriangleAlert />
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side='top'>
                  Section 301 membership not recorded for this code. The schedule may be understated
                  by that list's rate.
                </TooltipContent>
              </Tooltip>
            )
          )}
          <Badge variant={badge.variant} size='xs' title={badge.title}>
            {badge.label}
          </Badge>
          <Switch
            size='xs'
            checked={alreadyAdded ? true : checked}
            disabled={alreadyAdded}
            onCheckedChange={() => onToggle()}
          />
        </span>
      }
    />
  )
}

/** Bundles what every tree row/list below needs, so opening a heading or
 *  subheading isn't a chain of individually threaded props. */
interface TariffTreeCtx {
  origin: string
  /** The debounced search term, passed to every level so the tree is pruned, never flattened. */
  q: string
  openNodes: Set<string>
  onToggleOpen: (code: string) => void
  selected: Map<string, StarterExpansion>
  existingSet: Set<string>
  onToggleLeaf: (entry: StarterExpansion) => void
  today: Date
  bookTimeZone: string
}

interface TreeNodeRowProps {
  node: HtsNode
  ctx: TariffTreeCtx
  /** True when a search left this node as the only survivor at its level: it
   *  opens itself, and a click on it closes it instead. */
  soleMatch: boolean
}

/** Open state with the sole-match inversion: a lone survivor is open until
 *  toggled, every other node is closed until toggled. */
function nodeIsOpen(ctx: TariffTreeCtx, code: string, soleMatch: boolean): boolean {
  const toggled = ctx.openNodes.has(code)
  return soleMatch ? !toggled : toggled
}

/** A `HtsNode`'s title: the code (tabular-nums) then its description, muted
 *  and truncating - the same composition `StarterCodeRow` uses for a leaf. */
function HtsNodeTitle({ node }: { node: HtsNode }) {
  return (
    <span className='flex min-w-0 items-baseline gap-2'>
      <span className='shrink-0 text-sm tabular-nums'>{node.code}</span>
      <span className='min-w-0 truncate text-muted-foreground text-xs'>{node.description}</span>
    </span>
  )
}

/** A 4-digit heading. Its 6-digit subheadings are fetched only once opened. */
function TariffHeadingRow({ node, ctx, soleMatch }: TreeNodeRowProps) {
  const isOpen = nodeIsOpen(ctx, node.code, soleMatch)
  return (
    <TreeRow
      title={<HtsNodeTitle node={node} />}
      secondary={plural(node.leafCount, 'code')}
      depth={0}
      expandable
      isOpen={isOpen}
      onToggleOpen={() => ctx.onToggleOpen(node.code)}
      rowClassName='hover:bg-primary-100'>
      <TariffSubheadingList parentCode={node.code} ctx={ctx} />
    </TreeRow>
  )
}

/** A heading's 6-digit subheadings - one request, fired only while the
 *  heading row above is open (see the note on `TariffSubheadingList`). */
function TariffSubheadingList({ parentCode, ctx }: { parentCode: string; ctx: TariffTreeCtx }) {
  const query = api.purchasing.listTariffStarterChildren.useQuery(
    { country: ctx.origin, parent: parentCode, q: ctx.q },
    { placeholderData: keepPreviousData }
  )
  if (query.isLoading) return <EmptySection loading />
  if (!query.data || query.data.nodes.length === 0) return null
  const soleMatch = !!ctx.q && query.data.nodes.length === 1
  return (
    <>
      {query.data.nodes.map((node) => (
        <TariffSubheadingRow key={node.code} node={node} ctx={ctx} soleMatch={soleMatch} />
      ))}
    </>
  )
}

/** A 6-digit subheading. Its 10-digit lines (`StarterExpansion`, the same
 *  shape the flat list uses) are fetched only once opened. */
function TariffSubheadingRow({ node, ctx, soleMatch }: TreeNodeRowProps) {
  const isOpen = nodeIsOpen(ctx, node.code, soleMatch)
  return (
    <TreeRow
      title={<HtsNodeTitle node={node} />}
      secondary={plural(node.leafCount, 'code')}
      depth={1}
      expandable
      isOpen={isOpen}
      onToggleOpen={() => ctx.onToggleOpen(node.code)}
      rowClassName='hover:bg-primary-100'>
      <TariffLeafList parentCode={node.code} ctx={ctx} />
    </TreeRow>
  )
}

/** A subheading's 10-digit lines, rendered through the same `StarterCodeRow`
 *  the flat list uses - checked/already-added/switch/badges all keep working. */
function TariffLeafList({ parentCode, ctx }: { parentCode: string; ctx: TariffTreeCtx }) {
  const query = api.purchasing.listTariffStarterChildren.useQuery(
    { country: ctx.origin, parent: parentCode, q: ctx.q },
    { placeholderData: keepPreviousData }
  )
  if (query.isLoading) return <EmptySection loading />
  if (!query.data || query.data.leaves.length === 0) return null
  return (
    <>
      {query.data.leaves.map((entry) => (
        <StarterCodeRow
          key={entry.code}
          entry={entry}
          today={ctx.today}
          bookTimeZone={ctx.bookTimeZone}
          checked={ctx.selected.has(entry.code)}
          alreadyAdded={ctx.existingSet.has(existingKey(ctx.origin, entry.code))}
          onToggle={() => ctx.onToggleLeaf(entry)}
          depth={2}
        />
      ))}
    </>
  )
}
