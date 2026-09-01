// apps/web/src/components/manufacturing/ui/settings/tariff-rate-history.tsx
'use client'

// The rate history: the sub-list inside the Tariffs editor pane.
//
// Copies the SHAPE of `money/ui/settings/group-editor.tsx`'s `EntriesSection` -
// a titled strip with an add-popover, then a `TreeRow` / `TreeRowButton` list
// with per-row actions - and NOT its storage. `EntriesSection` serializes its
// entries to one JSON field; these rows are real `tariff_rate` records, per
// brief §12.1: as rows they can be imported, queried across codes when a
// Federal Register notice moves a Chapter 99 code, and audited per row during a
// dispute. A JSON blob is rewritten wholesale and answers none of the three.
//
// 🛑 ADDING A RATE IS AN APPEND, NEVER AN EDIT, and the layout is what has to
// say so. "Add rate" is a persistent button in the section header; correcting
// one is folded away inside a row's expansion, reached only by opening it.
// Somebody who "fixes" February to read 20% has silently restated every
// estimate that month, and there is no record that the rate ever said something
// else - the whole point of §1.4's dated-rows-only model is that a change is a
// new row.
//
// 🛑 The rows in force are MARKED. §3's rule is "latest row per authority,
// summed", so a history that does not say which rows are live cannot be checked
// against the total rendered above it - and the missing-base-rate undercharge
// is invisible without exactly that check.

