// packages/lib/src/drafts/index.ts

export { DraftService } from './draft-service'

// Re-export types from @auxx/types for convenience
export {
  type DraftParticipant,
  type DraftAttachment,
  type DraftContent,
  type Draft,
  type CreateDraftInput,
  type UpdateDraftInput,
  type UpsertDraftInput,
  DEFAULT_DRAFT_CONTENT,
} from '@auxx/types/draft'
