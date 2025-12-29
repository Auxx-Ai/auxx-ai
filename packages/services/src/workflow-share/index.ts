// packages/services/src/workflow-share/index.ts

// Error types
export type { WorkflowShareError } from './errors'

// Shared types
export type {
  WorkflowShareAccessMode,
  WorkflowShareIcon,
  WorkflowShareConfig,
  WorkflowRateLimitConfig,
  SharedWorkflow,
  EndUserIdentification,
} from './types'

// Service functions
export { getSharedWorkflowByToken, type GetSharedWorkflowByTokenOptions } from './get-shared-workflow-by-token'

export { getOrCreateEndUser, type GetOrCreateEndUserOptions, type EndUser } from './get-or-create-end-user'

export {
  validateWorkflowAccess,
  type ValidateWorkflowAccessOptions,
  type AccessValidationResult,
} from './validate-workflow-access'

export {
  validateWorkflowApiKey,
  type ValidateWorkflowApiKeyOptions,
  type ApiKeyValidationResult,
} from './validate-workflow-api-key'

export {
  getWorkflowByApiKey,
  type GetWorkflowByApiKeyOptions,
  type WorkflowByApiKey,
} from './get-workflow-by-api-key'

export { incrementEndUserRunCount, type IncrementEndUserRunCountOptions } from './increment-end-user-run-count'

// Re-export passport functions from @auxx/credentials for convenience
export {
  issueWorkflowPassport,
  verifyWorkflowPassport,
  type WorkflowPassportPayload,
  type IssueWorkflowPassportOptions,
  type WorkflowPassportResult,
  type VerifiedPassport,
  type PassportError,
} from '@auxx/credentials/passport'
