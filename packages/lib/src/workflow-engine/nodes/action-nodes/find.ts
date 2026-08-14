// packages/lib/src/workflow-engine/nodes/action-nodes/find.ts

import { type Database, database, schema } from '@auxx/database'
import { parseResourceFieldId, type ResourceFieldId } from '@auxx/types/field'
import type { SQL } from 'drizzle-orm'
import { getCachedResource, getCachedResourceFields } from '../../../cache'
import type { Condition, ConditionGroup as MailConditionGroup } from '../../../conditions/types'
import { buildConditionGroupsQueryWithDiagnostics } from '../../../mail-query/condition-query-builder'
import { getAutomationVisibility } from '../../../permissions/visibility/automation-visibility'
import { FIND_RESOURCE_CONFIGS } from '../../../resources/find-definitions'
import type {
  ConditionGroup,
  GenericCondition,
} from '../../../resources/query-builder/base-condition-builder'
// Narrow import path on purpose: the `query-builder` barrel re-exports builders
// that pull in `@auxx/database`, and this module only needs the pure rewriter.
import {
  canonicalizeSystemConditions,
  canonicalizeSystemFieldRef,
} from '../../../resources/query-builder/canonicalize-system-fields'
import { ConditionQueryBuilder } from '../../../resources/query-builder/condition-query-builder'
import {
  getFieldOperators,
  getFieldOptions,
  isCustomResourceId,
  isValidFieldOptionValue,
  isValidOperatorForField,
  RESOURCE_FIELD_REGISTRY,
  setEntityVariables,
  toOutputShape,
} from '../../../resources/registry'
import type { TableId } from '../../../resources/registry/field-registry'
import { getFieldOutputKey, type ResourceField } from '../../../resources/registry/field-types'
import { executeResourceQuery } from '../../../resources/resource-fetcher'
import { toRecordId } from '../../../resources/resource-id'
import type { FindNodeData as CatalogFindNodeData } from '../../catalog/nodes/find'
import type { ExecutionContextManager } from '../../core/execution-context'
import type {
  NodeExecutionResult,
  PreprocessedNodeData,
  ValidationResult,
  WorkflowNode,
} from '../../core/types'
import { BaseType, NodeRunningStatus, WorkflowNodeType } from '../../core/types'
import { BaseNodeProcessor } from '../base-node'
import { resolveCanonicalResource } from '../utils/canonical-resource'
import { extractVariableRefs } from '../utils/variable-refs'

/** Rows returned when the configured limit is missing, unresolvable or non-positive. */
const DEFAULT_FIND_LIMIT = 10

/**
 * Engine-side view of the find node's persisted config — a `Pick` off the
 * catalog's `FindNodeData` (imported directly, not via `client.ts`: engine
 * code never goes through the client barrel). `conditions`/`conditionGroups`
 * type identically to this file's own `GenericCondition[]`/`ConditionGroup[]`
 * (both ultimately `Condition`/`ConditionGroup` from `../../../conditions`),
 * so this is a pure de-duplication, not a behavior change.
 */
type FindNodeData = Pick<
  CatalogFindNodeData,
  | 'resourceType' // Supports both system resources and custom entities (UUID/CUID format)
  | 'findMode'
  | 'conditions' // For backward compatibility
  | 'conditionGroups' // Primary grouping system
  | 'orderBy'
  | 'limit' // Can be number (constant) or string (variable reference)
  | 'fieldModes' // Field modes for VarEditor (true = constant mode)
>

/**
 * Drizzle query shape produced by the builder
 */
type BuiltQuery = {
  where?: SQL<unknown>
  orderBy?: SQL<unknown>[]
  limit?: number
}

/**
 * Normalize conditions from find-node format to mail-builder format.
 *
 * Handles three mismatches:
 * 1. Strips resource prefix from fieldId ("thread:inbox" → "inbox")
 * 2. Unwraps { referenceId } objects to plain ID strings
 * 3. Extracts .id from full entity objects resolved from variables
 */
function normalizeConditionsForMailBuilder(conditions: GenericCondition[]): Condition[] {
  return conditions.map((c) => {
    // Strip resource prefix
    const rawFieldId = (Array.isArray(c.fieldId) ? c.fieldId[0] : c.fieldId) ?? ''
    const fieldId = rawFieldId.includes(':')
      ? parseResourceFieldId(rawFieldId as ResourceFieldId).fieldId
      : rawFieldId

    // Normalize value
    let value = c.value

    // Unwrap { referenceId } objects (from relation picker UI)
    if (typeof value === 'object' && value !== null && 'referenceId' in value) {
      value = value.referenceId
    }
    if (Array.isArray(value)) {
      value = value.map((v: any) =>
        typeof v === 'object' && v !== null && 'referenceId' in v ? v.referenceId : v
      )
    }

    // Extract .id from full entity objects (from variable resolution)
    if (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      'id' in value &&
      !('referenceId' in value)
    ) {
      value = value.id
    }

    return { ...c, fieldId, value }
  })
}

function normalizeGroupsForMailBuilder(groups: ConditionGroup[]): MailConditionGroup[] {
  return groups.map((g) => ({
    ...g,
    conditions: normalizeConditionsForMailBuilder(g.conditions),
  }))
}

/**
 * Fold the legacy flat `conditions[]` into a single group so the node has
 * exactly one filter path through every lane.
 *
 * The combining operator reproduces `BaseConditionBuilder.deriveFlatOperator`
 * — `OR` when any condition *after the first* asks for it, `AND` otherwise —
 * so the folded group builds the same SQL as the `buildWhereSql` call it
 * replaces. Groups, when present, always win: that is the pre-existing
 * precedence `validateNodeConfig` already warns about.
 */
function foldFlatConditions(
  conditions: GenericCondition[],
  conditionGroups: ConditionGroup[]
): ConditionGroup[] {
  if (conditionGroups.length > 0) return conditionGroups
  if (conditions.length === 0) return []

  return [
    {
      id: 'flat',
      conditions,
      logicalOperator: conditions.some(
        (condition, index) => index > 0 && condition.logicalOperator === 'OR'
      )
        ? 'OR'
        : 'AND',
    },
  ]
}

