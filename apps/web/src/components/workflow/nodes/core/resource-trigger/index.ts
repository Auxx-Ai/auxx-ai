// apps/web/src/components/workflow/nodes/core/resource-trigger/index.ts

export { ResourceTriggerNode } from './node'
export { getResourceTriggerOutputVariables } from './output-variables'
export { ResourceTriggerPanel } from './panel'
export {
  createResourceTriggerDefaultData,
  resourceTriggerDefinition,
  validateResourceTriggerConfig,
} from './schema'
export type { ResourceTriggerData, ResourceTriggerExecutionResult, ValidationResult } from './types'
export { resourceTriggerNodeDataSchema } from './types'
