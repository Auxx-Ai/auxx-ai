// packages/lib/src/drafts/index.ts

// Re-export types from @auxx/types for convenience
export {
  type CreateDraftInput,
  DEFAULT_DRAFT_CONTENT,
  type Draft,
  type DraftAttachment,
  type DraftContent,
  type DraftParticipant,
  type UpdateDraftInput,
  type UpsertDraftInput,
} from '@auxx/types/draft'
export { DraftService } from './draft-service'
