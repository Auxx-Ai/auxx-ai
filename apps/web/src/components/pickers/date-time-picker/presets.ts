// apps/web/src/components/pickers/date-time-picker/presets.ts

import { startOfWeek, startOfMonth, subDays, subWeeks, subMonths } from 'date-fns'
import type { RelativeDatePreset } from './types'
import { startOfDay } from './utils'

/**
 * Default relative date presets
 */
export const DEFAULT_DATE_PRESETS: RelativeDatePreset[] = [
  {
    value: 'today',
    label: 'Today',
    getDate: () => startOfDay(new Date()),
  },
  {
    value: 'yesterday',
    label: 'Yesterday',
    getDate: () => startOfDay(subDays(new Date(), 1)),
  },
  {
    value: 'last7days',
    label: 'Last 7 days',
    getDate: () => startOfDay(subDays(new Date(), 7)),
  },
  {
    value: 'last30days',
    label: 'Last 30 days',
    getDate: () => startOfDay(subDays(new Date(), 30)),
  },
  {
    value: 'thisWeek',
    label: 'This week',
    getDate: () => startOfWeek(new Date()),
  },
  {
    value: 'lastWeek',
    label: 'Last week',
    getDate: () => startOfWeek(subWeeks(new Date(), 1)),
  },
  {
    value: 'thisMonth',
    label: 'This month',
    getDate: () => startOfMonth(new Date()),
  },
  {
    value: 'lastMonth',
    label: 'Last month',
    getDate: () => startOfMonth(subMonths(new Date(), 1)),
  },
]