/** One dropped condition, flattened out of either builder's diagnostics shape. */
interface DroppedRef {
  ref: string
  reason: string
}

/**
 * Message for a build that silently discarded a filter.
 *
 * A workflow acts on the result, so a dropped condition is a failure rather
 * than a notice: dropping widens an AND group and narrows an OR group, and
 * there is no human reading a warning mid-run. Mirrors the `UnprocessableEntity`
 * the AI count tools raise, except that this node fails on *any* drop — it has
 * no channel to report a partial one.
 *
 * Deliberately omits each drop's internal `detail` (the builder class name, or
 * a field builder's thrown message): a workflow run log is user-visible.
 */
function describeDroppedConditions(resourceType: string, drops: DroppedRef[]): string {
  const described = drops.map((drop) => `${drop.ref} (${drop.reason})`).join(', ')
  return `Cannot filter ${resourceType} by: ${described}`
}

/**
 * CUID2 shape, as `CustomField.id` is minted.
 *
 * Narrower than `isCustomResourceId` on purpose: this asks "is this reference a
 * field cuid?", and no static registry key can match it — every one of them is
 * either short or camelCase.
 */
const CUID_FIELD_REF = /^[a-z][a-z0-9]{19,}$/

function isCuidFieldRef(fieldRef: string): boolean {
  return CUID_FIELD_REF.test(fieldRef)
}

/**
 * Processor for find nodes that search for resources with dynamic filters and sorting
 */
export class FindProcessor extends BaseNodeProcessor {
  readonly type = WorkflowNodeType.FIND

  /** Strip resource prefix from fieldId if present (e.g., "message:from" → "from") */
  private stripFieldPrefix(fieldId: string): string {
    return fieldId.includes(':')
      ? parseResourceFieldId(fieldId as ResourceFieldId).fieldId
      : fieldId
  }

  /**
   * Validate condition values against registry (especially enums and operators)
   * For custom entities, validation is skipped - EntityConditionBuilder handles it at execution time
   */
  private validateConditionValues(
    resourceType: string,
    conditions: GenericCondition[],
    cachedFields?: ResourceField[]
  ): string[] {
    const errors: string[] = []

    // Skip validation for custom entities - field IDs are UUIDs, not static registry keys
    // EntityConditionBuilder will validate fields during query building
    if (isCustomResourceId(resourceType)) {
      return errors
    }

    for (const condition of conditions) {
      // Handle custom fields separately (for system resources with custom_ prefixed fields)
      const rawFieldId = Array.isArray(condition.fieldId) ? condition.fieldId[0] : condition.fieldId
      if (!rawFieldId) continue
      if (rawFieldId.startsWith('custom_')) {
        // Custom fields are loaded dynamically, so we can't validate against registry
        // Just validate that value is provided when needed
        if (this.isValueRequiredOperator(condition.operator)) {
          if (condition.value === '' || condition.value == null) {
            errors.push(
              `Custom field condition requires a value for operator "${condition.operator}"`
            )
          }
        }
        continue
      }

      // Strip resource prefix for registry lookups (e.g., "message:from" → "from")
      const fieldId = this.stripFieldPrefix(rawFieldId)
      // Look up in static registry first, then fall back to cached resource fields (UUID match)
      const field =
        RESOURCE_FIELD_REGISTRY[resourceType]?.[fieldId] ??
        cachedFields?.find((f) => f.id === fieldId || f.key === fieldId)

      if (!field) {
        errors.push(`Unknown field: ${fieldId}`)
        continue
      }

      // ✅ Validate operator is valid for field
      if (!isValidOperatorForField(field, condition.operator)) {
        const validOperators = getFieldOperators(field)
        errors.push(
          `Invalid operator "${condition.operator}" for field "${field.label}". ` +
            `Valid operators: ${validOperators.join(', ')}`
        )
        continue
      }

      // ✅ Validate option values (updated to use 'is' operator)
      if (field.type === BaseType.ENUM && condition.operator === 'is') {
        if (!isValidFieldOptionValue(resourceType as TableId, fieldId, String(condition.value))) {
          const validValues = getFieldOptions(field)
            .map((opt) => opt.value)
            .join(', ')
          errors.push(
            `Invalid value for ${field.label}: "${condition.value}". Valid values: ${validValues}`
          )
        }
      }

      // Validate 'in' operator option values
      if (
        field.type === BaseType.ENUM &&
        (condition.operator === 'in' || condition.operator === 'not in')
      ) {
        const values = Array.isArray(condition.value) ? condition.value : [condition.value]
        for (const val of values) {
          if (!isValidFieldOptionValue(resourceType as TableId, fieldId, String(val))) {
            const validValues = getFieldOptions(field)
              .map((opt) => opt.value)
              .join(', ')
            errors.push(`Invalid value for ${field.label}: "${val}". Valid values: ${validValues}`)
          }
        }
      }

      // NEW: Validate RELATION field values
      if (field.type === BaseType.RELATION && field.relationship) {
        // For 'is' and 'is not' operators on relation fields
        if (['is', 'is not', '=', '!='].includes(condition.operator)) {
          if (!condition.value) {
            errors.push(`${field.label} requires a value for operator "${condition.operator}"`)
            continue
          }

          // Value can be:
          // 1. String (ID or variable reference)
          // 2. Object with referenceId property
          const value = condition.value

          if (typeof value === 'string') {
            // Variable references are OK (validated at runtime)
            if (value.startsWith('{{') && value.endsWith('}}')) {
              continue
            }

            // Empty string is not allowed
            if (value.length === 0) {
              errors.push(`${field.label} cannot be empty`)
            }
          } else if (typeof value === 'object' && value.referenceId) {
            // Object with referenceId
            if (!value.referenceId || value.referenceId.length === 0) {
              errors.push(`${field.label} referenceId cannot be empty`)
            }
          }
        }

        // For 'in' and 'not in' operators
        if (['in', 'not in'].includes(condition.operator)) {
          if (!Array.isArray(condition.value) || condition.value.length === 0) {
            errors.push(
              `${field.label} requires an array of values for operator "${condition.operator}"`
            )
          }
        }
      }
    }

    return errors
  }

