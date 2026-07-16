// apps/web/src/components/pickers/date-time-picker/types.ts

import type { PickerTriggerOptions } from '~/components/ui/picker-trigger'

/** Time period for 12-hour format */
export enum Period {
  AM = 'AM',
  PM = 'PM',
}

/** View type for internal navigation */
export enum ViewType {
  /** Calendar date selection (the Calendar component owns its own year/month swap) */
  Calendar = 'calendar',
  /** Time selection */
  Time = 'time',
}

/** Picker mode */
export type PickerMode = 'date' | 'time' | 'datetime'

/** Relative date preset option */
export interface RelativeDatePreset {
  /** Unique value identifier */
  value: string
  /** Display label */
  label: string
  /** Function to compute the date */
  getDate: () => Date
}

/** Main DateTimePicker props */
export interface DateTimePickerProps {
  /** Current selected date/time */
  value?: Date
  /** Callback when value changes */
  onChange: (value: Date | undefined) => void
  /** Callback when cleared */
  onClear?: () => void

  // Mode configuration
  /** Picker mode: 'date', 'time', or 'datetime' */
  mode?: PickerMode

  // Display options
  /** Placeholder text */
  placeholder?: string
  /** Title shown in header (time view) */
  title?: string
  /** Date format string for display (date-fns format) */
  dateFormat?: string
  /** Time format string for display */
  timeFormat?: string

  // Feature toggles
  /** Hide the time picker in datetime mode */
  hideTimePicker?: boolean
  /** Hide the "Now" / "Today" button */
  hideNowButton?: boolean
  /** Skip confirmation (select and close immediately) */
  noConfirm?: boolean
  /** Hide clear button */
  notClearable?: boolean
  /** Show relative date presets (e.g., Today, Yesterday) */
  showPresets?: boolean
  /** Custom relative date presets */
  presets?: RelativeDatePreset[]

  // Constraints
  /** Minimum selectable date */
  minDate?: Date
  /** Maximum selectable date */
  maxDate?: Date
  /** Function to disable specific dates */
  disabledDates?: (date: Date) => boolean
  /** Filter function for minutes (e.g., 15-min intervals) */
  minuteFilter?: (minutes: string[]) => string[]

  // Timezone
  /** Timezone for display (IANA format) */
  timezone?: string
  /** Show timezone label */
  showTimezone?: boolean

  // Styling
  /** Disabled state */
  disabled?: boolean
  /** Additional className for popover content */
  className?: string
  /** Popover alignment */
  align?: 'start' | 'center' | 'end'
  /** Popover side */
  side?: 'top' | 'right' | 'bottom' | 'left'

  // Custom trigger
  /** Custom trigger element */
  children?: React.ReactNode
  /** Controlled open state */
  open?: boolean
  /** Controlled open state handler */
  onOpenChange?: (open: boolean) => void

  /** Trigger customization options */
  triggerProps?: PickerTriggerOptions
}

/** Calendar view props */
export interface CalendarViewProps {
  /** Currently displayed month (controlled) */
  currentMonth: Date
  /** Fires on nav clicks and on picks in the Calendar's built-in year-month view */
  onMonthChange: (month: Date) => void
  /** Selected date */
  selectedDate: Date | undefined
  /** Handler for date selection */
  onDateSelect: (date: Date) => void
  /** Minimum selectable date */
  minDate?: Date
  /** Maximum selectable date */
  maxDate?: Date
  /** Function to disable specific dates */
  disabledDates?: (date: Date) => boolean
}

/** Time view props (extends from time-picker) */
export interface TimeViewProps {
  /** Currently selected time */
  selectedTime: Date | undefined
  /** Filter function for minutes */
  minuteFilter?: (minutes: string[]) => string[]
  /**
   * Render in 24-hour mode: hours column lists '00'..'23' and the AM/PM period column is hidden.
   * Defaults to false (today's 12-hour behavior, unchanged).
   */
  use24HourTime?: boolean
  /** Handler for hour selection ('01'..'12' in 12-hour mode, '00'..'23' in 24-hour mode) */
  onSelectHour: (hour: string) => void
  /** Handler for minute selection */
  onSelectMinute: (minute: string) => void
  /** Handler for period selection (not called in 24-hour mode) */
  onSelectPeriod: (period: Period) => void
}

/** Picker footer props */
export interface PickerFooterProps {
  /** Current view type */
  view: ViewType
  /** Picker mode */
  mode: PickerMode
  /** Whether to show time picker toggle */
  showTimeToggle: boolean
  /** Formatted time display */
  displayTime: string
  /** Handler for toggling time picker view */
  onToggleTimePicker: () => void
  /** Handler for "Now" / "Today" button */
  onSelectNow: () => void
  /** Handler for confirm button */
  onConfirm: () => void
  /** Hide the now button */
  hideNowButton?: boolean
}

/** Option list item props */
export interface OptionListItemProps {
  /** Whether this item is selected */
  isSelected: boolean
  /** Click handler */
  onClick: () => void
  /** Disable auto-scroll behavior */
  noAutoScroll?: boolean
  /** Children content */
  children: React.ReactNode
}

/** Props for standalone DateTimePickerContent */
export interface DateTimePickerContentProps {
  /** Current selected date/time */
  value?: Date
  /** Callback when value changes (confirmed selection) */
  onChange: (value: Date | undefined) => void
  /** Callback when cleared */
  onClear?: () => void
  /** Picker mode: 'date', 'time', or 'datetime' */
  mode?: PickerMode

  // Feature toggles
  /** Hide the time picker toggle in datetime mode */
  hideTimePicker?: boolean
  /** Hide the "Now" / "Today" button */
  hideNowButton?: boolean
  /** Skip confirmation (select and close immediately for date mode) */
  noConfirm?: boolean
  /** Show relative date presets */
  showPresets?: boolean
  /** Custom relative date presets */
  presets?: RelativeDatePreset[]

  // Constraints
  /** Minimum selectable date */
  minDate?: Date
  /** Maximum selectable date */
  maxDate?: Date
  /** Function to disable specific dates */
  disabledDates?: (date: Date) => boolean
  /** Filter function for minutes */
  minuteFilter?: (minutes: string[]) => string[]
  /** Render hours in 24-hour format and hide the AM/PM column. */
  use24HourTime?: boolean

  // Styling
  /** Additional className */
  className?: string
}
