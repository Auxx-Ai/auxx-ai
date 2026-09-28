// apps/web/src/components/data-connectors/lib/format-history.ts

import { format, parseISO } from 'date-fns'

/** A coverage/floor instant as its UTC calendar day, e.g. "3 Mar 2025" (floors are UTC midnights). */
export function formatHistoryDay(iso: string): string {
  return format(parseISO(iso.slice(0, 10)), 'd MMM yyyy')
}

/** "History from 3 Mar 2025", or "History from the beginning" for null (everything). */
export function describeHistoryFrom(coverageFrom: string | null): string {
  return coverageFrom
    ? `History from ${formatHistoryDay(coverageFrom)}`
    : 'History from the beginning'
}
