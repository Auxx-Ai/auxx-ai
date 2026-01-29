// packages/lib/src/tags/index.ts

// TagService - CRUD operations for tags using UnifiedCrudHandler
export {
  TagService,
  type TagData,
  type TagWithChildren,
  type CreateTagInput,
  type UpdateTagInput,
} from './tag-service'

// Re-export RecordId utilities for convenience
// export { type RecordId, toRecordId, parseRecordId } from '../resources/resource-id'

// UniversalTagService - for syncing tags with external providers (Gmail/Outlook labels)
export { UniversalTagService } from './universal-tag-service'
