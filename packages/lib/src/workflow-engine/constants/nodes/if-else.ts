// packages/lib/src/workflow-engine/constants/nodes/if-else.ts

import { ALL_OPERATOR_KEYS, type Operator } from '../../operators/definitions'

/**
 * Comparison operators supported by if-else conditions
 * Derived from OPERATOR_DEFINITIONS
 */
export type ComparisonOperator = Operator

/**
 * All valid comparison operators
 */
export const ALL_COMPARISON_OPERATORS = ALL_OPERATOR_KEYS

/**
 * Logical operators for combining conditions
 */
export const LOGICAL_OPERATORS = {
  AND: 'and',
  OR: 'or',
} as const

export type LogicalOperator = (typeof LOGICAL_OPERATORS)[keyof typeof LOGICAL_OPERATORS]

/**
 * Default case IDs
 */
export const DEFAULT_CASE_IDS = {
  TRUE: 'true',
  FALSE: 'false',
} as const

/**
 * Connection keys for if-else nodes
 */
export const IF_ELSE_CONNECTIONS = {
  ON_TRUE: 'onTrue',
  ON_FALSE: 'onFalse',
  DEFAULT: 'default',
} as const
