// apps/web/src/components/money/ui/batch-posting/format.ts

/**
 * Render a `YYYY-MM-DD` group, shipment or exclusion key.
 *
 * 🛑 Formatted in UTC and NOT through `formatAccountingDate`. These keys were
 * already cut in the org's book time zone server-side, so re-projecting them
 * into that zone shifts a July 1 shipment to June 30 on any org west of UTC:
 * the day the posting is filed under and the day the table shows would then
 * disagree, on the one screen whose job is to be believed.
 */
export function formatDayKey(dayKey: string): string {
  const date = new Date(`${dayKey}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return dayKey
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}
