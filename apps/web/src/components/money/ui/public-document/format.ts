// apps/web/src/components/money/ui/public-document/format.ts

/**
 * Format an ISO date string for public document pages (quote acceptance, invoice pay) —
 * em dash when unset. Shared so the quote and invoice documents render dates identically.
 */
export function formatDocumentDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}
