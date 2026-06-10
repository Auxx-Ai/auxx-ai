// apps/web/src/components/kopilot/ui/blocks/table-styles.ts

/**
 * Shared table styling vocabulary, consumed by both the `auxx:table` block
 * (`table-block.tsx`) and plain GFM markdown tables in assistant prose
 * (`../messages/prose-table.tsx`) so the two render with the same visual
 * language. Block-only extras (sticky header/first column, corner rounding,
 * edge shadows) stay in `table-block.tsx`.
 */

export const tableClass = 'w-full text-sm'

// text-left overrides the UA default `th { text-align: center }`; explicit
// alignment (block getColumnAlign, GFM `:---:`) arrives as inline style and wins.
export const tableHeaderCellClass =
  'text-left text-muted-foreground whitespace-nowrap border-b bg-muted px-3 py-2 font-medium'

export const tableBodyCellClass = 'max-w-[280px] break-words px-3 py-2 align-top'

export const tableRowClass = 'hover:bg-muted/30 transition-colors'
