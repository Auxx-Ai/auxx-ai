// packages/lib/src/participants/index.ts

export { type ClassifyIsInternalInput, classifyIsInternal } from './classify-internal'
// Re-export client-safe types
export type { ParticipantIdentifierType, ParticipantMeta } from './client'
export {
  type ContactIdentifier,
  type ListContactIdentifiersParams,
  listContactIdentifiers,
  mergeIdentifiers,
} from './list-contact-identifiers'
export { type EnsureContactResult, ensureContactForParticipant } from './participant-queries'
export { type FindOrCreateParticipantInput, ParticipantService } from './participant-service'
