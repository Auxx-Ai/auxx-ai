// packages/lib/src/mail-classification/index.ts
// Mail-classification domain barrel (plans/mail-filter/05-mail-classification-plan.md).
// Explicit named exports only — see CLAUDE.md's "Module Exports" convention.

// Write path (§3.3, C9)
export { applyClassificationTag, markMessageClassified, toClassificationMarker } from './apply'
// The one model call (§3.2)
export {
  buildClassificationPrompt,
  buildClassificationSchema,
  classifyMessage,
  renderLabels,
} from './classify'
// Client-safe constants + types (also importable as `@auxx/lib/mail-classification/client`)
export {
  countClassificationFailures,
  isSameReclassifyScope,
  MAIL_CLASSIFICATION_INBOX_IDS_SETTING,
  MAIL_CLASSIFICATION_JOB_NAME,
  MAIL_CLASSIFICATION_METADATA_KEY,
  MAIL_CLASSIFY_ALT_TAG_CHARS,
  MAIL_CLASSIFY_BODY_CHARS,
  MAIL_CLASSIFY_CONFIDENCE_THRESHOLD,
  MAIL_CLASSIFY_FAILURE_REASONS,
  MAIL_CLASSIFY_NO_CATEGORY,
  MAIL_CLASSIFY_SUMMARY_CHARS,
  MAIL_RECLASSIFY_APPLY_JOB_NAME,
  MAIL_RECLASSIFY_BACKLOG_COUNT_CAP,
  MAIL_RECLASSIFY_DAY_PRESETS,
  MAIL_RECLASSIFY_DEFAULT_MODE,
  MAIL_RECLASSIFY_DEFAULT_RANGE,
  MAIL_RECLASSIFY_MAX_THREADS,
  MAIL_RECLASSIFY_PAGE_SIZE,
  MAIL_RECLASSIFY_SAMPLE_JOB_NAME,
  MAIL_RECLASSIFY_SAMPLE_SIZE,
  MAIL_RECLASSIFY_THREAD_PRESETS,
  type MailClassificationLabel,
  type MailClassificationMarker,
  type MailClassificationSkipReason,
  type MailReclassifyMode,
  type MailReclassifyRange,
  type MailReclassifyRunReport,
  type MailReclassifyRunStatus,
  type MailReclassifySampleLabelStat,
  type MailReclassifySampleReport,
  type MailReclassifySampleStatus,
  type MailReclassifyUndoReport,
  TAG_AI_CLASSIFY_ATTRIBUTE,
} from './client'
// The `then`-side door (§4)
export { enqueueMailClassification } from './enqueue'
// The §3.1 exit ladder
export { guardClassification, type MailClassificationGateInput } from './guard'
// The BullMQ worker (§4)
export {
  type MailClassificationJobData,
  type MailClassificationJobResult,
  mailClassificationJob,
} from './job'
// Eligible-tag lookup (Q2/Q3)
export { getEligibleClassificationTags } from './labels'
// ⚠️ The mandatory second filter pass (§4.1, invariant 13)
export { rerunMailFiltersAfterClassification } from './rerun-filters'
// Retroactive re-classification, phase 1 (07-mail-reclassification-plan.md §4).
// ⚠️ This path deliberately does NOT re-run mail filters (07 R2 / invariant 3).
export {
  buildReclassifyWhere,
  cancelMailReclassifyRun,
  cancelMailReclassifySample,
  countReclassifiableThreads,
  type EnqueueMailReclassifySampleResult,
  enqueueMailReclassifyApply,
  enqueueMailReclassifySample,
  findPendingClassificationPrompt,
  getMailReclassifyRunStatus,
  getMailReclassifySampleStatus,
  MAIL_RECLASSIFY_THREAD_DELAY_MS,
  type MailReclassifyApplyJobData,
  type MailReclassifyCount,
  type MailReclassifySampleJobData,
  mailReclassifyApplyJob,
  mailReclassifyApplyJobId,
  mailReclassifySampleJob,
  mailReclassifySampleJobId,
  type PendingClassificationPrompt,
  type ReclassifyCursor,
  type ReclassifyScopeSqlInput,
  type ReclassifyThreadRow,
  type ResolvedReclassifyWindow,
  type RunMailReclassifyApplyInput,
  type RunMailReclassifySampleInput,
  resolveReclassifyWindow,
  runMailReclassifyApply,
  runMailReclassifySample,
  selectReclassifyThreadPage,
  undoMailReclassifyRun,
} from './retroactive'
// Server-side shapes
export type {
  MailClassificationContext,
  MailClassificationGate,
  MailClassificationMessage,
  MailClassificationResult,
} from './types'
