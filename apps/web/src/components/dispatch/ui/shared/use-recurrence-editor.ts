// apps/web/src/components/dispatch/ui/shared/use-recurrence-editor.ts

import { detectTimezone } from '@auxx/config/client'
import { weekStartToIndex } from '@auxx/lib/availability/client'
import {
  describeRecurrence,
  type RecurrencePattern,
  recurrencePatternSchema,
} from '@auxx/lib/recurrence/client'
import { differenceInMinutes, format } from 'date-fns'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { RecordId } from '~/components/resources'
import { useSettings } from '~/hooks/use-settings'
import { ORG_STATIC_STALE_TIME } from '~/trpc/query-client'
import { api } from '~/trpc/react'
import {
  buildPresetPattern,
  classifyRecurrencePreset as classifyPreset,
  defaultCustomPattern,
  type RecurrencePreset,
  recurrencePresetLabel,
  scalarSetting,
} from '../recurrence/recurrence-utils'

export interface UseRecurrenceEditorParams {
  workOrderRecordId?: RecordId
  initialStartTime?: Date | null
  /** The LIVE start-time value the popover currently has staged/committed, if any. */
  startTime?: Date | null
  /**
   * The TARGET VISIT's own `recurrenceRuleId` (plan 30 §F.4), distinct from
   * `workOrderRecordId`'s `getRecurrence` (the work order's rule, if any). One rule per work
   * order is a hard constraint, so a rule-less visit on an already-recurring job can only ever
   * show/edit "Does not repeat" — never the sibling series' cadence.
   */
  recurrenceRuleId?: string | null
}

/** The `dispatch.setRecurrence` mutation payload shape, or `null` when there's nothing to save. */
export interface SetRecurrenceInput {
  workOrderRecordId: RecordId
  pattern: RecurrencePattern
  template: {
    startMinute: number
    durationMinutes: number
    defaultAssigneeUserId: string | null
  }
  timezone: string
  effectiveFrom: string
}

/**
 * The Repeats state machine (decision #12) — extracted from `schedule-popover.tsx:141-218`
 * essentially verbatim: `getRecurrence` query + init-once seed, preset/custom pattern, a
 * separately-tracked `ends`, and the derived summary/validity used by both `RepeatEditor` and
 * the popover that hosts it.
 */
