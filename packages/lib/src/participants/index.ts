// packages/lib/src/participants/index.ts

export { ParticipantService, type FindOrCreateParticipantInput } from './participant-service'

// Re-export client-safe types
export type { ParticipantMeta, ParticipantIdentifierType } from './client'