  /**
   * Check if an operator requires a value
   */
  private isValueRequiredOperator(operator: string): boolean {
    const valueRequiredOperators = [
      'is',
      'is not',
      '=',
      '!=',
      'contains',
      'not contains',
      'starts with',
      'ends with',
      '>',
      '<',
      '>=',
      '<=',
      'in',
      'not in',
    ]
    return valueRequiredOperators.includes(operator)
  }

  /**
   * Preprocess find node - resolve conditions and variables early
   */
  async preprocessNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<PreprocessedNodeData> {
    const config = node.data as unknown as FindNodeData

    // Resolve flat conditions (for backward compatibility) - in parallel
    let resolvedConditions: GenericCondition[] = []
    if (config.conditions) {
      const conditionValues = await Promise.all(
        config.conditions.map((c) => this.resolveConditionValue(c.value, contextManager))
      )
      resolvedConditions = config.conditions
        .map((condition, index) => ({
          ...condition,
          value: conditionValues[index],
        }))
        .filter((condition) => {
          // Filter out incomplete conditions (empty values for operators that need them)
          if (
            ['isEmpty', 'isNotEmpty', 'empty', 'not empty', 'exists', 'not exists'].includes(
              condition.operator
            )
          ) {
            return true // These operators don't need values
          }
          return condition.value !== '' && condition.value != null
        })
    }

    // Resolve grouped conditions - in parallel
    let resolvedGroups: ConditionGroup[] = []
    if (config.conditionGroups) {
      const groupPromises = config.conditionGroups.map(async (group) => {
        const conditionValues = await Promise.all(
          group.conditions.map((c) => this.resolveConditionValue(c.value, contextManager))
        )
        return {
          ...group,
          conditions: group.conditions
            .map((condition, index) => ({
              ...condition,
              value: conditionValues[index],
            }))
            .filter((condition) => {
              // Filter out incomplete conditions
              if (
                ['isEmpty', 'isNotEmpty', 'empty', 'not empty', 'exists', 'not exists'].includes(
                  condition.operator
                )
              ) {
                return true
              }
              return condition.value !== '' && condition.value != null
            }),
        }
      })
      resolvedGroups = await Promise.all(groupPromises)
    }

    const resolvedLimit = await this.resolveLimit(config, contextManager)

    const totalConditions =
      resolvedConditions.length +
      resolvedGroups.reduce((total, group) => total + group.conditions.length, 0)

    return {
      inputs: {
        resourceType: config.resourceType,
        findMode: config.findMode,
        conditions: resolvedConditions,
        conditionGroups: resolvedGroups,
        orderBy: config.orderBy,
        limit: resolvedLimit,
      },
      metadata: {
        nodeType: 'find',
        resourceType: config.resourceType,
        conditionCount: totalConditions,
        groupCount: resolvedGroups.length,
        preprocessedAt: new Date().toISOString(),
      },
    }
  }

