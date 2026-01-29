// apps/web/src/components/tags/types.ts

import type { RecordMeta } from '~/components/resources'
import type { RecordId } from '@auxx/lib/resources/client'

/**
 * Tag record with field values from the entity system
 */
export interface TagRecord extends RecordMeta {
  fieldValues: {
    title?: string
    description?: string
    emoji?: string
    color?: string
    parent?: RecordId[]
    isSystemTag?: boolean
  }
}

/**
 * Tag node in the hierarchy tree
 */
export interface TagNode {
  id: string
  recordId: RecordId
  title: string
  description: string | null
  emoji: string | null
  color: string
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
  /** Loading state */
  isLoading: boolean
  /** Error if any */
  error: Error | null
  /** Refetch tags */
  refresh: () => void
  /** Resolved entityDefinitionId for 'tag' */
  entityDefinitionId: string | null
}
