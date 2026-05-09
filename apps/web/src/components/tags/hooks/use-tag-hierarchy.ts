// apps/web/src/components/tags/hooks/use-tag-hierarchy.ts

import { toRecordId } from '@auxx/lib/resources/client'
import { useMemo } from 'react'
import { useAllRecords } from '~/components/resources/hooks/use-all-records'
import type { TagNode, TagRecord, TagScopeValue, UseTagHierarchyResult } from '../types'

/** Options for filtering / shaping the returned hierarchy. */
interface UseTagHierarchyOptions {
  /**
   * Optional resource-type scope filter. When provided, only tags with this
   * scope are returned. Tags without a scope value default to 'thread'.
   */
  scope?: TagScopeValue
}

/**
 * Hook to fetch all tags and build hierarchical tree structure.
 * Uses useAllRecords internally for data fetching.
 *
 * @example
 * ```tsx
 * const { hierarchy, flatTags, tagMap, isLoading } = useTagHierarchy({ scope: 'article' })
 * ```
 */
export function useTagHierarchy(options?: UseTagHierarchyOptions): UseTagHierarchyResult {
  const { records, entityDefinitionId, fields, isLoading, error, refresh } =
    useAllRecords<TagRecord>({
      entityDefinitionId: 'tag',
    })

  const scope = options?.scope

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

      // SINGLE_SELECT values come back as an array; treat undefined as 'thread'.
      const scopeRaw = record.fieldValues.tag_scope
      const scopeStr = Array.isArray(scopeRaw) ? scopeRaw[0] : scopeRaw
      const tagScope: TagScopeValue = scopeStr === 'article' ? 'article' : 'thread'

      return {
        id: record.id,
        recordId: toRecordId(entityDefinitionId, record.id),
        title: record.fieldValues.title ?? record.displayName ?? 'Untitled',
        tag_description: record.fieldValues.tag_description ?? null,
        tag_emoji: record.fieldValues.tag_emoji ?? null,
        tag_color: record.fieldValues.tag_color ?? 'gray',
        parentId,
        isSystemTag: record.fieldValues.is_system_tag ?? false,
        scope: tagScope,
        children: [],
      }
    })

    const filteredNodes = scope ? nodes.filter((n) => n.scope === scope) : nodes

    // Build lookup map (scoped — parents that are filtered out are dropped)
    const nodeMap = new Map<string, TagNode>(filteredNodes.map((n) => [n.id, n]))

    // Build tree structure
    const rootNodes: TagNode[] = []

    for (const node of filteredNodes) {
      if (node.parentId && nodeMap.has(node.parentId)) {
        // Add to parent's children
        nodeMap.get(node.parentId)!.children.push(node)
      } else {
        // Root level tag (parent missing from this scope or genuinely root)
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
      flatTags: filteredNodes,
      tagMap: nodeMap,
    }
  }, [records, entityDefinitionId, scope])

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
