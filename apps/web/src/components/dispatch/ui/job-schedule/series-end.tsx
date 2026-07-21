// apps/web/src/components/dispatch/ui/job-schedule/series-end.tsx
'use client'

// Series-end visibility + editing (plan 36 §B) — the pieces that stop a recurring series'
// end state living invisibly inside the rule pattern: a shared rule query, the "Ends" date
// editor (the explicit reverse of "Skip this and future"), the terminator row after the last
// upcoming visit, and the drawer's compact series summary line.

import type { RecurrencePattern } from '@auxx/lib/recurrence/client'
import { describeRecurrenceParts } from '@auxx/lib/recurrence/client'
import type { RecordId } from '@auxx/types/resource'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { format, parseISO } from 'date-fns'
import { CalendarOff, CalendarPlus, Repeat } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { DateTimePickerContent } from '~/components/pickers/date-time-picker'
import { useConfirm } from '~/hooks/use-confirm'
import { useSettings } from '~/hooks/use-settings'
import { ORG_STATIC_STALE_TIME } from '~/trpc/query-client'
import { api } from '~/trpc/react'
import { scalarSetting } from '../recurrence/recurrence-utils'
import type { JobVisit } from './use-job-visits'

/**
 * The work order's recurrence rule (shared `dispatch.getRecurrence` read — one fetch per
 * work order, every consumer dedupes onto the same query key). `enabled: false` skips the
 * fetch entirely for surfaces that already know the job has no series.
 */
export function useSeriesRule(workOrderRecordId: RecordId, enabled = true) {
  const query = api.dispatch.getRecurrence.useQuery(
    { workOrderRecordId },
    { staleTime: ORG_STATIC_STALE_TIME, enabled }
  )
  const rule = query.data ?? null
  const pattern = (rule?.pattern ?? null) as RecurrencePattern | null
  return {
    rule,
    pattern,
    /** The pattern's inclusive local-ISO end date; `undefined` = open-ended. */
    until: pattern?.until,
    /** `until` before `effectiveFrom` — an empty generation window, nothing ever generates. */
    windowEmpty:
      pattern?.until !== undefined && rule !== null && pattern.until < rule.effectiveFrom,
  }
}

export interface SeriesEndEditorProps {
  workOrderRecordId: RecordId
  /** The pattern's current end date (local ISO), `undefined` when open-ended. */
  until: string | undefined
  /** This job's visits — counts how many upcoming series rows a shorten removes (§B.5). */
  visits: JobVisit[]
  onChanged: () => void
  trigger: ReactNode
}

/**
 * "Ends" date editor (plan 36 §B.2) — a popover date picker + "Remove end date" wired to
 * `dispatch.setSeriesEnd`. Shortening confirms with the number of upcoming visits it removes;
 * extending/clearing commits directly (additive, nothing lost).
 */
export function SeriesEndEditor({
  workOrderRecordId,
  until,
  visits,
  onChanged,
  trigger,
}: SeriesEndEditorProps) {
  const [open, setOpen] = useState(false)
  const [confirm, ConfirmDialog] = useConfirm()
  const setSeriesEnd = api.dispatch.setSeriesEnd.useMutation({
    onError: (error) =>
      toastError({ title: 'Error updating series end', description: error.message }),
    onSuccess: onChanged,
  })

  const commit = async (next: string | null) => {
    setOpen(false)
    if (next !== null) {
      const removed = visits.filter(
        (visit) =>
          visit.recurrenceRuleId &&
          visit.status === 'scheduled' &&
          visit.occurrenceDate &&
          visit.occurrenceDate > next
      ).length
      if (removed > 0) {
        const confirmed = await confirm({
          title: `End series on ${format(parseISO(next), 'MMM d, yyyy')}?`,
          description: `Removes ${removed} upcoming visit${removed === 1 ? '' : 's'} after that date. Completed and skipped visits stay in history.`,
          confirmText: 'End series',
          cancelText: 'Keep schedule',
          destructive: true,
        })
        if (!confirmed) return
      }
    }
    setSeriesEnd.mutate({ workOrderRecordId, until: next })
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent className='w-auto p-0' align='start'>
          <SeriesEndPickerContent
            until={until}
            onPick={(next) => void commit(next)}
            pending={setSeriesEnd.isPending}
          />
        </PopoverContent>
      </Popover>
      <ConfirmDialog />
    </>
  )
}

