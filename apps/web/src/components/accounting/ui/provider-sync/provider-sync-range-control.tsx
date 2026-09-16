// apps/web/src/components/accounting/ui/provider-sync/provider-sync-range-control.tsx

'use client'

// What the sync reads, as a mode and then a range
// (plans/accounting/tasks/27-the-connected-system-is-its-own-page.md §4.1).
//
// It used to be two bare date fields with a five-line paragraph underneath
// explaining that an empty `From` is not "no start date" but the cutover floor.
// That is a semantic the control could not express, carried in prose.
//
// 🔑 And the shared `DateRangePicker` cannot express it either: its value type
// is `{ from: Date; to: Date }` - both required - and `onChange` always emits
// both. `undefined` means "no range at all", which is a third thing. So the
// mode switch is not polish on top of the picker; it is what makes the picker
// usable here.
//
// 🛑 THE RANGE IS NOT ONLY WHAT TO READ. IT IS WHAT TO REVERSE. `sync.ts` rule 3
// converges by re-reading: it writes what is new and REVERSES anything held as
// `provider_sync` **in that range** whose id has stopped appearing, scoped per
// chunk. So a narrow range leaves an entry the accountant deleted outside it
// standing in these books indefinitely. That is why "everything since the
// cutover" is the default rather than merely the convenient option, and why the
// consequence is said out loud below the picker rather than left to be found.

import { Button } from '@auxx/ui/components/button'
import { DateRangePicker } from '@auxx/ui/components/date-range-picker'
import { ToggleGroup, ToggleGroupItem } from '@auxx/ui/components/toggle-group'
import {
  localDateOfDayKey as dateOfDayKey,
  dayKeyOfLocalDate as dayKeyOf,
} from '@auxx/utils/calendar-day'
import { CalendarIcon } from 'lucide-react'

/** Which question the control is asking. */
export type ProviderSyncRangeMode = 'everything' | 'range'

export interface ProviderSyncRangeControlProps {
  mode: ProviderSyncRangeMode
  onModeChange: (mode: ProviderSyncRangeMode) => void
  /** `YYYY-MM-DD`. Only read in `range` mode; `''` in `everything` mode. */
  from: string
  /** `YYYY-MM-DD`, inclusive. */
  to: string
  onRangeChange: (range: { from: string; to: string }) => void
  /**
   * The earliest date the sync may read, `YYYY-MM-DD`, or `null` when the org
   * has no usable `accounting.cutoffPeriod` and the floor cannot be computed.
   */
  floor: string | null
  /** Today in the BOOK timezone - what `everything` mode reads up to. */
  todayInBooks: string
  disabled?: boolean
}

/**
 * Two modes, and a range picker in the second.
 *
 * @see ProviderSyncPanel, which owns the state and the mutation.
 */
export function ProviderSyncRangeControl({
  mode,
  onModeChange,
  from,
  to,
  onRangeChange,
  floor,
  todayInBooks,
  disabled,
}: ProviderSyncRangeControlProps) {
  return (
    <div className='flex flex-col gap-2'>
      <ToggleGroup
        type='single'
        size='sm'
        // `outline`, not the default transparent: two plain buttons read as two
        // actions, and this is one question with two answers.
        variant='outline'
        value={mode}
        onValueChange={(value) => {
          if (!value) return
          onModeChange(value as ProviderSyncRangeMode)
        }}
        disabled={disabled}
        aria-label='What to read'
        className='justify-start'>
        <ToggleGroupItem value='everything'>Everything since the cutover</ToggleGroupItem>
        <ToggleGroupItem value='range'>A specific range</ToggleGroupItem>
      </ToggleGroup>

      {mode === 'everything' ? (
        <p className='text-muted-foreground text-xs'>
          {floor ? (
            <>
              Reads <span className='font-medium'>{floor}</span> to{' '}
              <span className='font-medium'>{todayInBooks}</span> - everything this sync is allowed
              to see. Anything before {floor} is already in the books as the single opening entry,
              so a date earlier than the cutover is refused rather than moved forward.
            </>
          ) : (
            // 🛑 Never print `undefined` as a date. No usable
            // `accounting.cutoffPeriod` means the floor cannot be placed at all,
            // and the press will come back refused with a message naming the
            // value it found - which is more use than anything invented here.
            <>
              This organization has no accounting cutoff month yet, so the earliest readable date
              cannot be worked out. Set it on the General page first.
            </>
          )}
        </p>
      ) : (
        <div className='flex flex-col gap-2'>
          <DateRangePicker
            value={{ from: dateOfDayKey(from || todayInBooks), to: dateOfDayKey(to) }}
            onChange={(next) => onRangeChange({ from: dayKeyOf(next.from), to: dayKeyOf(next.to) })}
            /*
              🛑 PRESETS OFF, and not as a matter of taste. Two independent
              reasons, either of which is enough:

               1. `allTime` hardcodes `2020-01-01`, which is below the cutover
                  floor for every organization - so it is a guaranteed refusal,
                  and it reads as exactly the thing the other mode means.
               2. EVERY preset computes from `new Date()` in the BROWSER's
                  timezone. This panel takes `todayInBooks` precisely because it
                  must not do that: an accounting date is a calendar day in the
                  books' own zone, and the viewer's would put a bookkeeper in
                  Auckland a day ahead of their own ledger.
            */
            showPresets={false}
            /*
              ⚠️ A COURTESY, NEVER THE SAFETY. `range.ts` asserts the floor
              before the first provider call and refuses rather than clamps, on
              the grounds that "a filter is a place where a later fix-a-bug edit
              silently widens the range". This changes nothing server-side; it
              just stops somebody picking a day whose only feedback is a round
              trip. The explanatory line below stays for the same reason - with
              this on, nobody ever reads the refusal that says WHY.
            */
            {...(floor ? { minDate: dateOfDayKey(floor) } : {})}
            /*
              🛑 THE TRIGGER PRINTS THE DATES, and deliberately ignores the
              `label` the picker offers. `calculateDisplayLabel` runs
              `detectTimeFrameFromDateRange` FIRST and regardless of
              `showPresets`, so a range that happens to coincide with one of its
              built-in presets renders as that preset's NAME - observed
              2026-09-14, where a seeded 2026-09-01 to 2026-09-14 rendered as
              "Month to date". That names a preset this control does not offer
              and hides the two dates that are the whole point of it.

              ⚠️ And the presets it matches against are computed in the BROWSER's
              zone, so the coincidence itself is a browser-time accident - the
              same reason `showPresets` is off above.
            */
            trigger={() => (
              <Button
                type='button'
                variant='outline'
                size='sm'
                disabled={disabled}
                className='w-full justify-start text-left font-normal tabular-nums sm:w-auto'>
                <CalendarIcon />
                {from || todayInBooks} to {to}
              </Button>
            )}
          />
          <p className='text-muted-foreground text-xs'>
            A narrower range reads faster and only reconciles what is inside it: an entry your
            accountant deleted outside the range stays in these books until a run covers it.
            {floor && (
              <>
                {' '}
                Nothing before <span className='font-medium'>{floor}</span> can be read - that
                period is already in the books as the single opening entry.
              </>
            )}
          </p>
        </div>
      )}
    </div>
  )
}
