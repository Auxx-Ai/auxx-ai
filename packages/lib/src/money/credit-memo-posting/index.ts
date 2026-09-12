// packages/lib/src/money/credit-memo-posting/index.ts

/**
 * Bulk credit memo posting: one `credit_memo` entry per day or month over every
 * memo that no live posting claims
 * (`plans/accounting/tasks/25-batch-posting-and-credit-memos.md`).
 *
 * The three halves, in the order a run uses them:
 *
 * 1. `reads.ts` - the netting read, one statement plus a bounded pivot,
 * 2. `plan.ts` - PURE: grouping, exclusions and totals,
 * 3. `run.ts` - one `postEntry` per group and one stamp per memo.
 *
 * Explicit named exports only (`docs/lib-module-guide.md` §5). The client-safe
 * vocabulary lives in `client.ts`; a browser must import that, never this.
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
} from './client'
export { type CreditMemoPlanContext, groupKeyFor, planCreditMemoPosting } from './plan'
export {
  CLOSE_BLOCKING_EXCLUSION_REASONS,
  type CreditMemoPostingSettings,
  countCloseBlockingCreditMemos,
  countUnpostedCreditMemos,
  listCreditMemoPostings,
  readCreditMemoPostingSettings,
  readCreditMemoSettlementAccounts,
  readUnpostedCreditMemos,
  type UnpostedCreditMemoRange,
} from './reads'
export {
  type CreditMemoPostingPreview,
  type CreditMemoPostingPreviewInput,
  previewCreditMemoPosting,
  runCreditMemoPosting,
} from './run'