  protected async executeNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager,
    preprocessedData?: PreprocessedNodeData
  ): Promise<Partial<NodeExecutionResult>> {
    const config = node.data as unknown as FindNodeData

    try {
      // Use preprocessed data if available, otherwise compute on the fly
      let resourceType: string
      let findMode: 'findOne' | 'findMany'
      let conditions: GenericCondition[]
      let conditionGroups: ConditionGroup[]
      let orderBy: FindNodeData['orderBy']
      let limit: number | undefined

      if (preprocessedData?.inputs) {
        resourceType = preprocessedData.inputs.resourceType
        findMode = preprocessedData.inputs.findMode
        conditions = preprocessedData.inputs.conditions
        conditionGroups = preprocessedData.inputs.conditionGroups
        orderBy = preprocessedData.inputs.orderBy
        limit = preprocessedData.inputs.limit
      } else {
        // WARNING: This is a fallback path. Preprocessing (preprocessNode) is preferred for performance.
        // This path is slower as it resolves conditions sequentially.
        resourceType = config.resourceType
        findMode = config.findMode

        // Process flat conditions (backward compatibility) - parallel
        if (config.conditions) {
          const conditionValues = await Promise.all(
            config.conditions.map((c) => this.resolveConditionValue(c.value, contextManager))
          )
          conditions = config.conditions
            .map((condition, index) => ({
              ...condition,
              value: conditionValues[index],
            }))
            .filter((condition) => {
              // Filter out incomplete conditions (empty values for operators that need them)
              if (
                ['isEmpty', 'isNotEmpty', 'empty', 'not empty', 'exists', 'not exists'].includes(
                  condition.operator
                )
              ) {
                return true // These operators don't need values
              }
              return condition.value !== '' && condition.value != null
            })
        } else {
          conditions = []
        }

        // Process grouped conditions - parallel
        if (config.conditionGroups) {
          const groupPromises = config.conditionGroups.map(async (group) => {
            const conditionValues = await Promise.all(
              group.conditions.map((c) => this.resolveConditionValue(c.value, contextManager))
            )
            return {
              ...group,
              conditions: group.conditions
                .map((condition, index) => ({
                  ...condition,
                  value: conditionValues[index],
                }))
                .filter((condition) => {
                  // Filter out incomplete conditions
                  if (
                    [
                      'isEmpty',
                      'isNotEmpty',
                      'empty',
                      'not empty',
                      'exists',
                      'not exists',
                    ].includes(condition.operator)
                  ) {
                    return true
                  }
                  return condition.value !== '' && condition.value != null
                }),
            }
          })
          conditionGroups = await Promise.all(groupPromises)
        } else {
          conditionGroups = []
        }

        orderBy = config.orderBy

        limit = await this.resolveLimit(config, contextManager)
      }

      // Get execution context
      const context = contextManager.getContext()
      const organizationId = context.organizationId
      const db = database

      // Resolve resource from org cache (system or custom) and canonicalize
      // `resourceType` to the cached resource's own id — see
      // `resolveCanonicalResource`'s docblock for why every lane below has to
      // agree on this one identity.
      const resource = await resolveCanonicalResource(organizationId, resourceType)
      resourceType = resource.id

      // Fold the legacy flat array into a group, then rewrite every field
      // reference into the form the builders resolve — both BEFORE validation,
      // so preflight and the build agree by construction rather than by
      // coincidence. That equivalence is the invariant #1478 had to restore for
      // `inspectFilterConditions`; this node had the same divergence.
      //
      // The entity lane is skipped: `entityConditionBuilder` resolves a cuid
      // natively, and `RESOURCE_FIELD_REGISTRY` has no slice for an
      // entityDefinitionId, so canonicalizing there would rewrite every field
      // to `custom_<cuid>`.
      const foldedGroups = foldFlatConditions(conditions, conditionGroups)
      const conditionGroupsToBuild = isCustomResourceId(resourceType)
        ? foldedGroups
        : canonicalizeSystemConditions(foldedGroups, resourceType as TableId, resource.fields)

      // Validate conditions using dynamic fields (pass cached resource for UUID matching)
      const allValidationErrors: string[] = []
      for (const group of conditionGroupsToBuild) {
        allValidationErrors.push(
          ...this.validateConditionValues(resourceType, group.conditions, resource.fields)
        )
      }

      if (allValidationErrors.length > 0) {
        throw new Error(`Invalid conditions: ${allValidationErrors.join(', ')}`)
      }

      const totalConditions = conditionGroupsToBuild.reduce(
        (total, group) => total + group.conditions.length,
        0
      )

      contextManager.log('DEBUG', node.nodeId, `Executing ${findMode} query for ${resourceType}`, {
        groups: conditionGroupsToBuild.length,
        totalConditions,
        orderBy,
        limit,
      })

      // Execute query based on resource type and find mode
      let result
      let resultCount: number

      if (isCustomResourceId(resourceType)) {
        // Handle custom entity query
        const queryResult = await this.executeCustomEntityQuery(
          resourceType,
          organizationId,
          db,
          conditionGroupsToBuild,
          orderBy,
          limit,
          findMode
        )
        result = queryResult.results
        resultCount = queryResult.count
      } else if (resourceType === 'thread') {
        // Thread queries use the dedicated mail condition builder which supports
        // cross-table joins (sender, recipients, body, tags, attachments, etc.)
        const queryResult = await this.executeThreadQuery(
          organizationId,
          conditionGroupsToBuild,
          resource.fields,
          orderBy,
          limit,
          findMode
        )
        result = queryResult.results
        resultCount = queryResult.count
      } else {
        // Handle other system resource queries (message, user, dataset, etc.)
        const query = this.buildQuery(
          resourceType as TableId,
          conditionGroupsToBuild,
          resource.fields,
          orderBy,
          limit
        )
        const queryResult = {
          results: await this.executeQueryOne(query, resourceType as TableId, organizationId),
          count: 1,
        }

        if (findMode === 'findMany') {
          const manyResult = await this.executeQueryMany(
            query,
            resourceType as TableId,
            organizationId
          )
          result = manyResult
          resultCount = Array.isArray(manyResult) ? manyResult.length : 0
        } else {
          result = queryResult.results
          resultCount = queryResult.results ? 1 : 0
        }
      }

      // Tier-A (static system table — thread/message/kb/…) results are raw
      // Drizzle rows keyed by camelCase DB columns (`status`, `assigneeId`,
      // `messageCount`, …), while the builder advertises fields by
      // `getFieldOutputKey` (`thread_status`, `assignee_id`, …) — see §3.2/
      // §10b step 4 of the variable-resolution deep dive. Merge in the
      // declared aliases here, at write time, for BOTH find modes: the raw
      // camelCase columns keep resolving (back-compat for hand-typed refs),
      // and the declared systemAttribute paths start resolving too. A
      // findMany item benefits the same way once assigned to `loop.item`.
      // The custom-entity lanes (ResourceReference-backed) are untouched —
      // they're correct today. Doing this BEFORE `outputData` is built below
      // means the run trace shows the identical merged shape the written
      // variable resolves to, not the raw row underneath — deliberate, since
      // the trace already keys on the same identity as the variable (see the
      // output-keying comment below); a findOne miss (`null`/`undefined`)
      // passes through untouched.
      if (!isCustomResourceId(resourceType)) {
        result = Array.isArray(result)
          ? result.map((row) => toOutputShape(row, resource.fields))
          : result
            ? toOutputShape(result, resource.fields)
            : result
      }

      contextManager.log(
        'INFO',
        node.nodeId,
        `Found ${resultCount} ${resource.plural.toLowerCase()}`
      )

      // The trace output carries the result under the SAME key the variable does
      // (see the keying note below), so a run trace and a `{{…}}` path never name
      // the same value differently.
      const pluralName = resource.plural.toLowerCase()
      const outputData = {
        [findMode === 'findOne' ? resourceType : pluralName]: result,
        count: resultCount,
        query_info: {
          resource_type: resourceType,
          find_mode: findMode,
          flat_conditions_applied: conditionGroups.length > 0 ? 0 : conditions.length,
          groups_applied: conditionGroups.length,
          total_conditions: totalConditions,
          order_by: orderBy?.field,
          limit_applied: limit,
        },
      }

      // Output keying — the contract the builder's variable picker advertises:
      //
      // - `findOne`  → `<node>.<resource.id>`     (`generateFindNodeVariablesFromFields`
      //                                            uses `resourceMeta.id` as the base path)
      // - `findMany` → `<node>.<resource.plural>` (same generator, `plural.toLowerCase()`)
      //
      // `findOne` deliberately does NOT key by `resource.label`. A label is
      // user-editable, so renaming an entity would silently break every workflow
      // reading its result, and the nine multi-word labels ('Knowledge Base',
      // 'Work Order', 'Product / Service', …) lowercase into keys no `{{…}}` path
      // can even address. `resource.id` is stable, addressable, and is already the
      // key `setResourceVariables`/`setEntityVariables` use for triggers and CRUD.
      //
      // A template addresses a custom entity's result as `{{<node>.@entity:<slug>}}`;
      // `@entity:` refs are rewritten to the installing org's EntityDefinition cuid.
      if (findMode === 'findOne') {
        if (isCustomResourceId(resourceType) && result) {
          // Store ResourceReference under entityDefinitionId key (matches frontend variable paths)
          // Field values load lazily when downstream nodes access them
          const entityData = {
            id: result.id,
            entityDefinitionId: resourceType,
            createdAt: result.createdAt,
            updatedAt: result.updatedAt,
          }
          setEntityVariables(resourceType, entityData, contextManager, node.nodeId)
        } else {
          // Same key, minus the lazy-loading reference: a system-resource row, or
          // the explicit `null` of a custom-entity lookup that matched nothing.
          // Writing the miss matters — a downstream `{{find_1.<resource>}}` has to
          // resolve to "nothing found" rather than to no variable at all.
          contextManager.setNodeVariable(node.nodeId, resourceType, result ?? null)
        }
      } else {
        if (isCustomResourceId(resourceType) && Array.isArray(result)) {
          // Store ResourceReferences for each item + cache base entity data
          const { createResourceReference } = await import('../../types/resource-reference')
          const refs = []
          for (const item of result) {
            if (item?.id) {
              const entityData = {
                id: item.id,
                entityDefinitionId: resourceType,
                createdAt: item.createdAt,
                updatedAt: item.updatedAt,
              }
              setEntityVariables(resourceType, entityData, contextManager, node.nodeId)

              // Cache base data for recordFieldCache (field values load lazily)
              const recordId = toRecordId(resourceType, item.id)
              contextManager.cacheRecordBase(recordId, entityData)
              refs.push(createResourceReference(resourceType as any, item.id, organizationId))
            }
          }
          // Store ResourceReference array under plural name for downstream consumption
          contextManager.setNodeVariable(node.nodeId, pluralName, refs)
        } else {
          // System resources
          contextManager.setNodeVariable(node.nodeId, pluralName, result)
        }
      }

      // Always store count and query_info
      contextManager.setNodeVariable(node.nodeId, 'count', resultCount)
      contextManager.setNodeVariable(node.nodeId, 'query_info', outputData.query_info)

      return {
        status: NodeRunningStatus.Succeeded,
        output: outputData,
      }
    } catch (error) {
      contextManager.log(
        'ERROR',
        node.nodeId,
        `Find node execution failed: ${error instanceof Error ? error.message : String(error)}`
      )

      return {
        status: NodeRunningStatus.Failed,
        error: `Failed to find ${config.resourceType}: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  /**
   * Build the database query for a system resource from already-canonicalized
   * condition groups.
   *
   * Custom entities take `executeCustomEntityQuery` and threads take
   * `executeThreadQuery`; this covers the rest.
   *
   * @throws When the builder dropped any condition — see
   *         {@link describeDroppedConditions}.
   */
  private buildQuery(
    resourceType: TableId,
    conditionGroups: ConditionGroup[],
    fields: ResourceField[],
    orderBy?: FindNodeData['orderBy'],
    limit?: number
  ): BuiltQuery {
    const { sql: whereClause, droppedConditions } =
      ConditionQueryBuilder.buildGroupedQueryWithDiagnostics(conditionGroups, resourceType)

    if (droppedConditions.length > 0) {
      throw new Error(
        describeDroppedConditions(
          resourceType,
          droppedConditions.map((dropped) => ({
            ref: Array.isArray(dropped.fieldRef) ? dropped.fieldRef.join(' → ') : dropped.fieldRef,
            reason: dropped.reason,
          }))
        )
      )
    }

    // An unresolvable sort still no-ops silently — sort is deliberately not a
    // reporting channel (carried forward from #1478).
    const orderByClause = orderBy
      ? ConditionQueryBuilder.buildOrderBySql(
          canonicalizeSystemFieldRef(orderBy.field, resourceType, fields),
          orderBy.direction || 'asc',
          resourceType
        )
      : undefined

    return {
      where: whereClause,
      orderBy: orderByClause,
      limit,
    }
  }

  /**
   * Execute findOne query using shared resource fetcher
   */
  private async executeQueryOne(
    query: BuiltQuery,
    resourceType: TableId,
    organizationId: string | undefined
  ) {
    return executeResourceQuery(resourceType, organizationId, query, 'findOne')
  }

  /**
   * Execute findMany query using shared resource fetcher
   */
  private async executeQueryMany(
    query: BuiltQuery,
    resourceType: TableId,
    organizationId: string | undefined
  ) {
    return executeResourceQuery(resourceType, organizationId, query, 'findMany')
  }

  /**
   * Execute thread query using the dedicated mail condition builder.
   * Supports cross-table joins for sender, recipients, body, tags, attachments, etc.
   *
   * `conditionGroups` arrives canonicalized against `THREAD_FIELDS`, which is
   * the vocabulary the mail builder already shares (`subject`, `status`,
   * `inbox`, `assignee`, `ticket`, `from`, `to`, `body`, …), so a cuid-addressed
   * materialized field lands on the static key the builder dispatches on.
   *
   * A genuinely custom field on a thread canonicalizes to `custom_<cuid>`,
   * which is **meaningless to the mail builder** — it drops, and the drop now
   * fails the node. Do not "fix" that by teaching the mail builder a `custom_`
   * prefix: that would be a `FieldValue` read outside the mail lens.
   *
   * @throws When the builder dropped any condition.
   */
  private async executeThreadQuery(
    organizationId: string,
    conditionGroups: ConditionGroup[],
    fields: ResourceField[],
    orderBy: FindNodeData['orderBy'] | undefined,
    limit: number | undefined,
    findMode: 'findOne' | 'findMany'
  ): Promise<{ results: any[] | any; count: number }> {
    // Normalize conditions: strip fieldId prefix, unwrap { referenceId }, extract .id
    const normalizedGroups = normalizeGroupsForMailBuilder(conditionGroups)

    // Build WHERE clause via mail builder (includes org scoping internally).
    // Configured automation reads as AUTOMATION_SYSTEM (§8.2): full on org
    // inboxes, zero access to personal inboxes.
    const { sql: whereClause, droppedConditions } = buildConditionGroupsQueryWithDiagnostics(
      normalizedGroups,
      organizationId,
      await getAutomationVisibility(organizationId)
    )

    // A dropped mail condition leaves `sql` as the bare base scope — the whole
    // visible mailbox — which for a workflow is the worst available outcome.
    if (droppedConditions.length > 0) {
      throw new Error(
        describeDroppedConditions(
          'thread',
          droppedConditions.map((dropped) => ({ ref: dropped.fieldId, reason: dropped.reason }))
        )
      )
    }

    // Build ORDER BY (fall back to SystemConditionBuilder for column resolution)
    const orderByClause = orderBy
      ? ConditionQueryBuilder.buildOrderBySql(
          canonicalizeSystemFieldRef(orderBy.field, 'thread', fields),
          orderBy.direction || 'asc',
          'thread'
        )
      : undefined

    // Execute query directly — mail builder already handles org scoping
    const baseQuery = database.select().from(schema.Thread).$dynamic()
    let q = baseQuery.where(whereClause).orderBy(...(orderByClause ?? []))

    if (findMode === 'findOne') {
      const [row] = await q.limit(1)
      return { results: row ?? null, count: row ? 1 : 0 }
    }

    if (limit) q = q.limit(limit)
    const rows = await q
    return { results: rows, count: rows.length }
  }

  /**
   * Execute custom entity query against EntityInstance table
   * Field values are stored in FieldValue table (not on EntityInstance)
   */
  private async executeCustomEntityQuery(
    resourceType: string,
    organizationId: string,
    db: Database,
    conditionGroups: ConditionGroup[],
    orderBy: FindNodeData['orderBy'] | undefined,
    limit: number | undefined,
    findMode: 'findOne' | 'findMany'
  ): Promise<{ results: any[] | any; count: number }> {
    // resourceType is now EntityDefinitionId (UUID) directly
    const entityDefinitionId = resourceType

    // Validate entity definition exists via org cache
    const cachedResource = await getCachedResource(organizationId, entityDefinitionId)
    if (!cachedResource) {
      throw new Error(`Entity definition not found: ${entityDefinitionId}`)
    }

    // Get fields for this entity from org cache
    const fields = await getCachedResourceFields(organizationId, resourceType)

    // Import EntityConditionBuilder
    const { entityConditionBuilder } = await import(
      '../../../resources/query-builder/entity-condition-builder'
    )

    // Pre-fetch related entity fields for relationship path conditions
    const relatedEntityFields: Record<string, any[]> = {}
    if (conditionGroups.length > 0) {
      const { extractRequiredRelatedEntities } = await import(
        '../../../resources/crud/unified-handler-queries'
      )
      const requiredRelated = extractRequiredRelatedEntities(conditionGroups, fields)
      for (const relatedId of requiredRelated) {
        relatedEntityFields[relatedId] = await getCachedResourceFields(organizationId, relatedId)
      }
    }

    // Build query context for entity
    // outerTable provides direct column reference for proper Drizzle table context in subqueries
    const entityContext = {
      fields,
      outerTable: schema.EntityInstance,
      relatedEntityFields,
    }

    // Build WHERE clause using EntityConditionBuilder.
    //
    // Unlike the system and thread lanes, a drop here is NOT failed — this lane
    // resolves cuids natively, so it never had the field-vocabulary mismatch
    // those two do, and it was deliberately left alone. Its remaining drops
    // (an operator the entity builder can't build) still widen silently;
    // that is a known gap, not an oversight.
    const whereClause =
      conditionGroups.length > 0
        ? entityConditionBuilder.buildGroupedQuery(conditionGroups, entityContext)
        : undefined

    // Build ORDER BY clause
    let orderByClause: SQL<unknown>[] | undefined
    if (orderBy) {
      orderByClause = entityConditionBuilder.buildOrderBySql(
        orderBy.field,
        orderBy.direction || 'asc',
        entityContext
      )
    }

    // Build base query with organization and entity filters
    const baseWhere = (instances: any, { eq, and, isNull }: any) => {
      const baseConditions = [
        eq(instances.entityDefinitionId, entityDefinitionId),
        eq(instances.organizationId, organizationId),
        isNull(instances.archivedAt),
      ]

      // Add field conditions if any
      if (whereClause) {
        return and(...baseConditions, whereClause)
      }

      return and(...baseConditions)
    }

    // Execute query
    const results = await db.query.EntityInstance.findMany({
      where: baseWhere,
      orderBy: orderByClause,
      limit: findMode === 'findOne' ? 1 : limit,
    })

    // For findMany, return bare instances — field values load lazily via recordFieldCache
    // findOne also uses lazy loading via ResourceReference
    return {
      results: findMode === 'findOne' ? (results[0] ?? null) : results,
      count: results.length,
    }
  }

  /**
   * Resolve condition values that might be variables
   */
  private async resolveConditionValue(
    value: any,
    contextManager: ExecutionContextManager
  ): Promise<any> {
    if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
      // Extract variable name from {{varName}} format
      const varName = value.slice(2, -2).trim()
      const resolvedValue = await contextManager.getVariable(varName)
      return resolvedValue !== undefined ? resolvedValue : value
    }
    return value
  }

  /**
   * Resolve the row limit, which the panel can put in constant or variable mode.
   *
   * The limit field is a `VAR_MODE.PICKER` editor, so in variable mode it stores a
   * **bare dotted path** (`node-1.count`) and only sometimes a `{{…}}` template.
   * Interpolating alone left the path untouched, `parseInt` returned `NaN`, and the
   * node silently queried 10 rows while the panel showed the bound variable —
   * {@link BaseNodeProcessor.resolveNumberField} understands both shapes.
   *
   * A resolved value of zero or less is meaningless for a query, so it falls back
   * to the same default an unresolvable one does.
   */
  private async resolveLimit(
    config: FindNodeData,
    contextManager: ExecutionContextManager
  ): Promise<number | undefined> {
    const { limit } = config
    if (limit === undefined) return undefined

    // Legacy object-based variable reference ({ varName })
    if (typeof limit === 'object') {
      const resolved = Number(await this.resolveVariableValue(limit, contextManager))
      return Number.isFinite(resolved) ? resolved : undefined
    }

    if (typeof limit === 'number') return limit

    const resolved = await this.resolveNumberField(
      limit,
      config.fieldModes?.['limit'],
      DEFAULT_FIND_LIMIT,
      contextManager
    )
    return resolved > 0 ? Math.trunc(resolved) : DEFAULT_FIND_LIMIT
  }

  /**
   * Resolve variable values
   */
  protected async resolveVariableValue(
    variable: any,
    contextManager: ExecutionContextManager
  ): Promise<any> {
    if (typeof variable === 'object' && 'varName' in variable) {
      return await contextManager.getVariable(variable.varName)
    }
    return variable
  }

  /**
   * Extract variables from filter conditions
   */
  protected extractRequiredVariables(node: WorkflowNode): string[] {
    const config = node.data as unknown as FindNodeData
    const variables = new Set<string>()

    // Extract from flat conditions (backward compatibility)
    if (config.conditions && Array.isArray(config.conditions)) {
      config.conditions.forEach((condition: GenericCondition) => {
        // Add variableId if present
        if (condition.variableId) {
          variables.add(condition.variableId)
        }

        // Extract from value if it's a string with variables
        if (condition.value && typeof condition.value === 'string') {
          this.extractVariableIds(condition.value).forEach((v) => variables.add(v))
        }
      })
    }

    // Extract from condition groups
    if (config.conditionGroups && Array.isArray(config.conditionGroups)) {
      config.conditionGroups.forEach((group: ConditionGroup) => {
        group.conditions?.forEach((condition: GenericCondition) => {
          // Add variableId if present
          if (condition.variableId) {
            variables.add(condition.variableId)
          }

          // Extract from value if it's a string with variables
          if (condition.value && typeof condition.value === 'string') {
            this.extractVariableIds(condition.value).forEach((v) => variables.add(v))
          }
        })
      })
    }

    // Extract from limit if it's a variable reference — both shapes, since the
    // picker writes a bare path and the rich editor writes a `{{…}}` template.
    if (config.limit && typeof config.limit === 'string') {
      extractVariableRefs(config.limit).forEach((v) => variables.add(v))
    }

    return Array.from(variables)
  }

  protected async validateNodeConfig(node: WorkflowNode): Promise<ValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []
    const config = node.data as unknown as FindNodeData

    /**
     * Report a field the static `FIND_RESOURCE_CONFIGS` slice doesn't know.
     *
     * Design time has no `organizationId`, so a `CustomField` cuid can't be
     * resolved here at all — erroring on a reference the panel itself offered
     * would be worse than not checking it. Everything else stays an error.
     */
    const pushUnknownField = (fieldId: string, message: string) => {
      if (isCuidFieldRef(fieldId)) {
        warnings.push(`${message} (custom field — validated at runtime)`)
      } else {
        errors.push(message)
      }
    }

    // Validate resource type
    if (!config.resourceType) {
      errors.push('Resource type is required')
    }
    // Note: We can't fully validate unknown resource types here at design time
    // Runtime validation using ResourceRegistryService will catch invalid types

    // Validate find mode
    if (!config.findMode || !['findOne', 'findMany'].includes(config.findMode)) {
      errors.push('Find mode must be either "findOne" or "findMany"')
    }

    // Validate flat conditions (backward compatibility)
    // For system resources, we can validate against FIND_RESOURCE_CONFIGS
    // For custom entities, validation happens at runtime
    const isSystemResource =
      config.resourceType && FIND_RESOURCE_CONFIGS[config.resourceType as TableId]

    if (isSystemResource) {
      const resourceConfig = FIND_RESOURCE_CONFIGS[config.resourceType as TableId]!

      config.conditions?.forEach((condition, index) => {
        // Skip validation for custom fields (they're loaded dynamically)
        const rawFlatFieldId = Array.isArray(condition.fieldId)
          ? condition.fieldId[0]
          : condition.fieldId
        if (!rawFlatFieldId) return
        if (rawFlatFieldId.startsWith('custom_')) {
          // Just validate value is provided when needed
          if (
            this.isValueRequiredOperator(condition.operator) &&
            (condition.value === '' || condition.value == null)
          ) {
            warnings.push(
              `Flat Condition ${index + 1}: Please provide a value for custom field (will be ignored during execution)`
            )
          }
          return
        }

        // Strip resource prefix for registry lookups (e.g., "message:from" → "from")
        const flatFieldId = this.stripFieldPrefix(rawFlatFieldId)
        const field = resourceConfig.filterableFields.find(
          (f: any) =>
            getFieldOutputKey(f) === flatFieldId || f.key === flatFieldId || f.id === flatFieldId
        )
        if (!field) {
          // A cuid-shaped ref is a field the panel legitimately offered — a
          // materialized or truly-custom `CustomField` — and is unresolvable
          // here by construction: `validateNodeConfig` has no `organizationId`
          // and so cannot load the merged fields. Warn, exactly like the
          // `custom_` branch above. A plainly-named unknown field stays an error.
          pushUnknownField(
            flatFieldId,
            `Flat Condition ${index + 1}: Invalid field "${flatFieldId}" for ${config.resourceType}`
          )
        } else {
          if (!isValidOperatorForField(field, condition.operator)) {
            const validOperators = getFieldOperators(field)
            errors.push(
              `Flat Condition ${index + 1}: Operator "${condition.operator}" not supported for field "${condition.fieldId}". Valid operators: ${validOperators.join(', ')}`
            )
          }
        }

        // Validate value is provided for operators that need it
        const valueRequiredOperators = [
          '=',
          '!=',
          'equals',
          'not equals',
          'contains',
          'not contains',
          'starts with',
          'ends with',
          '>',
          '<',
          '>=',
          '<=',
          'greaterThan',
          'lessThan',
          'greaterThanOrEqual',
          'lessThanOrEqual',
          'in',
          'not in',
        ]
        if (
          valueRequiredOperators.includes(condition.operator) &&
          (condition.value === '' || condition.value == null)
        ) {
          // Treat empty values as warnings rather than errors to allow UI editing
          warnings.push(
            `Flat Condition ${index + 1}: Please provide a value for operator "${condition.operator}" (will be ignored during execution)`
          )
        }
      })
    } else if (config.resourceType && isCustomResourceId(config.resourceType)) {
      // For custom entities, we can't validate at design time, so just warn
      if ((config.conditions?.length || 0) > 0) {
        warnings.push('Flat conditions on custom entities will be validated at runtime')
      }
    }

    // Validate condition groups
    if (isSystemResource) {
      const resourceConfig = FIND_RESOURCE_CONFIGS[config.resourceType as TableId]!
      config.conditionGroups?.forEach((group, groupIndex) => {
        if (group.conditions.length === 0) {
          warnings.push(`Group ${groupIndex + 1}: Empty group will be ignored during execution`)
        }

        group.conditions.forEach((condition, condIndex) => {
          // Skip validation for custom fields (they're loaded dynamically)
          const rawGroupFieldId = Array.isArray(condition.fieldId)
            ? condition.fieldId[0]
            : condition.fieldId
          if (!rawGroupFieldId) return
          if (rawGroupFieldId.startsWith('custom_')) {
            // Just validate value is provided when needed
            if (
              this.isValueRequiredOperator(condition.operator) &&
              (condition.value === '' || condition.value == null)
            ) {
              warnings.push(
                `Group ${groupIndex + 1}, Condition ${condIndex + 1}: Please provide a value for custom field (will be ignored during execution)`
              )
            }
            return
          }

          // Strip resource prefix for registry lookups (e.g., "message:from" → "from")
          const groupFieldId = this.stripFieldPrefix(rawGroupFieldId)
          const field = resourceConfig.filterableFields.find(
            (f: any) =>
              getFieldOutputKey(f) === groupFieldId ||
              f.key === groupFieldId ||
              f.id === groupFieldId
          )
          if (!field) {
            pushUnknownField(
              groupFieldId,
              `Group ${groupIndex + 1}, Condition ${condIndex + 1}: Invalid field "${groupFieldId}" for ${config.resourceType}`
            )
          } else {
            if (!isValidOperatorForField(field, condition.operator)) {
              const validOperators = getFieldOperators(field)
              errors.push(
                `Group ${groupIndex + 1}, Condition ${condIndex + 1}: Operator "${condition.operator}" not supported for field "${condition.fieldId}". Valid operators: ${validOperators.join(', ')}`
              )
            }
          }

          // Validate value is provided for operators that need it
          const valueRequiredOperators = [
            '=',
            '!=',
            'equals',
            'not equals',
            'contains',
            'not contains',
            'starts with',
            'ends with',
            '>',
            '<',
            '>=',
            '<=',
            'greaterThan',
            'lessThan',
            'greaterThanOrEqual',
            'lessThanOrEqual',
            'in',
            'not in',
          ]
          if (
            valueRequiredOperators.includes(condition.operator) &&
            (condition.value === '' || condition.value == null)
          ) {
            warnings.push(
              `Group ${groupIndex + 1}, Condition ${condIndex + 1}: Please provide a value for operator "${condition.operator}" (will be ignored during execution)`
            )
          }
        })
      })
    } else if (config.resourceType && isCustomResourceId(config.resourceType)) {
      // For custom entities, we can't validate at design time, so just warn
      if ((config.conditionGroups?.length || 0) > 0) {
        warnings.push('Condition groups on custom entities will be validated at runtime')
      }
    }

    // Validate orderBy field
    if (config.orderBy && config.resourceType && isSystemResource) {
      const resourceConfig = FIND_RESOURCE_CONFIGS[config.resourceType as TableId]!
      const strippedOrderField = this.stripFieldPrefix(config.orderBy.field)
      const sortableField = resourceConfig.sortableFields.find(
        (f: any) => getFieldOutputKey(f) === strippedOrderField || f.key === strippedOrderField
      )
      if (!sortableField) {
        errors.push(
          `Order by field "${config.orderBy.field}" is not sortable for ${config.resourceType}`
        )
      }
    }

    // Validate limit
    if (config.limit !== undefined) {
      if (typeof config.limit === 'number') {
        if (config.limit < 1) {
          errors.push('Limit must be at least 1')
        } else if (config.limit > 1000) {
          errors.push('Limit cannot exceed 1000')
        }
      }
    }

    // Warnings
    const totalConditions =
      (config.conditions?.length || 0) +
      (config.conditionGroups?.reduce((total, group) => total + group.conditions.length, 0) || 0)

    if (totalConditions === 0) {
      warnings.push(
        'No conditions or groups applied - will return all records (limited by default/specified limit)'
      )
    }

    if (config.findMode === 'findOne' && totalConditions > 5) {
      warnings.push(
        'Consider using fewer total conditions for findOne mode to ensure predictable results'
      )
    }

    // Warn about mixed usage
    if ((config.conditions?.length || 0) > 0 && (config.conditionGroups?.length || 0) > 0) {
      warnings.push(
        'Both flat conditions and groups are present. Groups will take precedence and flat conditions will be ignored.'
      )
    }

    return { valid: errors.length === 0, errors, warnings }
  }
}
