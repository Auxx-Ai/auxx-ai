// apps/web/src/components/tags/hooks/use-tag-hierarchy.ts

import { type RecordId, toRecordId } from '@auxx/lib/resources/client'
import { useMemo } from 'react'
import { useAllRecords } from '~/components/resources/hooks/use-all-records'
import type { TagNode, TagRecord, UseTagHierarchyResult } from '../types'

/**
 * Hook to fetch all tags and build hierarchical tree structure.
 * Uses useAllRecords internally for data fetching.
 *
 * @example
 * ```tsx
 * import { useTagHierarchy } from '~/components/tags/hooks/use-tag-hierarchy'
 *
 * const { hierarchy, flatTags, tagMap, isLoading } = useTagHierarchy()
 *
 * // Render tree view
 * {hierarchy.map(tag => <TagTreeNode key={tag.id} tag={tag} />)}
 *
 * // Quick lookup
 * const tag = tagMap.get(tagId)
 * ```
 */
export function useTagHierarchy(): UseTagHierarchyResult {
  const { records, entityDefinitionId, fields, isLoading, error, refresh } =
    useAllRecords<TagRecord>({
      entityDefinitionId: 'tag',
    })

  // Build hierarchy from flat records
  const { hierarchy, flatTags, tagMap } = useMemo(() => {
    if (!records.length || !entityDefinitionId) {
      return { hierarchy: [], flatTags: [], tagMap: new Map() }
    }

    // Convert records to TagNode format
    const nodes: TagNode[] = records.map((record) => {
      // Extract parent ID from relationship field (RecordId[] format)
      const parentRecordIds = record.fieldValues.tag_parent ?? []
      const parentId =
        parentRecordIds.length > 0 ? (parentRecordIds[0].split(':')[1] ?? null) : null

      return {
        id: record.id,
        recordId: toRecordId(entityDefinitionId, record.id),
        title: record.fieldValues.title ?? record.displayName ?? 'Untitled',
        tag_description: record.fieldValues.tag_description ?? null,
        tag_emoji: record.fieldValues.tag_emoji ?? null,
        tag_color: record.fieldValues.tag_color ?? '#94a3b8',
        parentId,
        isSystemTag: record.fieldValues.is_system_tag ?? false,
        children: [],
      }
    })

    // Build lookup map
    const nodeMap = new Map<string, TagNode>(nodes.map((n) => [n.id, n]))

    // Build tree structure
    const rootNodes: TagNode[] = []

    for (const node of nodes) {
      if (node.parentId && nodeMap.has(node.parentId)) {
        // Add to parent's children
        nodeMap.get(node.parentId)!.children.push(node)
      } else {
        // Root level tag
        rootNodes.push(node)
      }
    }

    // Sort children alphabetically
    const sortChildren = (nodes: TagNode[]) => {
      nodes.sort((a, b) => a.title.localeCompare(b.title))
      for (const node of nodes) {
        sortChildren(node.children)
      }
    }
    sortChildren(rootNodes)

    return {
      hierarchy: rootNodes,
      flatTags: nodes,
      tagMap: nodeMap,
    }
  }, [records, entityDefinitionId])

  return {
    hierarchy,
    flatTags,
    tagMap,
    fields,
    isLoading,
    error,
    entityDefinitionId,
    refresh,
  }
}
