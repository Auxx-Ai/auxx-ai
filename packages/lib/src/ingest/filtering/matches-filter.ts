// packages/lib/src/ingest/filtering/matches-filter.ts

/** Returns true when `email` matches an entry exactly OR its domain matches an entry. */
export function matchesFilterEntry(email: string, entries: string[]): boolean {
  const normalized = email.toLowerCase().trim()
  const domain = normalized.split('@')[1]
  return entries.some((entry) => normalized === entry || domain === entry)
}
