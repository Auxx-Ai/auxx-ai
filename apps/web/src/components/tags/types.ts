// apps/web/src/components/tags/types.ts

import type { RecordId } from '@auxx/lib/resources/client'
import type { FieldInfo, RecordMeta } from '~/components/resources'

/**
 * Tag record with field values from the entity system
 * Note: Keys match systemAttribute names (e.g., tag_parent, is_system_tag)
 */
export interface TagRecord extends RecordMeta {
  fieldValues: {
    title?: string
    tag_description?: string
    tag_emoji?: string
    tag_color?: string
    tag_parent?: RecordId[]
    is_system_tag?: boolean
  }
}

/**
 * Tag node in the hierarchy tree
 */
export interface TagNode {
  id: string
  recordId: RecordId
  title: string
  tag_description: string | null
  tag_emoji: string | null
  tag_color: string
  parentId: string | null
  isSystemTag: boolean
  children: TagNode[]
}

/**
 * Result from useTagHierarchy hook
 */
export interface UseTagHierarchyResult {
  /** Hierarchical tree of tags (root tags with nested children) */
  hierarchy: TagNode[]
  /** Flat list of all tags */
  flatTags: TagNode[]
  /** Map of tag ID to TagNode for quick lookups */
  tagMap: Map<string, TagNode>
  /** Map of field key to field info (for resolving fieldIds when saving) */
  fields: Record<string, FieldInfo>
  /** Loading state */
  isLoading: boolean
  /** Error if any */
  error: Error | null
  /** Refetch tags */
  refresh: () => void
  /** Resolved entityDefinitionId for 'tag' */
  entityDefinitionId: string | null
}
