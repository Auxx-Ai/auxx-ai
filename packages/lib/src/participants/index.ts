// packages/lib/src/participants/index.ts

export { type ClassifyIsInternalInput, classifyIsInternal } from './classify-internal'
// Re-export client-safe types + helpers
export {
  type ParticipantIdentifierType,
  type ParticipantMeta,
  usableContactName,
} from './client'
export { calculateParticipantDisplayInfo } from './display-info'
export {
  type ContactIdentifier,
  type ListContactIdentifiersParams,
  listContactIdentifiers,
  mergeIdentifiers,
} from './list-contact-identifiers'
export { type EnsureContactResult, ensureContactForParticipant } from './participant-queries'
export { type FindOrCreateParticipantInput, ParticipantService } from './participant-service'
export {
  diffParticipantNamePatch,
  type ParticipantNameColumns,
  type ParticipantPublishContext,
  publishParticipantPatch,
} from './publish-participant-changes'
