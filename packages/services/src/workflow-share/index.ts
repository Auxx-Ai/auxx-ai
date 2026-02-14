// packages/services/src/workflow-share/index.ts

// Re-export passport functions from @auxx/credentials for convenience
export {
  type IssueWorkflowPassportOptions,
  issueWorkflowPassport,
  type PassportError,
  type VerifiedPassport,
  verifyWorkflowPassport,
  type WorkflowPassportPayload,
  type WorkflowPassportResult,
} from '@auxx/credentials/passport'
// Error types
export type { WorkflowShareError } from './errors'
export {
  type EndUser,
  type GetOrCreateEndUserOptions,
  getOrCreateEndUser,
} from './get-or-create-end-user'
// Service functions
export {
  type GetSharedWorkflowByTokenOptions,
  getSharedWorkflowByToken,
} from './get-shared-workflow-by-token'
export {
  type GetWorkflowByApiKeyOptions,
  getWorkflowByApiKey,
  type WorkflowByApiKey,
} from './get-workflow-by-api-key'
export {
  type IncrementEndUserRunCountOptions,
  incrementEndUserRunCount,
} from './increment-end-user-run-count'
// Shared types
export type {
  EndUserIdentification,
  SharedWorkflow,
  WorkflowRateLimitConfig,
  WorkflowShareAccessMode,
  WorkflowShareConfig,
  WorkflowShareIcon,
} from './types'
export {
  type AccessValidationResult,
  type ValidateWorkflowAccessOptions,
  validateWorkflowAccess,
} from './validate-workflow-access'
export {
  type ApiKeyValidationResult,
  type ValidateWorkflowApiKeyOptions,
  validateWorkflowApiKey,
} from './validate-workflow-api-key'
