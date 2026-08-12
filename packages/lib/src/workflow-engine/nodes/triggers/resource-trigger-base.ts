// packages/lib/src/workflow-engine/nodes/triggers/resource-trigger-base.ts

import { getCachedResourceFields, requireCachedEntityDefId } from '../../../cache'
import {
  evaluateConditionsWithDiagnostics,
  normalizeStatusConditions,
} from '../../../conditions/evaluate'
import { isKnownOperator } from '../../../conditions/evaluate-operator'
import type { Condition, ConditionGroup } from '../../../conditions/types'
// Generic record-snapshot resolver — the exact shape `fetchResourceById` produces,
// which is what lands in `context.triggerData`. Shared with the record-rule engine
// so a condition written against a field means the same thing in both.
import { makeSnapshotResolver, type RecordSnapshot } from '../../../record-rules/resolver'
import { RESOURCE_CONFIGS, RESOURCE_OPERATIONS } from '../../../resources/definitions'
import {
  isCustomResourceId,
  isEntityDefinitionType,
  setEntityVariables,
  setResourceVariables,
} from '../../../resources/registry'
import type { TableId } from '../../../resources/registry/field-registry'
import type { ExecutionContextManager } from '../../core/execution-context'
import type { NodeExecutionResult, ValidationResult, WorkflowNode } from '../../core/types'
import { NodeRunningStatus, type WorkflowNodeType } from '../../core/types'
import { BaseNodeProcessor } from '../base-node'

/**
 * Outcome of reading + evaluating a trigger's filter.
 *
 * `refused` is deliberately distinct from `no-match`: a filter that does not
 * compile as written has NOT decided anything, and treating it as "no match" or
 * as "no filter" are both wrong. It is reported as an error and the workflow
 * does not run.
 */
type TriggerFilterOutcome =
  | { decision: 'fire' }
  | { decision: 'no-match' }
  | { decision: 'refused'; reason: string; detail?: unknown }

/**
 * Read `node.data.filters` as condition groups.
 *
 * Returns `null` when the key is present but is not shaped like condition groups.
 * That is NOT the same as "no filter": a filter nobody can parse must fail closed,
 * because reducing it to the empty set silently promotes the trigger to
 * "fire on every record".
 */
function readTriggerFilters(raw: unknown): ConditionGroup[] | null {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) return null

  const groups: ConditionGroup[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
    const group = entry as Partial<ConditionGroup>
    if (!Array.isArray(group.conditions)) return null
    if (group.conditions.some((c) => !c || typeof c !== 'object' || typeof c.operator !== 'string'))
      return null
    groups.push(group as ConditionGroup)
  }
  return groups
}

/** True when at least one group carries at least one condition. */
function hasConditions(groups: ConditionGroup[]): boolean {
  return groups.some((g) => g.conditions.length > 0)
}

/**
 * Conditions the shared evaluator cannot honour here.
 *
 * A trigger fires BEFORE any node has run, so there is no upstream variable to
 * resolve — `isConstant: false` conditions carry a `{{…}}` reference the
 * evaluator would compare as a literal string. The panel cannot author one
 * (variable mode is off for trigger filters); a hand-authored or imported graph
 * can, and it must not be silently mis-evaluated.
 */
function findVariableModeConditions(groups: ConditionGroup[]): Condition[] {
  return groups.flatMap((g) => g.conditions.filter((c) => c.isConstant === false))
}

/**
 * Unified trigger node processor for all resource-based triggers
 * Handles resource triggers by extracting resourceType and operation from node.data
 */
export class ResourceTriggerBase extends BaseNodeProcessor {
  readonly type = 'resource-trigger' as WorkflowNodeType

  protected extractRequiredVariables(node: WorkflowNode): string[] {
    // Trigger nodes don't depend on upstream variables
    return []
  }