import { FieldType } from '@auxx/database/enums'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { Plus, Receipt, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
import {
  authorityLabel,
  formatEffectiveFrom,
  formatRate,
  isBaseAuthority,
  type TariffRate,
  type TariffScheduleView,
} from './tariff-types'

/** The writable half of a rate row, as a form holds it. */
export interface TariffRateValues {
  rate: number | null
  /** ISO string from the date picker. Required - see {@link canSubmit}. */
  effectiveFrom: string | null
  authority: string
  chapter99Code: string
  note: string
}

const EMPTY_VALUES: TariffRateValues = {
  rate: null,
  effectiveFrom: null,
  authority: '',
  chapter99Code: '',
  note: '',
}

/**
 * `rate` and `effectiveFrom` are the two the arithmetic needs.
 *
 * ⚠️ `rate: 0` is a legitimate row, not an empty one - §1.4 is explicit that a
 * rate expiring back to nothing is an explicit `0` row rather than a deletion,
 * so a truthiness test here would refuse the one row that records an action
 * being lifted.
 */
function canSubmit(values: TariffRateValues): boolean {
  return values.rate !== null && Number.isFinite(values.rate) && !!values.effectiveFrom
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * The two non-authority choices in the Authority picker.
 *
 * 🛑 `authority` is not a label, it is the GROUPING KEY - §3 resolves one
 * winning row per authority and sums the winners. So the value chosen here
 * decides whether this rate ADDS to the code's total or SUPERSEDES a layer
 * already on it, and as a free-text box it decided that silently. Two spellings
 * of one action (`Section 301 List 3` / `Section 301 - List 3`) are two groups
 * and BOTH sum, so a typo while updating a rate doubles the duty with nothing
 * to see. A closed list of what the code already uses makes that fork
 * unrepresentable; `NEW` is the deliberate way out of it.
 */
const AUTHORITY_BASE = '__base__'
const AUTHORITY_NEW = '__new__'

/** What choosing this authority does to the code's total, in one line. */
function authorityEffect(choice: string): string {
  if (choice === AUTHORITY_BASE) return 'Replaces the base duty from this date.'
  if (choice === AUTHORITY_NEW) return 'Adds a new layer on top of the total.'
  return `Replaces ${choice} from this date. The total does not go up.`
}

/**
 * The distinct authorities already on this code, first-seen spelling wins.
 *
 * Folded case- and whitespace-insensitively because {@link resolveTariffRate}
 * groups that way - offering `MFN` and `mfn` as two choices would advertise a
 * split the resolver does not make.
 */
function distinctAuthorities(rates: TariffRate[]): string[] {
  const seen = new Map<string, string>()
  for (const rate of rates) {
    const label = (rate.authority ?? '').trim()
    if (!label) continue
    const key = label.toLowerCase()
    if (!seen.has(key)) seen.set(key, label)
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}

interface TariffRateHistoryProps {
  /** Newest first. */
  rates: TariffRate[]
  /** Which rows are in force today, from the shared resolver. */
  resolution: TariffScheduleView
  /** False when the viewer cannot write `tariff_rate` - every action hides. */
  canEdit: boolean
  /** Appends a row. Rejects with the server's message. */
  onAdd: (values: TariffRateValues) => Promise<void>
  /** Corrects a row. Behind the row's expansion, never the primary act. */
  onUpdate: (rate: TariffRate, values: TariffRateValues) => Promise<void>
  /** Confirms, then deletes. */
  onRemove: (rate: TariffRate) => Promise<void>
}

export function TariffRateHistory({
  rates,
  resolution,
  canEdit,
  onAdd,
  onUpdate,
  onRemove,
}: TariffRateHistoryProps) {
  const [addOpen, setAddOpen] = useState(false)
  // One row open at a time - the same single-open accordion `editingId` was,
  // now naming what it actually controls: `TreeRow`'s expansion.
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const authorities = useMemo(() => distinctAuthorities(rates), [rates])

  const handleAdd = useCallback(
    async (values: TariffRateValues) => {
      await onAdd(values)
      setAddOpen(false)
    },
    [onAdd]
  )

  return (
    <div className='flex flex-col gap-1.5'>
      <div className='flex items-center justify-between px-1'>
        <span className='font-medium text-muted-foreground text-xs'>Rate history</span>
        {canEdit && (
          <Popover open={addOpen} onOpenChange={setAddOpen}>
            <PopoverTrigger asChild>
              <Button variant='outline' size='xs'>
                <Plus />
                Add rate
              </Button>
            </PopoverTrigger>
            <PopoverContent align='end' className='w-[380px] p-3'>
              <TariffRateForm
                key={addOpen ? 'open' : 'closed'}
                authorities={authorities}
                initial={EMPTY_VALUES}
                submitLabel='Add rate'
                pendingLabel='Adding...'
                onSubmit={handleAdd}
                onCancel={() => setAddOpen(false)}
              />
            </PopoverContent>
          </Popover>
        )}
      </div>

      {rates.length === 0 ? (
        <div className='rounded-md border border-dashed p-4 text-center text-muted-foreground text-xs'>
          No rates yet. Until one is added this code resolves to nothing and every offer behind it
          is estimated with no duty.
        </div>
      ) : (
        <div className='flex flex-col gap-0.5'>
          {rates.map((rate) => (
            <TariffRateRow
              key={rate.id}
              rate={rate}
              inForce={resolution.liveIds.has(rate.id)}
              canEdit={canEdit}
              authorities={authorities}
              expanded={expandedId === rate.id}
              onToggleExpanded={() => setExpandedId((prev) => (prev === rate.id ? null : rate.id))}
              onUpdate={async (values) => {
                await onUpdate(rate, values)
                setExpandedId(null)
              }}
              onRemove={() => onRemove(rate)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * One rate row: a `TreeRow` whose EXPANDED CHILDREN carry the note and the
 * correction form.
 *
 *     [icon] Section 301 List 3  9903.88.03 - from 2019-05-10  [In force]  25.0%
 *
 * 🛑 The disclosure is `TreeRow`'s own, not a hand-rolled one. This previously
 * rendered the form and the note as SIBLINGS of the row behind `&&` guards,
 * which meant no chevron, no animation, no connector line, and a second
 * definition of "expanded" living next to the one `TreeRow` already has.
 * `expandable` + `isOpen` + `children` is the supported shape and it is what
 * every other tree surface in the app uses.
 *
 * ⚠️ `chevronOnHover` keeps the `Receipt` icon at rest and swaps it for the
 * chevron on hover, so the row reads as a rate first and a control second. It
 * degrades to a plain icon on its own when there is nothing to expand.
 */
function TariffRateRow({
  rate,
  inForce,
  canEdit,
  authorities,
  expanded,
  onToggleExpanded,
  onUpdate,
  onRemove,
}: {
  rate: TariffRate
  inForce: boolean
  canEdit: boolean
  /** Authorities already on this code, for the picker. */
  authorities: string[]
  expanded: boolean
  onToggleExpanded: () => void
  onUpdate: (values: TariffRateValues) => Promise<void>
  onRemove: () => void
}) {
  const secondLine = [rate.chapter99Code, `from ${formatEffectiveFrom(rate.effectiveFrom)}`]
    .filter(Boolean)
    .join(' - ')

  // A read-only row with no note has nothing behind it, so it gets no
  // affordance at all rather than one that opens an empty block.
  const canExpand = canEdit || !!rate.note

  return (
    <TreeRow
      icon={<Receipt className='size-4 text-muted-foreground' />}
      expandable={canExpand}
      chevronOnHover
      isOpen={expanded}
      onToggleOpen={canExpand ? onToggleExpanded : undefined}
      title={
        <span className={cn('text-sm', isBaseAuthority(rate.authority) && 'text-muted-foreground')}>
          {authorityLabel(rate.authority)}
        </span>
      }
      secondaryFill
      rowClassName={cn('bg-primary-50 hover:bg-primary-100', !inForce && 'opacity-70')}
      secondary={
        <span className='flex min-w-0 items-center gap-2'>
          <span className='truncate text-muted-foreground text-xs'>{secondLine}</span>
          {/* The badge sits in its own padded box: its ring is drawn OUTSIDE the
              element's box, so a flush edge against the row's clipping bounds
              shaves the ring off. The padding is the ring's width, nothing more. */}
          {inForce ? (
            <div className='shrink-0 p-px'>
              <Badge variant='green' size='xs'>
                In force
              </Badge>
            </div>
          ) : (
            <span className='shrink-0 p-px text-muted-foreground text-xs'>Superseded</span>
          )}
        </span>
      }
      actions={
        <div className='flex items-center gap-1'>
          <span className='text-sm tabular-nums'>{formatRate(rate.rate)}</span>
          {canEdit && (
            <TreeRowButton tooltipText='Remove' variant='destructive' onClick={onRemove}>
              <Trash2 />
            </TreeRowButton>
          )}
        </div>
      }>
      <div className='flex flex-col gap-1.5 pb-1.5 pl-9 pr-1'>
        {rate.note && <p className='text-muted-foreground text-xs italic'>{rate.note}</p>}

        {canEdit && (
          <div className='rounded-md border p-2'>
            {/* ⚠️ Says "Correct", not "Save". An edit here rewrites what the schedule
                says was true on a date that has already passed, which silently
                restates every estimate valued against it - the act is a CORRECTION
                of a mis-keyed row, and a rate that genuinely changed is a new row. */}
            <p className='mb-2 text-muted-foreground text-xs'>
              Correcting a row rewrites what this code resolved to on every date it covers. A rate
              that actually changed is a new row, not an edit.
            </p>
            <TariffRateForm
              key={expanded ? 'open' : 'closed'}
              authorities={authorities}
              initial={{
                rate: rate.rate,
                effectiveFrom: rate.effectiveFrom,
                authority: rate.authority ?? '',
                chapter99Code: rate.chapter99Code ?? '',
                note: rate.note ?? '',
              }}
              submitLabel='Correct row'
              pendingLabel='Saving...'
              onSubmit={onUpdate}
              onCancel={onToggleExpanded}
            />
          </div>
        )}
      </div>
    </TreeRow>
  )
}

/**
 * The five fields, shared by the add-popover and the inline correction.
 *
 * One form, two callers - the same rule `ChartAccountForm` follows. A separate
 * add form and edit form would be two copies of one layout drifting apart, and
 * the only difference here is where the submit goes.
 */
function TariffRateForm({
  initial,
  authorities,
  submitLabel,
  pendingLabel,
  onSubmit,
  onCancel,
}: {
  initial: TariffRateValues
  /** Authorities already on this code. The picker offers these, plus base and new. */
  authorities: string[]
  submitLabel: string
  pendingLabel: string
  onSubmit: (values: TariffRateValues) => Promise<void>
  onCancel: () => void
}) {
  const [values, setValues] = useState<TariffRateValues>(initial)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A correction on a row whose authority is no longer on any OTHER row still
  // has to render its own value, so "not in the list" starts in free-text mode
  // rather than silently resetting the row to the base rate.
  const [namingNew, setNamingNew] = useState(
    () =>
      !!initial.authority.trim() &&
      !authorities.some((a) => a.toLowerCase() === initial.authority.trim().toLowerCase())
  )

  const authorityChoice = namingNew
    ? AUTHORITY_NEW
    : values.authority.trim()
      ? (authorities.find((a) => a.toLowerCase() === values.authority.trim().toLowerCase()) ??
        AUTHORITY_NEW)
      : AUTHORITY_BASE

  const onAuthorityChoice = (choice: string) => {
    if (choice === AUTHORITY_BASE) {
      setNamingNew(false)
      patch({ authority: '' })
      return
    }
    if (choice === AUTHORITY_NEW) {
      setNamingNew(true)
      patch({ authority: '' })
      return
    }
    setNamingNew(false)
    patch({ authority: choice })
  }

  const patch = (next: Partial<TariffRateValues>) => setValues((prev) => ({ ...prev, ...next }))

  const handleSubmit = async () => {
    if (pending || !canSubmit(values)) return
    setPending(true)
    setError(null)
    try {
      await onSubmit(values)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the rate.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className='flex flex-col gap-2'>
      <FieldPanel
        orientation='horizontal'
        resizeId='tariff-rate-form'
        defaultLabelWidth={160}
        className='p-0'>
        <FieldPanelRow
          title='Rate (%)'
          type={BaseType.NUMBER}
          showIcon
          isRequired
          description='A percentage of the unit price, which is the customs value - 25 means 25%. Shipping and brokerage stay outside it.'>
          <FieldInputAdapter
            fieldType={FieldType.NUMBER}
            value={values.rate}
            onChange={(value) => patch({ rate: toNumber(value) })}
            placeholder='25'
          />
        </FieldPanelRow>

        {/* ⚠️ A `FieldType.DATE` is stored as a full ISO instant, so the calendar
            day the resolver reads is the UTC slice of whatever the picker
            produced. That is the platform's DATE semantics, shared with every
            other date field in the app, and it is left alone here on purpose:
            normalising the write to a bare `YYYY-MM-DD` would fix the stored day
            for eastern viewers and break what the picker renders back to western
            ones, and this page must not be the one writer that disagrees with
            the importer and the API about what a date field holds. */}
        <FieldPanelRow
          title='Effective from'
          type={BaseType.DATE}
          showIcon
          isRequired
          description='The date this rate starts. There is no end date - the next row ends this one, and a rate lifted back to nothing is an explicit row at 0.'>
          <FieldInputAdapter
            fieldType={FieldType.DATE}
            triggerProps={{ className: 'ps-0 pe-1 w-full' }}
            value={values.effectiveFrom}
            onChange={(value) => patch({ effectiveFrom: (value as string | undefined) ?? null })}
            placeholder='Pick a date'
          />
        </FieldPanelRow>

        <FieldPanelRow
          title='Authority'
          type={BaseType.STRING}
          showIcon
          description='What imposes this rate - the base duty, or an action layered on top of it. Picking one this code already uses REPLACES that layer from your date. Picking "New authority" ADDS to the total.'>
          <div className='flex w-full flex-col gap-1.5'>
            <Select value={authorityChoice} onValueChange={onAuthorityChoice}>
              {/* `transparent` is what every other input in a `FieldPanel` renders
                  as - a bordered box here reads as a different kind of control
                  than the rows above and below it. */}
              <SelectTrigger variant='transparent' className='w-full ps-0 pe-1'>
                <SelectValue placeholder='Select authority' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTHORITY_BASE}>Base rate</SelectItem>
                {authorities.map((authority) => (
                  <SelectItem key={authority} value={authority}>
                    {authority}
                  </SelectItem>
                ))}
                <SelectItem value={AUTHORITY_NEW}>New authority...</SelectItem>
              </SelectContent>
            </Select>

            {namingNew && (
              <FieldInputAdapter
                fieldType={FieldType.TEXT}
                value={values.authority}
                onChange={(value) => patch({ authority: (value as string) ?? '' })}
                placeholder='Section 301 List 3'
              />
            )}

            <p className='text-muted-foreground text-xs'>{authorityEffect(authorityChoice)}</p>
          </div>
        </FieldPanelRow>

        <FieldPanelRow
          title='Chapter 99 code'
          type={BaseType.STRING}
          showIcon
          description='The Chapter 99 heading this rate arrives under. Recorded so an estimate can be reconciled line by line against the entry summary - the arithmetic never reads it.'>
          <FieldInputAdapter
            fieldType={FieldType.TEXT}
            value={values.chapter99Code}
            onChange={(value) => patch({ chapter99Code: (value as string) ?? '' })}
            placeholder='9903.88.03'
          />
        </FieldPanelRow>

        <FieldPanelRow title='Note' type={BaseType.STRING} showIcon>
          <FieldInputAdapter
            fieldType={FieldType.TEXT}
            fieldOptions={{ multiline: true }}
            value={values.note}
            onChange={(value) => patch({ note: (value as string) ?? '' })}
            placeholder='Federal Register cite, or whatever the broker said'
          />
        </FieldPanelRow>
      </FieldPanel>

      {error && <p className='text-destructive text-xs'>{error}</p>}

      <div className='flex items-center gap-2'>
        <Button
          size='xs'
          variant='outline'
          disabled={!canSubmit(values)}
          loading={pending}
          loadingText={pendingLabel}
          onClick={() => void handleSubmit()}>
          {submitLabel}
        </Button>
        <Button size='xs' variant='ghost' onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
