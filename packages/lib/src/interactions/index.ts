// packages/lib/src/interactions/index.ts

export type { AdoptionResult } from './adopt'
export { adoptParticipants, backfillThreadParticipants } from './adopt'
export { attachContactsToCompanies } from './employer-attach'
export {
  resolveInteractionsOnCompanyDomainChange,
  resolveInteractionsOnIdentifierChange,
} from './hooks'
export type { IdentifierRow, RecordIdentifier } from './identifiers'
export { contactIdentifiers, emailIdentifiers, toRecordIdentifiers } from './identifiers'
export {
  employerCompanyIds,
  recomputeCompanyStamps,
  recomputeContactStamps,
} from './recompute'
export type {
  ResolveInteractionsInput,
  ResolveInteractionsSummary,
  ResolveReason,
} from './resolve'
export { RECORDS_PER_BATCH, resolveInteractions } from './resolve'
export type {
  InteractionCandidate,
  InteractionSweepOptions,
  InteractionSweepSummary,
} from './sweep'
export {
  findRecordsNeedingInteractionResolution,
  SWEEP_WINDOW_MS,
  sweepInteractionResolution,
} from './sweep'