  protected async executeNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<Partial<NodeExecutionResult>> {
    // Extract resourceType and operation from node.data
    const resourceType = node.data.resourceType as string
    const operation = node.data.operation as string

    if (!resourceType || !operation) {
      throw new Error(
        `Resource trigger missing resourceType or operation in node.data. ` +
          `Got: resourceType="${resourceType}", operation="${operation}"`
      )
    }

    // Validate operation is valid (same for both system and custom resources)
    if (!RESOURCE_OPERATIONS[operation]) {
      throw new Error(`Invalid operation: "${operation}"`)
    }

    // Validate resource type - entity definition types and custom entities skip static config validation
    const isEntityDef = isEntityDefinitionType(resourceType)
    const isCustomEntity = isCustomResourceId(resourceType)
    if (!isEntityDef && !isCustomEntity && !RESOURCE_CONFIGS[resourceType as TableId]) {
      throw new Error(`Invalid resource type: "${resourceType}"`)
    }

    const context = contextManager.getContext()
    const organizationId = context.organizationId

    // Get trigger data from context (keyed by original resourceType, e.g. "contact")
    const triggerData = context.triggerData?.[resourceType]
    if (!triggerData) {
      throw new Error(
        `No trigger data for resource type: "${resourceType}". ` +
          `Expected context.triggerData to have key "${resourceType}"`
      )
    }

    // Trigger filters gate the whole run — evaluate BEFORE publishing any variables.
    // A `Skipped` status on a trigger stops the execution branch (workflow-engine.ts:506),
    // so this is the only thing standing between a filtered trigger and a full run.
    const filterOutcome = await this.evaluateTriggerFilters(
      node,
      resourceType,
      organizationId,
      triggerData
    )
    if (filterOutcome.decision !== 'fire') {
      const refused = filterOutcome.decision === 'refused'
      contextManager.log(
        refused ? 'ERROR' : 'INFO',
        node.name,
        refused
          ? `${resourceType} trigger filter did not evaluate as written — workflow not run`
          : `${resourceType} filtered out by trigger conditions`,
        refused ? { reason: filterOutcome.reason, detail: filterOutcome.detail } : undefined
      )
      return {
        status: NodeRunningStatus.Skipped,
        output: {
          filtered: true,
          reason: refused
            ? `Trigger filter did not evaluate as written: ${filterOutcome.reason}`
            : 'Did not pass trigger filters',
        },
      }
    }

    // Entity definition types (contact, ticket, etc.) store data in EntityInstance/FieldValue.
    // Resolve the entityType string to the actual entityDefinitionId UUID so variable paths
    // match frontend output-variables which use entityDefinitionId.
    // This is the same pattern used by the Find node (find.ts:508-512).
    let entityDefId = resourceType
    if (isEntityDef) {
      entityDefId = await requireCachedEntityDefId(organizationId, resourceType)
    }

    // Set workflow variables from the resource data
    const isCustom = isCustomResourceId(entityDefId)
    if (isCustom) {
      // Entity definition types + custom entities → setEntityVariables + lazy loading
      // Only store basic fields; field values resolve lazily via ResourceReference
      const entityData = {
        id: triggerData.id,
        entityDefinitionId: entityDefId,
        createdAt: triggerData.createdAt,
        updatedAt: triggerData.updatedAt,
      }
      setEntityVariables(entityDefId, entityData, contextManager, node.nodeId)
    } else {
      // Non-entity system resources (thread, message, etc.) → eager storage
      setResourceVariables(resourceType as TableId, triggerData, contextManager, node.nodeId)
    }

    // Set trigger metadata
    this.setTriggerMetadata(context, contextManager, node.nodeId, resourceType, operation)

    // Set organization context if available
    if (context.organizationId) {
      contextManager.setVariable('organizationId', context.organizationId)
    }

    return {
      output: {
        resourceType,
        operation,
        data: triggerData,
      },
    }
  }

  /**
   * Set trigger-specific metadata variables
   */
  private setTriggerMetadata(
    context: any,
    contextManager: ExecutionContextManager,
    nodeId: string,
    resourceType: string,
    operation: string
  ): void {
    // Always set timestamp
    contextManager.setNodeVariable(nodeId, 'trigger.timestamp', new Date().toISOString())
    contextManager.setNodeVariable(nodeId, 'trigger.operation', operation)

    // Set operation-specific metadata
    switch (operation) {
      case 'manual':
        // Manual trigger metadata - who triggered and what resource
        contextManager.setNodeVariable(nodeId, 'trigger.source', 'manual')
        contextManager.setNodeVariable(nodeId, 'trigger.resourceType', resourceType)
        if (context.triggerData?.createdBy) {
          contextManager.setNodeVariable(nodeId, 'trigger.createdBy', context.triggerData.createdBy)
        }
        if (context.triggerData?.[resourceType]?.id) {
          contextManager.setNodeVariable(
            nodeId,
            'trigger.resourceId',
            context.triggerData[resourceType].id
          )
        }
        break

      case 'updated':
        if (context.changedFields) {
          contextManager.setNodeVariable(nodeId, 'trigger.changedFields', context.changedFields)
        }
        if (context.previousValues) {
          contextManager.setNodeVariable(nodeId, 'trigger.previousValues', context.previousValues)
        }
        break

      case 'deleted':
        if (context.deletedBy) {
          contextManager.setNodeVariable(nodeId, 'trigger.deletedBy', context.deletedBy)
          if (context.deletedBy.id) {
            contextManager.setNodeVariable(nodeId, 'trigger.deletedBy.id', context.deletedBy.id)
          }
          if (context.deletedBy.name) {
            contextManager.setNodeVariable(nodeId, 'trigger.deletedBy.name', context.deletedBy.name)
          }
          if (context.deletedBy.email) {
            contextManager.setNodeVariable(
              nodeId,
              'trigger.deletedBy.email',
              context.deletedBy.email
            )
          }
        }
        break
    }
  }

