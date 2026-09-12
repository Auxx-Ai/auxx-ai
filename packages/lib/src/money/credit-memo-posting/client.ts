// packages/lib/src/money/credit-memo-posting/client.ts

/**
 * The client-safe half of the bulk credit memo poster: types and constants
 * only.
 *
 * Everything here is a re-export of `types.ts`, which already imports nothing
 * but `../batch-posting/types`. The file exists so a browser has ONE import
 * path to reach the vocabulary the dialog renders - the reason
 * `docs/lib-module-guide.md` §7 gives - and so the server barrel (`index.ts`)
 * is the only thing that ever pulls `reads.ts` and `run.ts`, which reach
 * `@auxx/database` and friends.
 *
 * Deliberately NO `'use client'` directive: server code imports this file too,
 * and the directive would turn every export into a client-reference proxy
 * there. `money/fulfillment-posting/client.ts` carries the same warning for the
 * same reason.
 */

export {
  CREDIT_MEMO_BATCH_SOURCE_TYPE,
  CREDIT_MEMO_GL_POSTING_ATTRIBUTE,
  CREDIT_MEMO_POSTING_EXCLUSION_REASONS,
  type CreditMemoAmounts,
  type CreditMemoPostingExclusion,
  type CreditMemoPostingExclusionReason,
  type CreditMemoPostingGroup,
  type CreditMemoPostingGrouping,
  type CreditMemoPostingPlan,
  type CreditMemoPostingPlanInput,
  type CreditMemoPostingRef,
  type CreditMemoPostingRequest,
  type CreditMemoPostingRunSummary,
  type PlannedCreditMemo,
  type UnpostedCreditMemo,
} from './types'
