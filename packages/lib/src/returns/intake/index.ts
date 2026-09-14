// packages/lib/src/returns/intake/index.ts

/**
 * Return intake: photographed return labels in, drafted returns out.
 *
 * Server entrypoint. Client code imports `@auxx/lib/returns/intake/client`,
 * never this barrel — the barrel reaches the LLM orchestrator, the storage layer
 * and Redis.
 */

export type {
  ReturnIntakeCandidate,
  ReturnIntakeCommitInput,
  ReturnIntakeCommitResult,
  ReturnIntakeDraftPayload,
  ReturnIntakeDraftPhase,
  ReturnIntakeDraftStatus,
  ReturnIntakeDraftView,
  ReturnIntakeGroup,
  ReturnIntakeGroupView,
  ReturnIntakeLabel,
  ReturnIntakeOrderOption,
  ReturnIntakeTier,
  TranscribedLabel,
} from './client'
export {
  EMPTY_TRANSCRIBED_LABEL,
  formatSenderAddress,
  RETURN_INTAKE_DRAFT_STATUSES,
  RETURN_INTAKE_MAX_LABELS,
  RETURN_INTAKE_PHASE_LABELS,
  RETURN_INTAKE_PHASES,
  RETURN_INTAKE_TIER_LABELS,
  RETURN_INTAKE_TIER_RANK,
  RETURN_INTAKE_TIERS,
  RETURN_LABEL_EXTENSIONS,
} from './client'
export { commitReturnIntakeDraft } from './commit'
export {
  bestTierOf,
  type CreateReturnIntakeDraftInput,
  confirmReturnIntakeLabel,
  createReturnIntakeDraft,
  discardReturnIntakeDraft,
  failReturnIntakeDraft,
  markReturnIntakeDraftReady,
  patchReturnIntakeLabelTranscription,
  type ReturnIntakeDraftLabelInput,
  type ReturnIntakeTranscriptionPatch,
  recordReturnIntakeCommit,
  recordReturnIntakeLabelCandidates,
  recordReturnIntakeLabelRead,
  setReturnIntakeDraftPhase,
  setReturnIntakeOrderOptions,
} from './draft-mutations'
export {
  getReturnIntakeDraft,
  RETURN_INTAKE_DRAFT_TTL_SECONDS,
  readStoredReturnIntakeDraft,
  returnIntakeDraftKey,
  type StoredReturnIntakeDraft,
  toReturnIntakeDraftView,
} from './draft-queries'
export { groupLabels } from './group'
export { guard } from './guard'
export {
  looksLikeOutboundLabel,
  readOrderOptionsForContact,
  resolveLabelCandidates,
} from './resolve'
export {
  parseTranscribedLabel,
  TRANSCRIBE_LABEL_PROMPT,
  TRANSCRIBED_LABEL_JSON_SCHEMA,
} from './schema'
export {
  checkReturnIntakeModelCapability,
  type ReturnIntakeModelCapability,
  transcribeLabel,
} from './transcribe'
