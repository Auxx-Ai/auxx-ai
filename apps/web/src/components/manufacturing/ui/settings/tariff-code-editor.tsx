// apps/web/src/components/manufacturing/ui/settings/tariff-code-editor.tsx
'use client'

// The right column of the Codes tab: the selected `tariff_code`, as a form,
// then what it resolves to today, then its rate history.
//
// 🛑 ONE FORM, TWO MODES - not a draft form and an editor form. An uncommitted
// draft and a saved code render the identical three rows off the identical local
// state; the only difference is where a commit GOES, which is one branch on
// `recordIdRef`. `chart-account-editor.tsx` made this call first and wrote down
// why: a split is two copies of one layout drifting apart when both sides write
// through the same door.
//
// 🛑 CREATE FIRES ON A BUTTON, not on a commit - the same deviation the chart
// made. `tariff_code`'s identity is the natural key `(code, country)`, BOTH
// halves required, so an implicit create would put "8481.80.9005 CN already
// exists" on an act nobody knowingly performed: they picked a country from a
// 250-entry list, and back comes a collision. The button makes the create the
// thing they just did.
//
// 🛑 The TOTAL is never rendered alone. §3's resolution rule sums the latest row
// per authority, which means the number is only checkable against the rows that
// produced it - and a code carrying a 301 row with no base row resolves to 25%
// instead of 27% with nothing wrong-looking about it. `ResolutionSummary` below
// carries both the components and that warning; `vendor-cost.ts` already argues
// the general form of this ("a breakdown that shows 10% without $4.00 does not
// answer where did the tariff go").

import { FieldType } from '@auxx/database/enums'
import type { FieldOptions } from '@auxx/lib/field-values/client'
import type { RecordId } from '@auxx/lib/resources/client'
import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { EmptySection } from '@auxx/ui/components/section'
import { Globe, Trash2, TriangleAlert } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
import { useDebouncedCallback } from '~/hooks/use-debounced-value'
import { TariffRateHistory, type TariffRateValues } from './tariff-rate-history'
import {
  authorityLabel,
  formatEffectiveFrom,
  formatRate,
  resolveScheduleAt,
  type TariffCode,
  type TariffCodeDraft,
  type TariffRate,
  type TariffScheduleView,
} from './tariff-types'

/**
 * ⚠️ A `SINGLE_SELECT` hands its value back as an ARRAY - `['CN']` - because the
 * picker underneath is the multi-select one with `multi: false`. Passing that
 * straight to a write stores an array in a scalar field. Normalise at the
 * boundary, exactly as `chart-account-editor.tsx` does.
 */
function firstSelected(value: unknown): string | null {
  if (Array.isArray(value)) return (value[0] as string) ?? null
  return (value as string) || null
}

/** The three writable attributes, as the form holds them. */
export interface TariffCodeValues {
  code: string
  /** `null` only in draft mode - "not chosen yet" never reaches a write. */
  country: string | null
  description: string
}

/** Which field a refusal belongs to. Routed from the patch key that caused it. */
type FieldKey = 'code' | 'country' | 'description' | 'form'

interface TariffCodeEditorProps {
  selectedId: string | null
  codes: TariffCode[]
  ratesByCode: Map<string, TariffRate[]>
  /** One `Date` for the whole page, so every row agrees on what "today" is. */
  today: Date
  /** The org's book timezone - the zone a calendar `effectiveFrom` is read in. */
  bookTimeZone: string
  /** `tariff_code`'s `country` field options, straight off the definition. */
  countryOptions: FieldOptions | undefined
  /** Phantom draft for this tab, owned by `tariffs-settings-page.tsx`. */
  draft: TariffCodeDraft | null
  onDraftChange: (patch: Partial<TariffCodeValues>) => void
  /** Creates the code. Rejects with the server's message. */
  onCreate: (values: {
    code: string
    country: string
    /** `nullable: true` on the registry - a code with no words is still valid. */
    description: string | null
  }) => Promise<TariffCode>
  /** First create resolved: swap `selectedId` to the real id, KEEPING the draft. */
  onDraftCommitted: (recordId: string) => void
  /** Writes one attribute. Rejects with the server's message. */
  onUpdate: (recordId: RecordId, patch: Partial<TariffCodeValues>) => Promise<void>
  /** Confirms, then deletes. */
  onRemove: (code: TariffCode) => Promise<void>
  /** False when the viewer cannot write `tariff_rate`. */
  canEditRates: boolean
  onAddRate: (code: TariffCode, values: TariffRateValues) => Promise<void>
  onUpdateRate: (rate: TariffRate, values: TariffRateValues) => Promise<void>
  onRemoveRate: (rate: TariffRate) => Promise<void>
}