export function useRecurrenceEditor({
  workOrderRecordId,
  initialStartTime,
  startTime,
  recurrenceRuleId,
}: UseRecurrenceEditorParams) {
  const utils = api.useUtils()
  const { getSetting } = useSettings({ scope: 'GENERAL' })
  const weekStart = (scalarSetting(getSetting('organization.weekStart')) ?? 'monday') as
    | 'monday'
    | 'sunday'
    | 'saturday'
  const weekStartIndex = weekStartToIndex(weekStart)

  const recurrenceQuery = api.dispatch.getRecurrence.useQuery(
    { workOrderRecordId: workOrderRecordId as RecordId },
    { enabled: Boolean(workOrderRecordId), staleTime: ORG_STATIC_STALE_TIME }
  )
  const workOrderHasRule = Boolean(recurrenceQuery.data)
  /** Display convergence (plan 30 §F.4) — keyed off the VISIT's own rule membership, not the
   * work order's `getRecurrence` presence. A visit that IS a series occurrence shows/edits the
   * WO's cadence (case a); a rule-less visit never does, even when the WO already has a rule for
   * its OTHER occurrences (case b) — one rule per work order, so that visit's Repeat row can
   * only ever mean "does this extra visit get its own new rule" (case c, rule-less WO). */
  const hasExistingRule = Boolean(recurrenceRuleId)
  /** Case (b): a rule-less visit on an already-recurring work order — Repeat is locked to "Does
   * not repeat" (one rule per job is a hard constraint); only Reschedule/Skip apply to the
   * visit's own placement, cadence edits happen on a true series occurrence instead. */
  const repeatLocked = !hasExistingRule && workOrderHasRule

  const [repeatMode, setRepeatMode] = useState<RecurrencePreset>('none')
  const [customPattern, setCustomPatternRaw] = useState<RecurrencePattern>(
    defaultCustomPattern(initialStartTime ?? undefined)
  )
  // Ends (until/count) live independently of the preset/custom pattern — both popovers edit
  // them via one `RecurrenceEndFields` regardless of Repeats mode.
  const [ends, setEndsRaw] = useState<{ until?: string; count?: number }>({})
  const [repeatsTouched, setRepeatsTouched] = useState(false)
  const initializedFromRuleRef = useRef(false)

  // Initialize Repeats state from the existing rule ONCE — later realtime refetches of
  // `getRecurrence` (another tab editing the same series) must not clobber an in-progress edit.
  // Only seeds when the VISIT itself is a rule member (`hasExistingRule`, case a) — a rule-less
  // visit on an already-recurring WO (case b, `repeatLocked`) must stay at the 'none' default so
  // its locked Repeat row reads "Does not repeat", not the sibling series' cadence.
  useEffect(() => {
    if (initializedFromRuleRef.current) return
    if (recurrenceQuery.isLoading) return
    initializedFromRuleRef.current = true
    if (!recurrenceQuery.data || !hasExistingRule) return
    const pattern = recurrenceQuery.data.pattern as unknown as RecurrencePattern
    const preset = classifyPreset(pattern)
    setRepeatMode(preset)
    setEndsRaw({ until: pattern.until, count: pattern.count })
    if (preset === 'custom') setCustomPatternRaw({ ...pattern, until: undefined, count: undefined })
  }, [recurrenceQuery.data, recurrenceQuery.isLoading, hasExistingRule])

  /**
   * Marks Repeats as touched alongside the pattern update — a weekday-chip/interval edit inside
   * an already-Custom rule is a cadence edit too. The raw setter never engaged
   * `wantsRecurrenceWrite`, so those edits silently no-oped at commit time (the "We,Th → Tu
   * does nothing" bug).
   */
  const setCustomPattern = (next: RecurrencePattern) => {
    setRepeatsTouched(true)
    setCustomPatternRaw(next)
  }

  // Preset patterns anchor on the LIVE start time (the date/time the user has staged/picked
  // this session), falling back to the visit's existing start when nothing's been touched yet.
  const effectiveStartTime = startTime ?? initialStartTime ?? undefined

  const effectivePattern = useMemo((): RecurrencePattern | null => {
    if (repeatMode === 'none') return null
    if (repeatMode === 'custom') return { ...customPattern, until: ends.until, count: ends.count }
    if (!effectiveStartTime) return null
    return {
      ...buildPresetPattern(repeatMode, effectiveStartTime),
      until: ends.until,
      count: ends.count,
    }
  }, [repeatMode, customPattern, effectiveStartTime, ends])

  const recurrenceSummary = useMemo(() => {
    if (!effectivePattern) return null
    return describeRecurrence(effectivePattern, { weekStart })
  }, [effectivePattern, weekStart])

  const handleRepeatModeChange = (nextMode: RecurrencePreset) => {
    setRepeatsTouched(true)
    if (nextMode === 'custom' && repeatMode !== 'custom') {
      // Expand from whatever pattern is currently in effect so switching to Custom doesn't
      // reset the user's picks (the existing rule's pattern if it was already custom-shaped,
      // else the preset-derived pattern, else a sane default).
      const seed =
        recurrenceQuery.data &&
        classifyPreset(recurrenceQuery.data.pattern as unknown as RecurrencePattern) === 'custom'
          ? (recurrenceQuery.data.pattern as unknown as RecurrencePattern)
          : repeatMode !== 'none' && effectiveStartTime
            ? buildPresetPattern(repeatMode, effectiveStartTime)
            : defaultCustomPattern(effectiveStartTime)
      // Ends live in the separate `ends` state now — strip them from the seed so they aren't
      // duplicated inside `customPattern`.
      setCustomPattern({ ...seed, until: undefined, count: undefined })
    }
    setRepeatMode(nextMode)
  }

  // Only an intentional Repeats edit this session writes the rule — an incidental
  // time/duration/assignee edit must never silently rewrite the series cadence.
  const wantsRecurrenceWrite = repeatsTouched && repeatMode !== 'none'
  /** Case (c) convergence (plan 30 §1 "rec" sub-decision) — a rule-less visit on a rule-less
   * work order picking a cadence is about to flip the WHOLE job recurring (the existing
   * `jobType` convergence), not just this one visit. Cheap honesty, no confirm dialog. */
  const showsRecurringNote = wantsRecurrenceWrite && !hasExistingRule && !workOrderHasRule
  const patternValid =
    !wantsRecurrenceWrite ||
    (effectivePattern != null && recurrencePatternSchema.safeParse(effectivePattern).success)

  /** Marks Repeats as touched (so `wantsRecurrenceWrite` engages) alongside the Ends update. */
  const setEnds = (next: { until?: string; count?: number }) => {
    setRepeatsTouched(true)
    setEndsRaw(next)
  }

  /** Call right after firing `setRecurrence` — the staged state now IS the saved state, so a
   * subsequent close must neither re-commit nor discard it. */
  const markSaved = () => setRepeatsTouched(false)

  /**
   * Discard staged Repeats edits — re-seed from the existing rule (same mapping as the init
   * effect) or back to the 'none' default. Consumers call this when the editor page closes
   * with unsaved edits, so the collapsed Repeat pill never shows a cadence that was never
   * written.
   */
  const resetToRule = () => {
    setRepeatsTouched(false)
    if (!recurrenceQuery.data || !hasExistingRule) {
      setRepeatMode('none')
      setEndsRaw({})
      setCustomPatternRaw(defaultCustomPattern(initialStartTime ?? undefined))
      return
    }
    const pattern = recurrenceQuery.data.pattern as unknown as RecurrencePattern
    const preset = classifyPreset(pattern)
    setRepeatMode(preset)
    setEndsRaw({ until: pattern.until, count: pattern.count })
    if (preset === 'custom') setCustomPatternRaw({ ...pattern, until: undefined, count: undefined })
  }

  /** The `dispatch.setRecurrence` payload for the current pattern, or `null` if not writable. */
  const buildSetRecurrenceInput = (
    inputStartTime: Date,
    inputEndTime: Date,
    assigneeUserId: string | null
  ): SetRecurrenceInput | null => {
    if (!effectivePattern || !workOrderRecordId) return null
    return {
      workOrderRecordId,
      pattern: effectivePattern,
      template: {
        startMinute: inputStartTime.getHours() * 60 + inputStartTime.getMinutes(),
        durationMinutes: differenceInMinutes(inputEndTime, inputStartTime),
        defaultAssigneeUserId: assigneeUserId,
      },
      timezone: detectTimezone(),
      effectiveFrom: format(inputStartTime, 'yyyy-MM-dd'),
    }
  }

  const invalidate = () => {
    if (workOrderRecordId) void utils.dispatch.getRecurrence.invalidate({ workOrderRecordId })
  }

  return {
    hasExistingRule,
    repeatLocked,
    showsRecurringNote,
    repeatMode,
    // Short label for the collapsed Repeat row's pill ("Weekly", "Custom", …); the full
    // `recurrenceSummary` renders below the row so a long custom cadence never stretches the pill.
    repeatLabel: recurrencePresetLabel(repeatMode),
    customPattern,
    setCustomPattern,
    ends,
    setEnds,
    repeatsTouched,
    markSaved,
    resetToRule,
    handleRepeatModeChange,
    effectivePattern,
    recurrenceSummary,
    patternValid,
    wantsRecurrenceWrite,
    weekStartIndex,
    buildSetRecurrenceInput,
    invalidate,
  }
}

export type RecurrenceEditor = ReturnType<typeof useRecurrenceEditor>
