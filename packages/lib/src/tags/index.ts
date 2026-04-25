// packages/lib/src/tags/index.ts

// TagService - read-only tag queries built on UnifiedCrudHandler
export { type TagData, TagService, type TagWithChildren } from './tag-service'

// Re-export RecordId utilities for convenience
// export { type RecordId, toRecordId, parseRecordId } from '../resources/resource-id'

// UniversalTagService - for syncing tags with external providers (Gmail/Outlook labels)
export { UniversalTagService } from './universal-tag-service'
