// packages/credentials/src/passport/types.ts

/**
 * Access mode for shared workflows
 */
export type WorkflowShareAccessMode = 'public' | 'organization' | 'api_key'

/**
 * Passport JWT payload
 */
export interface WorkflowPassportPayload {
  /** EndUser ID */
  sub: string
  /** Issuer */
  iss: string
  type: 'workflow_passport'
  shareToken: string
  workflowId: string
  organizationId: string
  accessMode: WorkflowShareAccessMode
  /** Auxx user ID (if logged in) */
  userId?: string
  /** External user ID (for embedded) */
  externalId?: string
  iat: number
  exp: number
}

/**
 * Options for issuing passport
 */
export interface IssueWorkflowPassportOptions {
  endUserId: string
  shareToken: string
  workflowId: string
  organizationId: string
  accessMode: WorkflowShareAccessMode
  userId?: string | null
  externalId?: string | null
  expiresIn?: string
}

/**
 * Result of passport issuance
 */
export interface WorkflowPassportResult {
  token: string
  expiresIn: string
  payload: Omit<WorkflowPassportPayload, 'iat' | 'exp'>
}

/**
 * Verified passport data
 */
export interface VerifiedPassport {
  endUserId: string
  shareToken: string
  workflowId: string
  organizationId: string
  accessMode: string
  userId?: string
  externalId?: string
}

/**
 * Passport error types
 */
export type PassportError =
  | { code: 'INVALID_PASSPORT'; message: string }
  | { code: 'PASSPORT_EXPIRED'; message: string }
