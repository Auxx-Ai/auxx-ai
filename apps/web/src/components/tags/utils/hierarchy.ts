// apps/web/src/components/tags/utils/hierarchy.ts

import type { TagNode } from '../types'

/**
 * Flatten hierarchy into a single array for search results
 */
export function flattenHierarchy(nodes: TagNode[]): TagNode[] {
  const result: TagNode[] = []
  const traverse = (nodes: TagNode[]) => {
    for (const node of nodes) {
      result.push(node)
      traverse(node.children)
    }
  }
  traverse(nodes)
  return result
}

/**
 * Filter hierarchy by search query.
 * Returns matching tags and their ancestors to preserve tree structure.
 */
export function filterHierarchy(
  nodes: TagNode[],
  query: string
): { filtered: TagNode[]; matchingIds: Set<string> } {
  const normalizedQuery = query.toLowerCase().trim()
  if (!normalizedQuery) {
    return { filtered: nodes, matchingIds: new Set() }
  }

  const matchingIds = new Set<string>()

  /** Check if a tag matches the query */
  const checkMatch = (node: TagNode): boolean => {
    const titleMatch = node.title.toLowerCase().includes(normalizedQuery)
    const descMatch = node.description?.toLowerCase().includes(normalizedQuery)
    const emojiMatch = node.emoji?.includes(normalizedQuery)
    return titleMatch || !!descMatch || !!emojiMatch
  }

  /** Collect matching IDs and their ancestors */
  const collectMatches = (nodes: TagNode[], ancestors: string[] = []) => {
    for (const node of nodes) {
      if (checkMatch(node)) {
        matchingIds.add(node.id)
        // Add all ancestors
        for (const ancestorId of ancestors) {
          matchingIds.add(ancestorId)
        }
      }
      collectMatches(node.children, [...ancestors, node.id])
    }
  }
  collectMatches(nodes)

  /** Filter tree to only include matching nodes and ancestors */
  const filterNodes = (nodes: TagNode[]): TagNode[] => {
    return nodes
      .filter((node) => matchingIds.has(node.id))
      .map((node) => ({
        ...node,
        children: filterNodes(node.children),
      }))
  }

  return {
    filtered: filterNodes(nodes),
    matchingIds,
  }
}

/**
 * Get all descendant IDs for a given tag (for exclusion in parent selection)
 */
export function getDescendantIds(node: TagNode): Set<string> {
  const ids = new Set<string>()
  const collect = (n: TagNode) => {
    for (const child of n.children) {
      ids.add(child.id)
      collect(child)
    }
  }
  collect(node)
  return ids
}

/**
 * Find a tag by ID in the hierarchy
 */
export function findTagById(nodes: TagNode[], id: string): TagNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node
    const found = findTagById(node.children, id)
    if (found) return found
  }
  return undefined
}
