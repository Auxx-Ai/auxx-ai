// packages/lib/src/workflow-engine/query-builder/condition-query-builder.ts

// Re-export for backward compatibility
// Existing code can continue using ConditionQueryBuilder.buildWhereSql(...)

import type { SQL } from 'drizzle-orm'
import type { TableId } from '../../resources/registry/field-registry'
import type { ConditionGroup, GenericCondition } from './base-condition-builder'
import { systemConditionBuilder } from './system-condition-builder'

/**
 * @deprecated Use SystemConditionBuilder directly for new code
 * This class is maintained for backward compatibility
 */
export class ConditionQueryBuilder {
  /**
   * Build a Drizzle `SQL` expression from an array of conditions
   */
  static buildWhereSql(
    conditions: GenericCondition[],
    resourceType: TableId
  ): SQL<unknown> | undefined {
    return systemConditionBuilder.buildWhereSql(conditions, resourceType)
  }

  /**
   * Build grouped SQL clauses from condition groups
   */
  static buildGroupedQuery(
    groups: ConditionGroup[],
    resourceType: TableId
  ): SQL<unknown> | undefined {
    return systemConditionBuilder.buildGroupedQuery(groups, resourceType)
  }

  /**
   * Build order-by SQL clauses using field registry
   */
  static buildOrderBySql(
    field?: string,
    direction: 'asc' | 'desc' = 'asc',
    resourceType?: TableId
  ): SQL<unknown>[] | undefined {
    if (!field || !resourceType) return undefined
    return systemConditionBuilder.buildOrderBySql(field, direction, resourceType)
  }

  /**
   * Validate that all conditions are valid for the given resource type
   */
  static validateConditions(
    conditions: GenericCondition[],
    resourceType: TableId,
    allowedFields: string[] = []
  ): { valid: boolean; errors: string[] } {
    return systemConditionBuilder.validateConditions(
      conditions,
      resourceType,
      allowedFields.length > 0 ? allowedFields : undefined
    )
  }

  /**
   * Validate condition groups
   */
  static validateConditionGroups(
    groups: ConditionGroup[],
    resourceType: TableId,
    allowedFields: string[] = []
  ): { valid: boolean; errors: string[] } {
    return systemConditionBuilder.validateConditionGroups(
      groups,
      resourceType,
      allowedFields.length > 0 ? allowedFields : undefined
    )
  }

  /**
   * Generate a human-readable description of the conditions
   */
  static describeConditions(conditions: GenericCondition[]): string {
    return systemConditionBuilder.describeConditions(conditions)
  }

  /**
   * Generate a human-readable description of grouped conditions
   */
  static describeGroupedConditions(groups: ConditionGroup[]): string {
    return systemConditionBuilder.describeGroupedConditions(groups)
  }
}

// Re-export types
export type { GenericCondition, ConditionGroup }