export function TariffCodeEditor(props: TariffCodeEditorProps) {
  const { selectedId, codes, draft } = props

  // The draft stays active while `selectedId` is its COMMITTED id too - swapping
  // to a query-bound instance would remount the inputs mid-typing (replaced
  // text, cancelled debounce timer).
  const draftActive =
    !!draft && (selectedId === draft.draftId || (!!draft.recordId && selectedId === draft.recordId))

  if (draft && draftActive) {
    return <TariffCodeForm key={draft.draftId} code={null} {...props} />
  }

  const code = selectedId ? codes.find((row) => row.id === selectedId) : undefined

  if (!code) {
    return (
      <div className='p-3'>
        <EmptySection
          orientation='horizontal'
          icon={<Globe />}
          title='Select a code'
          description='Or add one. A code is a classification for an origin, so 8481.80.9005 from China and from Germany are two of them.'
        />
      </div>
    )
  }

  return <TariffCodeForm key={code.id} code={code} {...props} />
}

/**
 * The three rows, the resolved total, and the history - in both modes.
 *
 * `code: null` is the draft: commits buffer locally and the Create button
 * appears. A non-null `code` seeds the same state and `recordIdRef`, so every
 * commit writes immediately, Remove appears, and the rate history is reachable.
 * **A draft that has just been created is the first case turning into the second
 * WITHOUT a remount** - that is what `recordIdRef` is for, and it is why the
 * page keeps the draft alive after `onDraftCommitted`.
 *
 * ⚠️ The rate history is hidden until the code exists, and that is not a
 * limitation being papered over: a `tariff_rate` row is a child record and needs
 * a parent to point at. The Create button is one click away and the copy under
 * it says so.
 */
