// apps/web/src/components/tags/types.ts

import type { RecordId } from '@auxx/lib/resources/client'
import type { FieldInfo, RecordMeta } from '~/components/resources'

/** Resource-type scope a tag is meant for. Filters the picker pool. */
export type TagScopeValue = 'thread' | 'article'

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
    /** Opt-in: the mail classifier may apply this tag to inbound mail. */
    tag_ai_classify?: boolean
    /**
     * Shipped identity of a seeded mail category (`category:sales`, …). Absent
     * for every user-created tag. Provenance marker, not a lock.
     */
    tag_template_key?: string
    /** SINGLE_SELECT comes back as an array per the resource read pipeline. */
    tag_scope?: string | string[]
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
  /**
   * Opt-in flag for the mail classifier (`tag_ai_classify`). When true this tag
   * is offered to the model as a label, and `tag_description` is read as the
   * label's definition rather than as decorative copy.
   */
  aiClassify: boolean
  /**
   * `tag_template_key` — the shipped identity of a seeded mail category, null
   * for a user-created tag (plan 06 §3.1).
   *
   * ⚠️ A PROVENANCE MARKER, not a lock, and deliberately not folded into
   * {@link TagNode.isSystemTag}: a seeded category stays fully editable
   * (D4 vs D5). All it buys the UI is a default to reset back to and the fact
   * that the delete hook will refuse.
   */
  templateKey: string | null
  /**
   * `EntityInstance.archivedAt !== null` — the tag is retired but every record
   * that carries it keeps it.
   *
   * ⚠️ Archive is the DEFAULT retirement path for a tag in use, not a lesser
   * delete. `mail-classification/labels.ts:92` already filters archived tags out
   * of the classifier's label set, so archiving stops a tag being applied to new
   * mail while leaving the historical claim on the threads that have it — which
   * is what `rejectDeleteIfTagInUse` points callers at when it refuses a delete.
   */
  isArchived: boolean
  scope: TagScopeValue
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
