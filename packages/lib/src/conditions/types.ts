// packages/lib/src/conditions/types.ts

import type { Operator } from './operator-definitions'
import type { ResourceFieldId } from '@auxx/types/field'

/**
 * Generic condition for filtering/querying resources
 * Used by workflow nodes, table filters, and query builders
 */
export interface Condition {
  id: string
  /**
   * Field identifier - supports multiple formats:
   *
   * 1. Direct field (ResourceFieldId): 'product:price', 'product:vendor'
   * 2. Relationship path (ResourceFieldId[]):
   *    ['product:vendor', 'vendor:name']
   *    ['product:vendor', 'vendor:country', 'country:code']
   * 3. Legacy formats (converted internally):
   *    - Simple string: 'price' → context.entityId + ':price'
   *    - Dot notation: 'vendor.name' → ['product:vendor', 'vendor:name']
   */
  fieldId: ResourceFieldId | ResourceFieldId[] | string
  operator: Operator
  value: string | number | boolean | string[] | any
  logicalOperator?: 'AND' | 'OR'

  // Optional - used by workflow but ignored by table filters
  isConstant?: boolean
  key?: string
  subConditions?: Condition[]
  metadata?: Record<string, any>
  numberVarType?: 'string' | 'number'
  variableId?: string
}

/**
 * Group of conditions with logical operator
 */
export interface ConditionGroup {
  id: string
  conditions: Condition[]
  logicalOperator: 'AND' | 'OR'
  metadata?: {
    name?: string
    description?: string
    collapsed?: boolean
    [key: string]: any
  }
  order?: number
  case_id?: string // Used by workflow switch nodes
}

/**
 * Validation result from condition builders
 */
export interface ConditionValidationResult {
  valid: boolean
  errors: string[]
}
