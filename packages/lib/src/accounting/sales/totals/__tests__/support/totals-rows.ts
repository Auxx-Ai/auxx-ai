// packages/lib/src/accounting/sales/totals/__tests__/support/totals-rows.ts

import type { LineForTotalsRow } from '../../../../documents/lines/types'

/** One line as `readLinesForTotals` hands it to the totals engine. */
export function totalsRow(
  lineInstanceId: string,
  over: Partial<Omit<LineForTotalsRow, 'lineInstanceId'>> = {}
): LineForTotalsRow {
  return {
    lineInstanceId,
    lineTotal: null,
    taxable: true,
    optional: undefined,
    optionalSelected: undefined,
    lineTax: null,
    storedNetTotal: null,
    ...over,
  }
}
