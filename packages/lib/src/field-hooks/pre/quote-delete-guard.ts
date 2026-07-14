// packages/lib/src/field-hooks/pre/quote-delete-guard.ts

import { BadRequestError } from '../../errors'
import { UnifiedCrudHandler } from '../../resources/crud'
import type { EntityPreDeleteHandler } from '../types'

/**
 * Pre-delete guard for `quotes` (plans/dispatch/money/12-delete-safety.md §F, locked decision
 * 2). Rejects deleting a quote that's been converted to a still-active job — the SAME
 * predicate as `convert-quote.ts`'s one-job-per-quote guard (mirrored here rather than
 * extracted into a shared helper, since `convertQuoteToWorkOrder` doesn't expose it as a
 * standalone function). No admin gate here (quotes aren't money-bearing — member-deletable
 * stays), and no quote-owned line cleanup v1 — quote line items dangle like today; the plan's
 * §D one-time SQL sweep covers them eventually.
 */
export const guardQuoteConvertedDelete: EntityPreDeleteHandler = async (event) => {
  const { organizationId, userId, recordId } = event
  const handler = new UnifiedCrudHandler(organizationId, userId)

  const activeJobs = await handler.listFiltered({
    entityDefinitionId: 'work_order',
    filters: [
      {
        id: 'quote-delete-converted-guard',
        logicalOperator: 'AND',
        conditions: [
          {
            id: 'quote-delete-converted-guard-quote',
            fieldId: 'work_order:quote',
            operator: 'is',
            value: recordId,
          },
          {
            id: 'quote-delete-converted-guard-status',
            fieldId: 'work_order:status',
            operator: 'not in',
            value: ['canceled'],
          },
        ],
      },
    ],
    limit: 1,
    mode: 'oneshot',
  })
  if (activeJobs.ids.length > 0) {
    throw new BadRequestError(
      'This quote has been converted to a job — cancel or delete the job first'
    )
  }
}
