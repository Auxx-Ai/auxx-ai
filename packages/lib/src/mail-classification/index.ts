// packages/lib/src/mail-classification/index.ts
// Mail-classification domain barrel (plans/mail-filter/05-mail-classification-plan.md).
// Explicit named exports only — see CLAUDE.md's "Module Exports" convention.

// Write path (§3.3, C9)
export { applyClassificationTag, markMessageClassified } from './apply'
// The one model call (§3.2)
export {
  buildClassificationPrompt,
  buildClassificationSchema,
  classifyMessage,
  renderLabels,
} from './classify'
// Client-safe constants + types (also importable as `@auxx/lib/mail-classification/client`)
export {
  MAIL_CLASSIFICATION_INBOX_IDS_SETTING,
  MAIL_CLASSIFICATION_JOB_NAME,
  MAIL_CLASSIFICATION_METADATA_KEY,
  MAIL_CLASSIFY_BODY_CHARS,
  MAIL_CLASSIFY_CONFIDENCE_THRESHOLD,
  MAIL_CLASSIFY_NO_CATEGORY,
  type MailClassificationLabel,
  type MailClassificationMarker,
  type MailClassificationSkipReason,
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
// Server-side shapes
export type {
  MailClassificationContext,
  MailClassificationGate,
  MailClassificationMessage,
  MailClassificationResult,
} from './types'
