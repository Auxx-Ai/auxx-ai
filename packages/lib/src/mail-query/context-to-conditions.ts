// packages/lib/src/mail-query/context-to-conditions.ts

import { nanoid } from 'nanoid'
import type { Condition, ConditionGroup } from '../conditions/types'

/**
 * Parameters for building context conditions.
 */
export interface ContextConditionParams {
  contextType: string
  contextId?: string
  statusSlug?: string
  userId?: string
}

/**
 * Build a ConditionGroup from URL context parameters.
 *
 * This converts the legacy context-based filtering (contextType, contextId, statusSlug)
 * into the unified condition format used by condition-query-builder.
 *
 * @param params - Context parameters from URL routing
 * @returns A ConditionGroup representing the context filter
 *
 * @example
 * ```typescript
 * // Personal inbox with assigned status
 * buildContextConditions({
 *   contextType: 'personal_inbox',
 *   statusSlug: 'assigned',
 *   userId: 'user-123'
 * })
 * // Returns: { conditions: [
 * //   { fieldId: 'assignee', operator: 'is', value: 'user-123' },
 * //   { fieldId: 'status', operator: 'is', value: 'assigned' }
 * // ]}
 * ```
 */
export function buildContextConditions(params: ContextConditionParams): ConditionGroup {
  const conditions: Condition[] = []

  // Context type conditions
  switch (params.contextType) {
    case 'personal_inbox':
    case 'personal_assigned':
      // Personal contexts filter by assignee = current user
      if (params.userId) {
        conditions.push({
          id: nanoid(8),
          fieldId: 'assignee',
          operator: 'is',
          value: params.userId,
        })
      }
      break

    case 'specific_inbox':
      // Specific inbox filters by inbox ID
      if (params.contextId) {
        conditions.push({
          id: nanoid(8),
          fieldId: 'inbox',
          operator: 'is',
          value: params.contextId,
        })
      }
      break

    case 'tag':
      // Tag context filters by tag ID
      if (params.contextId) {
        conditions.push({
          id: nanoid(8),
          fieldId: 'tag',
          operator: 'in',
          value: [params.contextId],
        })
      }
      break

    case 'drafts':
      // Drafts context filters for threads with drafts
      conditions.push({
        id: nanoid(8),
        fieldId: 'hasDraft',
        operator: 'is',
        value: true,
      })
      break

    case 'sent':
      // Sent context filters for threads with outbound messages
      conditions.push({
        id: nanoid(8),
        fieldId: 'sent',
        operator: 'is',
        value: true,
      })
      break

    // all_inboxes, all, view - no additional context conditions needed
  }

  // Status slug conditions - map slugs to actual status values and additional conditions
  if (params.statusSlug && !['all', 'drafts', 'sent'].includes(params.statusSlug)) {
    switch (params.statusSlug.toLowerCase()) {
      case 'open':
        conditions.push({
          id: nanoid(8),
          fieldId: 'status',
          operator: 'is',
          value: 'OPEN',
        })
        break

      case 'done':
      case 'resolved':
      case 'archived':
        conditions.push({
          id: nanoid(8),
          fieldId: 'status',
          operator: 'is',
          value: 'ARCHIVED',
        })
        break

      case 'trash':
      case 'trashed':
        conditions.push({
          id: nanoid(8),
          fieldId: 'status',
          operator: 'is',
          value: 'TRASH',
        })
        break

      case 'spam':
        conditions.push({
          id: nanoid(8),
          fieldId: 'status',
          operator: 'is',
          value: 'SPAM',
        })
        break

      case 'assigned':
        // Assigned = has assignee + OPEN status
        conditions.push({
          id: nanoid(8),
          fieldId: 'assignee',
          operator: 'not empty',
          value: null,
        })
        conditions.push({
          id: nanoid(8),
          fieldId: 'status',
          operator: 'is',
          value: 'OPEN',
        })
        break

      case 'unassigned':
        // Unassigned = no assignee + OPEN status
        conditions.push({
          id: nanoid(8),
          fieldId: 'assignee',
          operator: 'empty',
          value: null,
        })
        conditions.push({
          id: nanoid(8),
          fieldId: 'status',
          operator: 'is',
          value: 'OPEN',
        })
        break

      default:
        // Unknown slug - pass through as status value
        conditions.push({
          id: nanoid(8),
          fieldId: 'status',
          operator: 'is',
          value: params.statusSlug,
        })
    }
  }

  // Default: exclude trash and spam unless explicitly viewing them
  const slug = params.statusSlug?.toLowerCase()
  if (!slug || !['trash', 'trashed', 'spam'].includes(slug)) {
    conditions.push({
      id: nanoid(8),
      fieldId: 'status',
      operator: 'not in',
      value: ['TRASH', 'SPAM'],
    })
  }

  return {
    id: 'context',
    logicalOperator: 'AND',
    conditions,
  }
}

/**
 * Build condition groups from context + search conditions.
 *
 * Combines context conditions (from URL routing) with search conditions (from searchbar)
 * into a single array of ConditionGroups for the API.
 *
 * @param contextParams - Context parameters from URL
 * @param searchConditions - Search conditions from the search store
 * @returns Array of ConditionGroups to send to the API
 */
export function buildConditionGroups(
  contextParams: ContextConditionParams,
  searchConditions?: { id: string; fieldId: string; operator: string; value: any }[]
): ConditionGroup[] {
  const groups: ConditionGroup[] = []

  // 1. Add context condition group
  const contextGroup = buildContextConditions(contextParams)
  if (contextGroup.conditions.length > 0) {
    groups.push(contextGroup)
  }

  // 2. Add search conditions as a separate group
  if (searchConditions && searchConditions.length > 0) {
    // Filter out empty conditions
    const validConditions = searchConditions.filter(
      (c) => c.value !== undefined && c.value !== '' && c.value !== null
    )

    if (validConditions.length > 0) {
      groups.push({
        id: 'search',
        logicalOperator: 'AND',
        conditions: validConditions.map((c) => ({
          id: c.id,
          fieldId: c.fieldId,
          operator: c.operator,
          value: c.value,
        })),
      })
    }
  }

  return groups
}
