// apps/web/src/components/workflow/nodes/core/crud/output-variables.ts

import type { UnifiedVariable } from '~/components/workflow/types/variable-types'
import { BaseType } from '~/components/workflow/types/unified-types'
import type { CrudNodeData } from './types'
import { generateCrudNodeVariablesFromFields } from '@auxx/lib/workflow-engine/client'
import type { ResourceField } from '@auxx/lib/resources/client'

/** Resource shape for variable generation */
type ResourceWithFields = { id: string; label: string; plural: string; fields: ResourceField[] }

/**
 * Generate thread-specific output variables for action results
 * Thread operations return action result flags instead of standard CRUD output
 */
function generateThreadActionVariables(nodeId: string): UnifiedVariable[] {
  return [
    // Core identifiers
    {
      id: `${nodeId}.id`,
      label: 'Thread ID',
      type: BaseType.STRING,
      category: 'node',
      description: 'ID of the thread that was updated',
    },
    {
      id: `${nodeId}.success`,
      label: 'Success',
      type: BaseType.BOOLEAN,
      category: 'node',
      description: 'Whether all actions completed successfully',
    },

    // Action result flags
    {
      id: `${nodeId}.statusUpdated`,
      label: 'Status Updated',
      type: BaseType.BOOLEAN,
      category: 'node',
      description: 'Whether the status was changed',
    },
    {
      id: `${nodeId}.subjectUpdated`,
      label: 'Subject Updated',
      type: BaseType.BOOLEAN,
      category: 'node',
      description: 'Whether the subject was renamed',
    },
    {
      id: `${nodeId}.assigneeUpdated`,
      label: 'Assignee Updated',
      type: BaseType.BOOLEAN,
      category: 'node',
      description: 'Whether the assignee was changed',
    },
    {
      id: `${nodeId}.readStatusUpdated`,
      label: 'Read Status Updated',
      type: BaseType.BOOLEAN,
      category: 'node',
      description: 'Whether the read status was changed',
    },
    {
      id: `${nodeId}.tagsUpdated`,
      label: 'Tags Updated',
      type: BaseType.BOOLEAN,
      category: 'node',
      description: 'Whether tags were modified',
    },
    {
      id: `${nodeId}.inboxUpdated`,
      label: 'Inbox Updated',
      type: BaseType.BOOLEAN,
      category: 'node',
      description: 'Whether the thread was moved to a different inbox',
    },

    // New values (for chaining)
    {
      id: `${nodeId}.newStatus`,
      label: 'New Status',
      type: BaseType.STRING,
      category: 'node',
      description: 'The new status value (if changed)',
    },
    {
      id: `${nodeId}.newSubject`,
      label: 'New Subject',
      type: BaseType.STRING,
      category: 'node',
      description: 'The new subject value (if renamed)',
    },
    {
      id: `${nodeId}.newAssigneeId`,
      label: 'New Assignee ID',
      type: BaseType.STRING,
      category: 'node',
      description: 'The new assignee ID (null if unassigned)',
    },
    {
      id: `${nodeId}.newReadStatus`,
      label: 'New Read Status',
      type: BaseType.STRING,
      category: 'node',
      description: 'The new read status (READ or UNREAD)',
    },
    {
      id: `${nodeId}.newInboxId`,
      label: 'New Inbox ID',
      type: BaseType.STRING,
      category: 'node',
      description: 'The new inbox ID (if moved)',
    },

    // Summary
    {
      id: `${nodeId}.actionCount`,
      label: 'Action Count',
      type: BaseType.NUMBER,
      category: 'node',
      description: 'Number of actions that were performed',
    },
    {
      id: `${nodeId}.actionsPerformed`,
      label: 'Actions Performed',
      type: BaseType.ARRAY,
      category: 'node',
      description: 'List of action descriptions that were performed',
    },
    {
      id: `${nodeId}.errors`,
      label: 'Errors',
      type: BaseType.ARRAY,
      category: 'node',
      description: 'List of any errors that occurred',
    },
  ]
}

/**
 * Generate output variables for CRUD node based on current configuration
 * Unified function for both system resources and custom entities
 *
 * @param nodeData - CRUD node data
 * @param nodeId - Node ID
 * @param resource - Current resource with fields
 * @param allResources - All available resources (for relationship drilling)
 */
export function getCrudNodeOutputVariables(
  nodeData: CrudNodeData,
  nodeId: string,
  resource?: ResourceWithFields,
  allResources?: ResourceWithFields[]
): UnifiedVariable[] {
  // Thread resources have action-based output variables
  if (nodeData.resourceType === 'thread') {
    const variables = generateThreadActionVariables(nodeId)

    // Add strategy-specific variables if needed
    if (nodeData.error_strategy === 'default') {
      variables.push(
        {
          id: `${nodeId}.usedDefaults`,
          label: 'Used Defaults',
          type: BaseType.BOOLEAN,
          category: 'node',
          description: 'Whether default values were used due to operation failure',
        },
        {
          id: `${nodeId}.defaultValues`,
          label: 'Default Values',
          type: BaseType.OBJECT,
          category: 'node',
          description: 'The default values used when the operation failed',
        }
      )
    }

    return variables
  }

  // No resource selected yet
  if (!resource) {
    return []
  }

  // Build resources map for relationship lookup
  const resourcesMap = new Map(allResources?.map((r) => [r.id, r]) ?? [])

  const baseVariables = generateCrudNodeVariablesFromFields(
    resource.fields,
    { id: resource.id, label: resource.label, plural: resource.plural },
    nodeId,
    nodeData.mode,
    { resourcesMap, maxDepth: 2 }
  )

  // Add strategy-specific variables if needed
  if (nodeData.error_strategy === 'default') {
    baseVariables.push(
      {
        id: `${nodeId}.usedDefaults`,
        label: 'Used Defaults',
        type: BaseType.BOOLEAN,
        category: 'node',
        description: 'Whether default values were used due to operation failure',
      },
      {
        id: `${nodeId}.defaultValues`,
        label: 'Default Values',
        type: BaseType.OBJECT,
        category: 'node',
        description: 'The default values used when the operation failed',
      }
    )
  }

  return baseVariables
}
