// src/hooks/use-tags.tsx
'use client'

import { useMemo } from 'react'
import { api } from '~/trpc/react'

interface Tag {
  id: string
  title: string
  emoji?: string | null
  color?: string | null
}

/**
 * Hook to manage tag data and provide utilities for tag operations
 */
export function useTags() {
  // Fetch all tags
  const {
    data: allTags,
    isLoading,
    error,
  } = api.tag.getAll.useQuery(undefined, {
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  })

  // Create a map for quick ID to tag lookup
  const tagMap = useMemo(() => {
    if (!allTags) return new Map<string, Tag>()

    const map = new Map<string, Tag>()
    allTags.forEach((tag) => {
      map.set(tag.id, tag)
    })
    return map
  }, [allTags])

  // Utility functions
  const getTagById = (id: string): Tag | undefined => {
    return tagMap.get(id)
  }

  const getTagNameById = (id: string): string => {
    const tag = getTagById(id)
    return tag ? tag.title : id // Fallback to ID if tag not found
  }

  const getTagDisplayName = (id: string): string => {
    const tag = getTagById(id)
    if (!tag) return id

    return tag.emoji ? `${tag.emoji} ${tag.title}` : tag.title
  }

  const getTagsByIds = (ids: string[]): Tag[] => {
    return ids.map((id) => getTagById(id)).filter(Boolean) as Tag[]
  }

  const findTagByName = (name: string): Tag | undefined => {
    if (!allTags) return undefined

    return allTags.find((tag) => tag.title.toLowerCase() === name.toLowerCase())
  }

  return {
    allTags: allTags || [],
    tagMap,
    isLoading,
    error,
    getTagById,
    getTagNameById,
    getTagDisplayName,
    getTagsByIds,
    findTagByName,
  }
}

export type { Tag }
