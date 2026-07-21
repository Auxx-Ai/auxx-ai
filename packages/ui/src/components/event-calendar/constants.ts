// packages/ui/src/components/event-calendar/constants.ts

/**
 * The month/week continuous streams span these years — index 0 is the first
 * day (week view) or first week (month view) of the start year.
 */
export const StreamStartYear = 2020
export const StreamEndYear = 2045

/** Height (px) of a month-view event chip — drives the "+N more" overflow math. */
export const EventHeight = 24

/** Vertical gap (px) between stacked month-view event chips. */
export const EventGap = 4

/**
 * Notion-style tick grid: the vertical hour grid is derived from a 5-minute
 * tick of a fixed pixel height, so a single knob (`GridTickHeight`) rescales
 * the whole timed grid. These mirror Notion Calendar's `--grid-tick-*` vars.
 */
export const GridTickHeight = 4
export const GridTickMinutes = 5

/** Minutes in an hour — the tick→hour multiplier (`60 / GridTickMinutes` ticks per hour). */
const MinutesPerHour = 60

/**
 * Height (px) of one hour row in week/day/resource views — the single source
 * both the JS position math and the `--week-cells-height` CSS `calc()` read.
 * Derived from the tick grid: 4px × (60 / 5) = 48px (Notion parity).
 */
export const WeekCellsHeight = GridTickHeight * (MinutesPerHour / GridTickMinutes)

/** Height (px) of the sticky day-header row (weekday + date). Mirrors Notion's `--grid-header-height`. */
export const GridHeaderHeight = 53

/** All-day lane chip metrics (px) — Notion's `--grid-all-day-chip-*`. */
export const GridAllDayChipHeight = 19
export const GridAllDayChipSpacing = 2
export const GridAllDayPaddingTop = 3

/** Number of days shown in agenda view. */
export const AgendaDaysToShow = 30

/** First/last hour rendered in week/day/resource grids. */
export const StartHour = 0
export const EndHour = 24

/** Default duration (hours) used when a slot click doesn't specify one. */
export const DefaultStartHour = 9
export const DefaultEndHour = 10

/** Fallback event accent color (indigo-500) when `event.color` is unset. */
export const DefaultEventColor = '#6366f1'

/** Minimum event duration (minutes) enforced by drag-resize. */
export const MinEventDurationMinutes = 15

/** Snap increment (minutes) for both drag-move and drag-resize. */
export const SnapMinutes = 15

/** Current-time indicator accent — a fixed brand accent, not tied to any event color. */
export const CurrentTimeLineClass = 'bg-rose-600 dark:bg-rose-500'
export const CurrentTimeLabelClass = 'bg-rose-600 text-white dark:bg-rose-500'

/** Pixels per hour on the horizontal timeline view's x-axis (plan 33). */
export const TimelineHourWidth = 96

/** Height (px) of one event lane within a timeline worker row (plan 33). */
export const TimelineLaneHeight = 28

/** Width (px) of the sticky-left worker rail in the horizontal timeline view (plan 33). */
export const TimelineRailWidth = 160
