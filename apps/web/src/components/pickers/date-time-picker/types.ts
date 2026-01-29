// apps/web/src/components/pickers/date-time-picker/types.ts

import type { PickerTriggerOptions } from '~/components/ui/picker-trigger'

/** Time period for 12-hour format */
export enum Period {
  AM = 'AM',
  PM = 'PM',
}

/** View type for internal navigation */
export enum ViewType {
  /** Calendar date selection */
  Calendar = 'calendar',
  /** Year and month selection */
  YearMonth = 'yearMonth',
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
  /** Currently displayed month */
  currentMonth: Date
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

/** Year/Month view props */
export interface YearMonthViewProps {
  /** Selected month (0-11) */
  selectedMonth: number
  /** Selected year */
  selectedYear: number
  /** Handler for month selection */
  onMonthSelect: (month: number) => void
  /** Handler for year selection */
  onYearSelect: (year: number) => void
}

/** Time view props (extends from time-picker) */
export interface TimeViewProps {
  /** Currently selected time */
  selectedTime: Date | undefined
  /** Filter function for minutes */
  minuteFilter?: (minutes: string[]) => string[]
  /** Handler for hour selection */
  onSelectHour: (hour: string) => void
  /** Handler for minute selection */
  onSelectMinute: (minute: string) => void
  /** Handler for period selection */
  onSelectPeriod: (period: Period) => void
}

/** Picker header props */
export interface PickerHeaderProps {
  /** Current view type */
  view: ViewType
  /** Picker mode */
  mode: PickerMode
  /** Current month being displayed */
  currentMonth: Date
  /** Selected year (for year/month view) */
  selectedYear: number
  /** Selected month (for year/month view) */
  selectedMonth: number
  /** Handler to open year/month picker */
  onOpenYearMonthPicker: () => void
  /** Handler to close year/month picker */
  onCloseYearMonthPicker: () => void
  /** Handler for next month navigation */
  onNextMonth: () => void
  /** Handler for previous month navigation */
  onPrevMonth: () => void
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
  /** Handler for year/month cancel */
  onYearMonthCancel: () => void
  /** Handler for year/month confirm */
  onYearMonthConfirm: () => void
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

  // Styling
  /** Additional className */
  className?: string
}
