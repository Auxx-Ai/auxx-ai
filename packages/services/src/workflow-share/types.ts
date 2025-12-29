// packages/services/src/workflow-share/types.ts

/**
 * Access mode for web access to shared workflows
 * API access is controlled separately via apiEnabled flag
 */
export type WorkflowShareAccessMode = 'public' | 'organization'

/**
 * Icon configuration for shared workflow
 */
export interface WorkflowShareIcon {
  iconId: string
  color: string
}

/**
 * Configuration for shared workflow display
 */
export interface WorkflowShareConfig {
  title?: string
  description?: string
  /** About section text for the public page */
  about?: string
  logoUrl?: string
  brandName?: string
  hideBranding?: boolean
  showWorkflowPreview?: boolean
  showInputForm?: boolean
  submitButtonText?: string
  successMessage?: string
  maxConcurrentRuns?: number
}

/**
 * Rate limit configuration for shared workflow
 */
export interface WorkflowRateLimitConfig {
  enabled: boolean
  maxRequests: number
  windowMs: number
  perUser?: boolean
}

/**
 * Shared workflow data returned by get-shared-workflow-by-token
 */
export interface SharedWorkflow {
  id: string
  organizationId: string
  name: string
  description: string | null
  enabled: boolean
  shareToken: string
  /** Whether web/browser access is enabled */
  webEnabled: boolean
  /** Whether programmatic API access is enabled */
  apiEnabled: boolean
  icon: WorkflowShareIcon | null
  /** Access mode for web access (public or organization) */
  accessMode: WorkflowShareAccessMode
  config: WorkflowShareConfig | null
  rateLimit: WorkflowRateLimitConfig | null
  /** Optional raw graph data (when includeGraph: true) */
  graph?: unknown | null
}

/**
 * End user identification options
 */
export interface EndUserIdentification {
  /** Always required (from cookie) */
  sessionId: string
  /** Auxx user ID (if logged in) */
  userId?: string
  /** External user ID (for embedded) */
  externalId?: string
  metadata?: Record<string, unknown>
}