  protected async validateNodeConfig(node: WorkflowNode): Promise<ValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []

    // Validate resource type is provided
    if (!node.data.resourceType) {
      errors.push('Resource type is required in node data')
    } else {
      const resourceType = node.data.resourceType as string
      // Entity definition types (contact, ticket, etc.) and custom entities skip static config validation
      // They will be validated at runtime when we have database access
      if (
        !isEntityDefinitionType(resourceType) &&
        !isCustomResourceId(resourceType) &&
        !RESOURCE_CONFIGS[resourceType as TableId]
      ) {
        errors.push(`Invalid resource type: "${resourceType}"`)
      }
    }

    // Validate operation is provided
    if (!node.data.operation) {
      errors.push('Operation is required in node data')
    } else if (!RESOURCE_OPERATIONS[node.data.operation]) {
      errors.push(`Invalid operation: "${node.data.operation}"`)
    }

    // Validate filters if present. Same fail-closed reading as the run path — a
    // filter that cannot be parsed here is one that will refuse to fire there, so
    // surface it at save time rather than as a silent non-run.
    if (node.data.filters !== undefined && node.data.filters !== null) {
      const groups = readTriggerFilters(node.data.filters)
      if (groups === null) {
        errors.push('Trigger filters must be an array of condition groups')
      } else {
        for (const condition of groups.flatMap((g) => g.conditions)) {
          if (!isKnownOperator(condition.operator)) {
            errors.push(`Unknown filter operator: "${condition.operator}"`)
          }
        }
        if (findVariableModeConditions(groups).length > 0) {
          errors.push('Trigger filters cannot reference workflow variables')
        }
      }
    }

    return { valid: errors.length === 0, errors, warnings }
  }

  /**
   * Decide whether `node.data.filters` lets this record through.
   *
   * 🔴 This is a GATE, and it fails CLOSED. Uses
   * {@link evaluateConditionsWithDiagnostics} rather than the plain evaluator for
   * the same reason record rules and sequence enrollment do: an unrecognised
   * operator now evaluates `false`, so a filter the evaluator cannot read as
   * written would just stop firing — silently. Refuse and say so instead.
   *
   * Operator semantics come from the shared `evaluateOperator` via the shared
   * evaluator; there is deliberately no private comparison logic here.
   *
   * No filter at all → `fire`. That is the only path on which an unfiltered
   * trigger keeps its "runs on every record" behaviour.
   */
  private async evaluateTriggerFilters(
    node: WorkflowNode,
    resourceType: string,
    organizationId: string,
    triggerData: unknown
  ): Promise<TriggerFilterOutcome> {
    const groups = readTriggerFilters(node.data.filters)
    if (groups === null) {
      return {
        decision: 'refused',
        reason: 'filters is not an array of condition groups',
        detail: { filters: node.data.filters },
      }
    }
    if (!hasConditions(groups)) return { decision: 'fire' }

    const variableConditions = findVariableModeConditions(groups)
    if (variableConditions.length > 0) {
      return {
        decision: 'refused',
        reason: 'trigger filters cannot reference workflow variables',
        detail: variableConditions.map((c) => ({ conditionId: c.id, operator: c.operator })),
      }
    }

    // Field refs arrive as `resourceType:fieldKey` (the panel's `toResourceFieldId`);
    // the shared evaluator strips the prefix and the snapshot resolver maps the key
    // onto the snapshot's field-value output key.
    const fields = await getCachedResourceFields(organizationId, resourceType)
    if (fields.length === 0) {
      return {
        decision: 'refused',
        reason: `no cached fields for resource "${resourceType}" — conditions cannot be resolved`,
      }
    }

    const { matched, diagnostics } = evaluateConditionsWithDiagnostics(
      triggerData as RecordSnapshot,
      normalizeStatusConditions(groups),
      makeSnapshotResolver(fields)
    )

    if (diagnostics.length > 0) {
      return {
        decision: 'refused',
        reason: 'one or more conditions could not be evaluated as written',
        detail: diagnostics,
      }
    }

    return matched ? { decision: 'fire' } : { decision: 'no-match' }
  }
}
