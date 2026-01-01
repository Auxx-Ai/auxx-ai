// packages/lib/src/conditions/client.ts

// Client-side entry point - re-exports everything
// This allows tree-shaking and separate bundling if needed

export type { Condition, ConditionGroup, ConditionValidationResult } from './types'
export { conditionSchema, conditionGroupSchema, conditionGroupsSchema } from './schema'
