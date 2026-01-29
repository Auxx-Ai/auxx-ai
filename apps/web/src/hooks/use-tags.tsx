// apps/web/src/hooks/use-tags.tsx
// DEPRECATED: Import from '~/components/tags/hooks/use-tag-hierarchy' instead
'use client'

import { useTagHierarchy as useTagHierarchyNew } from '~/components/tags/hooks/use-tag-hierarchy'
import type { TagNode } from '~/components/tags/types'

/** @deprecated Use TagNode from '~/components/tags/types' instead */
interface Tag {
  id: string
  title: string
  emoji?: string | null
  color?: string | null
}

/**
 * @deprecated Use useTagHierarchy from '~/components/tags/hooks/use-tag-hierarchy' instead
 *
 * Hook to manage tag data and provide utilities for tag operations
 */
export function useTags() {
  const { flatTags, tagMap, isLoading, error, refresh } = useTagHierarchyNew()

  /** Get tag by ID from the tagMap */
  const getTagById = (id: string): TagNode | undefined => {
    return tagMap.get(id)
  }

  /** Get tag name by ID */
  const getTagNameById = (id: string): string => {
    const tag = getTagById(id)
    return tag ? tag.title : id
  }

  /** Get display name with emoji if present */
  const getTagDisplayName = (id: string): string => {
    const tag = getTagById(id)
    if (!tag) return id
    return tag.emoji ? `${tag.emoji} ${tag.title}` : tag.title
  }

  /** Get multiple tags by IDs */
  const getTagsByIds = (ids: string[]): TagNode[] => {
    return ids.map((id) => getTagById(id)).filter((t): t is TagNode => t !== undefined)
  }

  /** Find tag by name (case-insensitive) */
  const findTagByName = (name: string): TagNode | undefined => {
    if (!flatTags.length) return undefined
    return flatTags.find((tag) => tag.title.toLowerCase() === name.toLowerCase())
  }

  return {
    allTags: flatTags,
    tagMap,
    isLoading,
    error,
    getTagById,
    getTagNameById,
    getTagDisplayName,
    getTagsByIds,
    findTagByName,
    refresh,
  }
}

export type { Tag }
