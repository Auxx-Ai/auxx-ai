// apps/web/src/components/accounting/books-start.ts

const MONTH_KEY = /^(\d{4})-(\d{2})$/
const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/

// Spelled out rather than `toLocaleDateString('en-GB')`, which gives "Sept".
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatDay(date: Date): string {
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}

/** `'2025-12'` (the last month the old books close) → `'1 Jan 2026'`, the day Auxx's books start. */
export function booksStartDate(cutoffPeriod: string): string {
  const match = MONTH_KEY.exec(cutoffPeriod)
  if (!match) return cutoffPeriod
  return formatDay(new Date(Date.UTC(Number(match[1]), Number(match[2]), 1)))
}

/** `'2025-12-31'` (the closing day of the old books) → `'1 Jan 2026'`. */
export function booksStartDateFromCutoverDay(cutoverDate: string): string {
  const match = DAY_KEY.exec(cutoverDate)
  if (!match) return cutoverDate
  return formatDay(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1)))
}

/** `'2026-01-15'` → `'15 Jan 2026'`, the same format for any other day in books copy. */
export function formatBooksDay(day: string): string {
  const match = DAY_KEY.exec(day)
  if (!match) return day
  return formatDay(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))))
}
