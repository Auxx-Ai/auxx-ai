// apps/web/src/components/workflow/utils/unique-title-generator.ts

import { incrementTitle } from '@auxx/utils'
import type { FlowNode } from '../store/types'

/**
 * Generates a unique title for a node by appending a number if needed
 * @param baseTitle The base title from node schema (e.g., "IF/ELSE" or "AI 1")
 * @param existingNodes All nodes in the workflow
 * @param excludeNodeId Optional node ID to exclude (for editing existing node)
 * @returns Unique title (e.g., "IF/ELSE 3")
 */
export function generateUniqueTitle(
  baseTitle: string,
  existingNodes: FlowNode[],
  excludeNodeId?: string
): string {
  // Get all existing titles except the one being edited
  const existingTitles = new Set(
    existingNodes
      .filter((node) => node.id !== excludeNodeId)
      .map((node) => node.data.title || '')
      .filter((title) => title.trim())
  )

  return incrementTitle(baseTitle, existingTitles)
}

/**
 * Checks if a title is unique among nodes
 * @param title Title to check
 * @param existingNodes All nodes in the workflow
 * @param excludeNodeId Optional node ID to exclude
 * @returns true if title is unique
 */
export function isTitleUnique(
  title: string,
  existingNodes: FlowNode[],
  excludeNodeId?: string
): boolean {
  return !existingNodes.some((node) => node.id !== excludeNodeId && node.data.title === title)
}
