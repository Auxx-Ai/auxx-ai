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
    { enabled: Boolean(workOrderRecordId) }
  )
  const hasExistingRule = Boolean(recurrenceQuery.data)

  const [repeatMode, setRepeatMode] = useState<RecurrencePreset>('none')
  const [customPattern, setCustomPattern] = useState<RecurrencePattern>(
    defaultCustomPattern(initialStartTime ?? undefined)
  )
  // Ends (until/count) live independently of the preset/custom pattern — both popovers edit
  // them via one `RecurrenceEndFields` regardless of Repeats mode.
  const [ends, setEndsRaw] = useState<{ until?: string; count?: number }>({})
  const [repeatsTouched, setRepeatsTouched] = useState(false)
  const initializedFromRuleRef = useRef(false)

  // Initialize Repeats state from the existing rule ONCE — later realtime refetches of
  // `getRecurrence` (another tab editing the same series) must not clobber an in-progress edit.
  useEffect(() => {
    if (initializedFromRuleRef.current) return
    if (recurrenceQuery.isLoading) return
    initializedFromRuleRef.current = true
    if (!recurrenceQuery.data) return
    const pattern = recurrenceQuery.data.pattern as unknown as RecurrencePattern
    const preset = classifyPreset(pattern)
    setRepeatMode(preset)
    setEndsRaw({ until: pattern.until, count: pattern.count })
    if (preset === 'custom') setCustomPattern({ ...pattern, until: undefined, count: undefined })
  }, [recurrenceQuery.data, recurrenceQuery.isLoading])

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
  const patternValid =
    !wantsRecurrenceWrite ||
    (effectivePattern != null && recurrencePatternSchema.safeParse(effectivePattern).success)

  /** Marks Repeats as touched (so `wantsRecurrenceWrite` engages) alongside the Ends update. */
  const setEnds = (next: { until?: string; count?: number }) => {
    setRepeatsTouched(true)
    setEndsRaw(next)
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
    repeatMode,
    // Short label for the collapsed Repeat row's pill ("Weekly", "Custom", …); the full
    // `recurrenceSummary` renders below the row so a long custom cadence never stretches the pill.
    repeatLabel: recurrencePresetLabel(repeatMode),
    customPattern,
    setCustomPattern,
    ends,
    setEnds,
    repeatsTouched,
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
