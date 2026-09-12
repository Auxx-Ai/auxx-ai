// apps/web/src/components/money/ui/batch-posting/count-label.ts

import type { BatchPostingCount } from './types'

/**
 * `12 shipments`, `1 memo`.
 *
 * The nouns are the ONLY thing the footer and the result page take from the
 * source (§5.5), so the pluralisation lives here rather than in either of them.
 */
export function countLabel(count: BatchPostingCount): string {
  return `${count.value} ${count.value === 1 ? count.singular : count.plural}`
}