function SeriesEndPickerContent({
  until,
  onPick,
  pending,
}: {
  until: string | undefined
  onPick: (next: string | null) => void
  pending: boolean
}) {
  return (
    <div>
      <DateTimePickerContent
        mode='date'
        noConfirm
        minDate={new Date()}
        value={until ? parseISO(until) : undefined}
        onChange={(date: Date | undefined) => {
          if (date) onPick(format(date, 'yyyy-MM-dd'))
        }}
      />
      {until && (
        <div className='border-t p-1.5'>
          <Button
            variant='ghost'
            size='sm'
            className='w-full justify-start'
            disabled={pending}
            onClick={() => onPick(null)}>
            <CalendarOff /> Remove end date
          </Button>
        </div>
      )}
    </div>
  )
}

export interface SeriesEndRowProps {
  workOrderRecordId: RecordId
  canEdit: boolean
  visits: JobVisit[]
  onChanged: () => void
  depth?: number
}

/**
 * Terminator row (plan 36 §B.3) — rendered after the last upcoming visit when the series has
 * an end date: "Series ends after Aug 18", with an Extend action opening the end editor. This
 * is what makes "why is there nothing after Aug 18" self-answering. Renders nothing for an
 * open-ended series or a rule-less job.
 */
export function SeriesEndRow({
  workOrderRecordId,
  canEdit,
  visits,
  onChanged,
  depth,
}: SeriesEndRowProps) {
  const hasSeries = visits.some((visit) => visit.recurrenceRuleId)
  const { rule, until } = useSeriesRule(workOrderRecordId, hasSeries)
  if (!rule || !until) return null

  return (
    <TreeRow
      depth={depth}
      icon={<CalendarOff className='size-4' />}
      title={
        <span className='text-sm text-muted-foreground'>
          Series ends after {format(parseISO(until), 'EEE, MMM d')}
        </span>
      }
      actions={
        canEdit ? (
          <SeriesEndEditor
            workOrderRecordId={workOrderRecordId}
            until={until}
            visits={visits}
            onChanged={onChanged}
            trigger={
              <TreeRowButton tooltipText='Extend series'>
                <CalendarPlus />
              </TreeRowButton>
            }
          />
        ) : undefined
      }
    />
  )
}

export interface SeriesSummaryRowProps {
  workOrderRecordId: RecordId
  canEdit: boolean
  visits: JobVisit[]
  onChanged: () => void
}

/**
 * Compact always-visible series state for the DRAWER schedule card (plan 36 §B.4) — the full
 * job view has `RecurringEngagementCard` for this; the drawer previously showed nothing:
 * "Weekly on Wed, Thu · ends Aug 18 · 3 skipped", or the dead-window "Series ended" state
 * when a scope edit re-anchored the pattern past its own end (§2 rec). Renders nothing for a
 * rule-less job.
 */
export function SeriesSummaryRow({
  workOrderRecordId,
  canEdit,
  visits,
  onChanged,
}: SeriesSummaryRowProps) {
  const { getSetting } = useSettings({ scope: 'GENERAL' })
  const weekStart = (scalarSetting(getSetting('organization.weekStart')) ?? 'monday') as
    | 'monday'
    | 'sunday'
    | 'saturday'
  const hasSeries = visits.some((visit) => visit.recurrenceRuleId)
  const { rule, pattern, until, windowEmpty } = useSeriesRule(workOrderRecordId, hasSeries)
  if (!rule || !pattern) return null

  const parts = describeRecurrenceParts(pattern, { weekStart })
  const skipped = visits.filter(
    (visit) => visit.status === 'canceled' && visit.recurrenceRuleId
  ).length
  const secondary = windowEmpty
    ? 'Series ended — no further visits will be generated'
    : [parts.ends ?? (canEdit ? 'no end date' : null), skipped > 0 ? `${skipped} skipped` : null]
        .filter(Boolean)
        .join(' · ')

  return (
    <TreeRow
      icon={<Repeat className='size-4' />}
      title={<span className='text-sm'>{parts.frequency}</span>}
      secondary={
        secondary ? <span className='text-xs text-muted-foreground'>{secondary}</span> : undefined
      }
      actions={
        canEdit ? (
          <SeriesEndEditor
            workOrderRecordId={workOrderRecordId}
            until={until}
            visits={visits}
            onChanged={onChanged}
            trigger={
              <TreeRowButton tooltipText={until ? 'Change end date' : 'Set end date'}>
                <CalendarOff />
              </TreeRowButton>
            }
          />
        ) : undefined
      }
    />
  )
}