function TariffCodeForm({
  code,
  ratesByCode,
  today,
  bookTimeZone,
  countryOptions,
  onDraftChange,
  onCreate,
  onDraftCommitted,
  onUpdate,
  onRemove,
  canEditRates,
  onAddRate,
  onUpdateRate,
  onRemoveRate,
}: { code: TariffCode | null } & Omit<TariffCodeEditorProps, 'selectedId' | 'codes' | 'draft'>) {
  const valuesRef = useRef<TariffCodeValues>({
    code: code?.code ?? '',
    country: code?.country ?? null,
    description: code?.description ?? '',
  })
  const [values, setValues] = useState<TariffCodeValues>(valuesRef.current)
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({})
  const [creating, setCreating] = useState(false)
  const [removing, setRemoving] = useState(false)

  // 🛑 Synchronous, NOT state-derived: a `disabled` prop driven by `creating` is
  // not enough, because two clicks landing before a re-render both pass it - and
  // the second one collides on `(code, country)`, so the person sees an error
  // for a code that was in fact created fine.
  const creatingRef = useRef(false)
  // Null while the draft is uncommitted; set the moment the create resolves, and
  // seeded for an existing code. THE branch this component turns on.
  const recordIdRef = useRef<RecordId | null>(code?.recordId ?? null)
  const [committed, setCommitted] = useState<TariffCode | null>(code)

  const commit = useCallback(
    (key: FieldKey, patch: Partial<TariffCodeValues>) => {
      const merged = { ...valuesRef.current, ...patch }
      valuesRef.current = merged
      setValues(merged)

      const recordId = recordIdRef.current
      if (!recordId) {
        // Buffering. The phantom row is the only feedback there is until the
        // Create button lights up, so keep it in step.
        onDraftChange(patch)
        return
      }

      setErrors((prev) => ({ ...prev, [key]: undefined }))
      void onUpdate(recordId, patch).catch((error: unknown) => {
        setErrors((prev) => ({
          ...prev,
          [key]: error instanceof Error ? error.message : 'Could not save the change.',
        }))
      })
    },
    [onDraftChange, onUpdate]
  )

  const commitCode = useDebouncedCallback((value: string) => commit('code', { code: value }), 500)
  const commitDescription = useDebouncedCallback(
    (value: string) => commit('description', { description: value }),
    500
  )

  // 🛑 The natural key ONLY. `description` is `nullable: true` on the registry,
  // so gating the button on it would refuse a create the server accepts - and a
  // classification with no words is an unfinished note, not an invalid record.
  const canCreate = values.code.trim().length > 0 && !!values.country

  const handleCreate = useCallback(async () => {
    if (creatingRef.current || recordIdRef.current) return
    const snapshot = valuesRef.current
    if (!snapshot.code.trim() || !snapshot.country) return

    creatingRef.current = true
    setCreating(true)
    setErrors({})

    try {
      const created = await onCreate({
        code: snapshot.code.trim(),
        country: snapshot.country,
        description: snapshot.description.trim() || null,
      })

      // Flip the commit target FIRST - a keystroke landing while we settle below
      // must route to the real code, not back into the buffered branch.
      recordIdRef.current = created.recordId
      setCommitted(created)

      // Whatever was typed while the create was in flight, against the now-real
      // record. One call, because a create carries the whole snapshot.
      const latest = valuesRef.current
      const changed: Partial<TariffCodeValues> = {}
      if (latest.code.trim() !== snapshot.code.trim()) changed.code = latest.code.trim()
      if (latest.country && latest.country !== snapshot.country) changed.country = latest.country
      if (latest.description.trim() !== snapshot.description.trim()) {
        changed.description = latest.description.trim()
      }
      if (Object.keys(changed).length > 0) await onUpdate(created.recordId, changed)

      onDraftCommitted(created.id)
    } catch (error) {
      creatingRef.current = false
      // A 409 on `tariff_code` is always `(code, country)` - the only unique key
      // - so it lands on the code row rather than in a corner of the screen.
      const message = error instanceof Error ? error.message : 'Could not create the code.'
      const isConflict =
        typeof error === 'object' &&
        error !== null &&
        (error as { data?: { code?: string } }).data?.code === 'CONFLICT'
      setErrors(isConflict ? { code: message } : { form: message })
    } finally {
      setCreating(false)
    }
  }, [onCreate, onDraftCommitted, onUpdate])

  const handleRemove = useCallback(async () => {
    if (!committed) return
    setRemoving(true)
    setErrors((prev) => ({ ...prev, form: undefined }))
    try {
      await onRemove(committed)
    } catch (error) {
      setErrors((prev) => ({
        ...prev,
        form: error instanceof Error ? error.message : 'Could not remove the code.',
      }))
    } finally {
      setRemoving(false)
    }
  }, [committed, onRemove])

  const rates = committed ? (ratesByCode.get(committed.id) ?? []) : []
  const resolution = resolveScheduleAt(rates, today, bookTimeZone)

  return (
    // `min-h-0` + `ScrollArea`: this pane sits inside a sticky container capped
    // at the viewport height, so content taller than that must scroll ITSELF.
    <div className='flex h-full min-h-0 flex-col p-3'>
      <ScrollArea className='min-h-0 flex-1' allowScrollChaining>
        <FieldPanel
          orientation='horizontal'
          breakpoint='md'
          resizeId='tariff-code-detail'
          defaultLabelWidth={150}
          className='shrink-0 grow-0 p-0'>
          <FieldPanelRow
            title='Code'
            type={BaseType.STRING}
            showIcon
            isRequired
            description='The Chapter 1-97 classification. The 6-digit HS heading is the international part; duty rates attach at the 8 or 10-digit level, so a 6-digit code cannot resolve a correct rate.'>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={values.code}
              onChange={(value) => {
                valuesRef.current = { ...valuesRef.current, code: value as string }
                setValues(valuesRef.current)
                commitCode(value as string)
              }}
              placeholder='8481.80.9005'
            />
            <FieldError message={errors.code} />
          </FieldPanelRow>

          <FieldPanelRow
            title='Country of origin'
            type={BaseType.ENUM}
            showIcon
            isRequired
            description='Where the goods were MADE, not where the supplier ships from. A US distributor selling Chinese-made parts is the common case.'>
            <FieldInputAdapter
              fieldType={FieldType.SINGLE_SELECT}
              fieldOptions={countryOptions}
              value={values.country}
              triggerProps={{ className: 'w-full ps-0 pe-1' }}
              onChange={(value) => {
                const next = firstSelected(value)
                if (next) commit('country', { country: next })
              }}
              placeholder='Select country'
            />
            <FieldError message={errors.country} />
          </FieldPanelRow>

          <FieldPanelRow title='Description' type={BaseType.STRING} showIcon>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              fieldOptions={{ multiline: true }}
              value={values.description}
              onChange={(value) => {
                valuesRef.current = { ...valuesRef.current, description: value as string }
                setValues(valuesRef.current)
                commitDescription(value as string)
              }}
              placeholder='What it is, in words'
            />
            <FieldError message={errors.description} />
          </FieldPanelRow>
        </FieldPanel>

        {committed ? (
          <div className='mt-4 flex flex-col gap-3'>
            <ResolutionSummary resolution={resolution} />

            <TariffRateHistory
              rates={rates}
              resolution={resolution}
              canEdit={canEditRates}
              onAdd={(rateValues) => onAddRate(committed, rateValues)}
              onUpdate={onUpdateRate}
              onRemove={onRemoveRate}
            />

            <div className='flex flex-col gap-2'>
              <Button
                variant='outline'
                size='sm'
                className='self-start text-destructive'
                loading={removing}
                loadingText='Removing...'
                onClick={() => void handleRemove()}>
                <Trash2 />
                Remove code
              </Button>
              <FieldError message={errors.form} />
              <p className='text-muted-foreground text-xs'>
                Changes save as you make them. Removing a code does not restate anything already
                valued - a receipt freezes its cost when it is written and is never re-read.
              </p>
            </div>
          </div>
        ) : (
          <div className='mt-3 flex flex-col gap-2'>
            <Button
              variant='outline'
              size='sm'
              className='self-start'
              disabled={!canCreate}
              loading={creating}
              loadingText='Creating...'
              onClick={() => void handleCreate()}>
              Create code
            </Button>
            <FieldError message={errors.form} />
            <p className='text-muted-foreground text-xs'>
              A code and a country of origin are what identify the record, and both are required.
              Nothing is written until you create it, and the rates go on afterwards.
            </p>
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

/**
 * What the code resolves to today, and the rows that produced it.
 *
 * 🛑 Four states, and only one of them is a bare number:
 *
 * - **No rows at all** (`unclassified`). Every offer pointing here estimates
 *   with no duty, which is a fact about the org rather than an error. It is NOT
 *   "0%" - the two produce identical arithmetic and mean opposite things, which
 *   is exactly why the resolver carries a `status`.
 * - **Rows, all starting later** (`pending`). Also 0% today, also not the same
 *   as having no schedule - somebody has entered a future action and wants to
 *   see that it is waiting rather than lost.
 * - **Rows, but every one names an authority.** The total is arithmetically
 *   right and commercially wrong: §3's summing rule has nothing to add the MFN
 *   base to, so an imported part is undercharged by the base rate and nothing
 *   about the number looks off. This is the one state that MUST shout.
 * - **Rows including a base.** The total, over its components.
 */
function ResolutionSummary({ resolution }: { resolution: TariffScheduleView }) {
  if (resolution.status === 'unclassified') {
    return (
      <div className='rounded-xl border border-dashed p-3'>
        <p className='font-medium text-sm'>No rate on this code</p>
        <p className='text-muted-foreground text-xs'>
          Supplier offers pointing at it are estimated with no duty. Add the rows that apply,
          starting with the base rate.
        </p>
      </div>
    )
  }

  if (resolution.status === 'pending') {
    return (
      <div className='rounded-xl border border-dashed p-3'>
        <p className='font-medium text-sm'>Nothing in force yet</p>
        <p className='text-muted-foreground text-xs'>
          Every row on this code takes effect after today, so offers behind it are still estimated
          with no duty. The schedule starts working on its own when the earliest date arrives.
        </p>
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-2 rounded-2xl border p-3'>
      <div className='flex items-baseline justify-between gap-2'>
        <span className='font-medium text-sm'>Effective today</span>
        <span className='font-medium text-base tabular-nums'>{formatRate(resolution.total)}</span>
      </div>

      <div className='flex flex-col gap-1'>
        {resolution.components.map((component) => (
          <div key={component.id} className='flex items-baseline justify-between gap-2 text-xs'>
            <span className='min-w-0 truncate text-muted-foreground'>
              {authorityLabel(component.authority)}
              {component.chapter99Code ? ` (${component.chapter99Code})` : ''}
            </span>
            <span className='flex shrink-0 items-baseline gap-2'>
              <span className='text-muted-foreground'>
                from {formatEffectiveFrom(component.effectiveFrom)}
              </span>
              <span className='tabular-nums'>{formatRate(component.rate)}</span>
            </span>
          </div>
        ))}
      </div>

      {resolution.missingBaseRate && (
        <div className='flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-2'>
          <TriangleAlert className='mt-0.5 size-4 shrink-0 text-destructive' />
          <div className='min-w-0'>
            <p className='font-medium text-xs'>Missing the base duty</p>
            <p className='text-muted-foreground text-xs'>
              Every rate here is an add-on trade action, so this total is the surcharges only. The
              ordinary duty for this classification is missing and the parts priced behind this code
              are costed too low. Add it as a rate with no Chapter 99 code.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

/** One server refusal, on the row that caused it. Rendered verbatim. */
function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <p className='mt-1 text-destructive text-xs'>{message}</p>
}
