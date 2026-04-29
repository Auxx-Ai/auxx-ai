// packages/lib/src/approvals/index.ts

export {
  approveBundle,
  type BundleTerminalStatus,
  buildApprovalToolContext,
  cancelPendingSend,
  rejectBundle,
  snoozeBundle,
} from './actions-service'
export {
  createBundleFromHeadlessRun,
  getBundle,
  type ListBundlesArgs,
  type ListBundlesResult,
  listBundles,
  markStaleBundles,
} from './bundle-service'
export type { HeadlessRunDeps } from './headless-runner'
export { runHeadlessSuggestion } from './headless-runner'
export { sanitizeEventPayloadForLLM } from './sanitize-event-payload'
export {
  assertNoUnresolvedTempIds,
  collectTempDeps,
  substituteTempIds,
  TEMP_ID_PATTERN,
  topoSortActions,
} from './temp-id'
export type {
  ActionOutcome,
  HeadlessRunInput,
  HeadlessRunResult,
  ProposedAction,
  StoredBundle,
} from './types'
