// packages/lib/src/accounting/purchasing/intake/index.ts

/**
 * Purchase-order intake: a vendor's quote in, a proposed purchase order out.
 *
 * Server entrypoint. Client code imports `@auxx/lib/accounting/purchasing/intake/client`,
 * never this barrel — the barrel reaches the LLM orchestrator, the extractors and
 * the storage layer.
 */

export {
  commitIntakeDraft,
  type IntakeCommitResult,
  type WriteBackTally,
} from './commit'
export {
  type CreateIntakeDraftInput,
  createIntakeDraft,
  discardIntakeDraft,
  failIntakeDraft,
  markIntakeDraftCommitted,
  markIntakeDraftReady,
  setIntakeDraftExtractedText,
  setIntakeDraftPhase,
  updateIntakeDraftPayload,
} from './draft-mutations'
export {
  getIntakeDraft,
  INTAKE_DRAFT_TTL_SECONDS,
  intakeDraftKey,
  readStoredIntakeDraft,
  type StoredIntakeDraft,
  toIntakeDraftView,
} from './draft-queries'
export {
  type ResolveQuoteLinesInput,
  resolveQuoteLines,
  resolveQuoteVendor,
} from './resolve'
export {
  parseTranscribedQuote,
  TRANSCRIBE_QUOTE_PROMPT,
  TRANSCRIBED_QUOTE_JSON_SCHEMA,
} from './schema'
export {
  checkIntakeModelCapability,
  type IntakeModelCapability,
  type TranscribeDocumentOutput,
  type TranscribeQuoteInput,
  type TranscribeSpec,
  transcribeDocument,
  transcribeQuote,
} from './transcribe'
