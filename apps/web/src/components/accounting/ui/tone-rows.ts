// apps/web/src/components/accounting/ui/tone-rows.ts

/**
 * The `Alert` tone palettes, as `rowClassName` for a tinted `TreeRow`.
 *
 * Both name the hover fill too: `TreeRow` hovers to `bg-background`, which
 * drops the tint on the way past.
 */

/** `Alert variant='warning'`, on a row. */
export const WARNING_ROW =
  'bg-yellow-50 text-yellow-700 hover:bg-yellow-100 dark:bg-yellow-950/20 dark:text-yellow-500 dark:hover:bg-yellow-950/40'

/** `Alert variant='destructive'`, on a row. */
export const DESTRUCTIVE_ROW = 'bg-destructive/5 text-destructive hover:bg-destructive/10'

/**
 * The `Alert` outlines, for a tinted row that stands alone on the page.
 *
 * Separate from the fills above because they are not always wanted: a marker
 * stacked directly on top of a statement that carries its own frame reads as a
 * second frame, while the ledger's notices sit on bare background and need the
 * edge. `TreeRow` is `rounded-md`, so these match that radius by inheritance.
 */
export const WARNING_RING = 'border border-yellow-500/50'
export const DESTRUCTIVE_RING = 'border border-destructive/50 dark:border-destructive'
