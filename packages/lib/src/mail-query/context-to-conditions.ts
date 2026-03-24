// packages/lib/src/mail-query/context-to-conditions.ts

import type { Condition, ConditionGroup } from '../conditions/types'
import { SEARCH_SCOPE_FIELD_ID } from '../mail-views/mail-view-field-definitions'

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
          id: 'ctx-assignee',
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
          id: 'ctx-inbox',
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
          id: 'ctx-tag',
          fieldId: 'tag',
          operator: 'in',
          value: [params.contextId],
        })
      }
      break

    case 'drafts':
      // Drafts context filters for threads with drafts
      conditions.push({
        id: 'ctx-hasDraft',
        fieldId: 'hasDraft',
        operator: 'is',
        value: true,
      })
      break

    case 'sent':
      // Sent context filters for threads with outbound messages
      conditions.push({
        id: 'ctx-sent',
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
          id: 'ctx-status',
          fieldId: 'status',
          operator: 'is',
          value: 'OPEN',
        })
        break

      case 'done':
      case 'resolved':
      case 'archived':
        conditions.push({
          id: 'ctx-status',
          fieldId: 'status',
          operator: 'is',
          value: 'ARCHIVED',
        })
        break

      case 'trash':
      case 'trashed':
        conditions.push({
          id: 'ctx-status',
          fieldId: 'status',
          operator: 'is',
          value: 'TRASH',
        })
        break

      case 'spam':
        conditions.push({
          id: 'ctx-status',
          fieldId: 'status',
          operator: 'is',
          value: 'SPAM',
        })
        break

      case 'assigned':
        // Assigned = has assignee + OPEN status
        conditions.push({
          id: 'ctx-assignee-filter',
          fieldId: 'assignee',
          operator: 'not empty',
          value: null,
        })
        conditions.push({
          id: 'ctx-status',
          fieldId: 'status',
          operator: 'is',
          value: 'OPEN',
        })
        break

      case 'unassigned':
        // Unassigned = no assignee + OPEN status
        conditions.push({
          id: 'ctx-assignee-filter',
          fieldId: 'assignee',
          operator: 'empty',
          value: null,
        })
        conditions.push({
          id: 'ctx-status',
          fieldId: 'status',
          operator: 'is',
          value: 'OPEN',
        })
        break

      default:
        // Unknown slug - pass through as status value
        conditions.push({
          id: 'ctx-status',
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
      id: 'ctx-status-exclude',
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
 * Scope handling:
 * - "This mailbox" (default): Keep context conditions, AND search conditions on top.
 *   If a search condition uses the same fieldId as a context condition, the search
 *   condition replaces the context condition to prevent conflicts.
 * - "Everywhere": Drop all context conditions, only apply search conditions +
 *   default TRASH/SPAM exclusion.
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

  // Extract scope from search conditions
  // Views always use 'current' scope — their saved filters ARE the scope
  const scopeCondition = searchConditions?.find((c) => c.fieldId === SEARCH_SCOPE_FIELD_ID)
  const isViewContext = contextParams.contextType === 'view'
  const searchScope =
    !isViewContext && scopeCondition?.operator === 'everywhere' ? 'everywhere' : 'current'

  // Filter out the scope condition — it's not a real query condition
  const realSearchConditions = searchConditions?.filter((c) => c.fieldId !== SEARCH_SCOPE_FIELD_ID)

  if (searchScope === 'everywhere') {
    // Only add default TRASH/SPAM exclusion
    groups.push({
      id: 'context',
      logicalOperator: 'AND',
      conditions: [
        {
          id: 'ctx-status-exclude',
          fieldId: 'status',
          operator: 'not in',
          value: ['TRASH', 'SPAM'],
        },
      ],
    })
  } else {
    // Build context group, but remove conditions whose fieldId
    // is overridden by a search condition
    const contextGroup = buildContextConditions(contextParams)
    if (realSearchConditions?.length) {
      const searchFieldIds = new Set(realSearchConditions.map((c) => c.fieldId))
      contextGroup.conditions = contextGroup.conditions.filter(
        (c) => !searchFieldIds.has(c.fieldId)
      )
    }
    if (contextGroup.conditions.length > 0) {
      groups.push(contextGroup)
    }
  }

  // Add real search conditions (excluding scope)
  if (realSearchConditions && realSearchConditions.length > 0) {
    const validConditions = realSearchConditions.filter(
      (c) =>
        (c.value !== undefined && c.value !== '' && c.value !== null) ||
        ['empty', 'not empty'].includes(c.operator)
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
