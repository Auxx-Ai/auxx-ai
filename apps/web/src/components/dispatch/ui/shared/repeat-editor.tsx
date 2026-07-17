// apps/web/src/components/dispatch/ui/shared/repeat-editor.tsx

'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import {
  RecurrenceEndFields,
  RecurrencePatternFields,
} from '../recurrence/recurrence-pattern-fields'
import type { RecurrencePreset } from '../recurrence/recurrence-utils'
import type { RecurrenceEditor } from './use-recurrence-editor'

export interface RepeatEditorProps {
  editor: RecurrenceEditor
  disabled?: boolean
}

/**
 * Shared Repeats editor content (decision #12) — the preset select + `RecurrencePatternFields`
 * (custom) + `RecurrenceEndFields`, driven entirely by `useRecurrenceEditor`. Injected via the
 * base `EventRepeatSection`'s `renderEditor` slot by both the board and schedule popovers.
 */
export function RepeatEditor({ editor, disabled }: RepeatEditorProps) {
  const {
    repeatMode,
    hasExistingRule,
    showsRecurringNote,
    handleRepeatModeChange,
    customPattern,
    setCustomPattern,
    ends,
    setEnds,
    weekStartIndex,
    recurrenceSummary,
    wantsRecurrenceWrite,
    patternValid,
  } = editor

  return (
    <div className='space-y-2 p-1'>
      <Select
        value={repeatMode}
        disabled={disabled}
        onValueChange={(v) => handleRepeatModeChange(v as RecurrencePreset)}>
        <SelectTrigger size='sm' className='w-full'>
          <SelectValue placeholder='Repeats' />
        </SelectTrigger>
        <SelectContent>
          {/* Selecting None on an existing rule is out of scope for v1 (06 §6) — ending a
              series happens via the Pause/End engagement actions, not this control. */}
          {!hasExistingRule && <SelectItem value='none'>Does not repeat</SelectItem>}
          <SelectItem value='weekly'>Weekly</SelectItem>
          <SelectItem value='biweekly'>Every 2 weeks</SelectItem>
          <SelectItem value='monthly'>Monthly</SelectItem>
          <SelectItem value='custom'>Custom...</SelectItem>
        </SelectContent>
      </Select>

      {/* Plan 30 §1 "rec" sub-decision — a rule-less job's first cadence pick converges it onto
          the recurring `jobType` (04-ui §7); cheap honesty instead of a confirm dialog. */}
      {showsRecurringNote && (
        <p className='px-0.5 text-xs text-muted-foreground'>This makes the job recurring.</p>
      )}

      {repeatMode === 'custom' && (
        <RecurrencePatternFields
          value={customPattern}
          onChange={setCustomPattern}
          weekStartIndex={weekStartIndex}
          hideEndCondition
        />
      )}

      {repeatMode !== 'none' && (
        <div className='rounded-md border p-2'>
          <RecurrenceEndFields value={ends} onChange={setEnds} className='flex flex-col gap-2' />
          {/* Plan 30 §H (decision 9) — `count` counts GENERATED occurrences, matching the engine:
              a skipped visit still consumes a slot. */}
          {ends.count != null && (
            <p className='px-0.5 pt-1 text-xs text-muted-foreground'>
              Includes skipped visits in the count.
            </p>
          )}
        </div>
      )}

      {recurrenceSummary && (
        <p className='px-0.5 text-xs text-muted-foreground'>{recurrenceSummary}</p>
      )}

      {wantsRecurrenceWrite && !patternValid && (
        <p className='px-0.5 text-xs text-destructive'>
          Pick at least one weekday, or fix the end condition, to save this pattern.
        </p>
      )}
    </div>
  )
}
