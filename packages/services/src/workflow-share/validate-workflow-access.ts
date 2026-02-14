// packages/services/src/workflow-share/validate-workflow-access.ts

import { err, ok, type Result } from 'neverthrow'
import { verifyOrgMembership } from '../organization-members'
import type { WorkflowShareError } from './errors'
import type { SharedWorkflow } from './types'

/**
 * Options for web access validation
 * API access is validated separately via apiEnabled flag and API keys
 */
export interface ValidateWorkflowAccessOptions {
  workflow: SharedWorkflow
  /** Auxx user ID (if logged in) */
  userId?: string
}

/**
 * Access validation result
 */
export interface AccessValidationResult {
  canAccess: boolean
  accessMode: string
}

/**
 * Validate if user can access the workflow via web
 * This validates accessMode-based access (public/organization)
 * API access is validated separately via apiEnabled flag and API keys
 *
 * @param options - Validation options
 * @returns Result with access status or error
 */
export async function validateWorkflowAccess(
  options: ValidateWorkflowAccessOptions
): Promise<Result<AccessValidationResult, WorkflowShareError>> {
  const { workflow, userId } = options

  if (!workflow.enabled) {
    return err({
      code: 'WORKFLOW_DISABLED' as const,
      message: 'Workflow is disabled',
      workflowAppId: workflow.id,
    })
  }

  // Check if web access is enabled
  if (!workflow.webEnabled) {
    return err({
      code: 'ACCESS_DENIED' as const,
      message: 'Web access is not enabled for this workflow',
      reason: 'Web access not enabled',
      accessMode: 'web',
    })
  }

  switch (workflow.accessMode) {
    case 'public':
      // Anyone can access
      return ok({ canAccess: true, accessMode: 'public' })

    case 'organization': {
      // Requires user to be logged in AND be a member of the organization
      if (!userId) {
        return err({
          code: 'ACCESS_DENIED' as const,
          message: 'Authentication required',
          reason: 'This workflow requires you to be logged in',
          accessMode: 'organization',
        })
      }

      // Verify user is a member of the workflow's organization
      const membershipResult = await verifyOrgMembership({
        userId,
        organizationId: workflow.organizationId,
      })

      if (membershipResult.isErr()) {
        const error = membershipResult.error
        if (error.code === 'NOT_MEMBER') {
          return err({
            code: 'ACCESS_DENIED' as const,
            message: 'Organization membership required',
            reason: 'You must be a member of this organization to access this workflow',
            accessMode: 'organization',
          })
        }
        // Database error
        return err({
          code: 'ACCESS_DENIED' as const,
          message: 'Unable to verify organization membership',
          reason: 'An error occurred while checking your access',
          accessMode: 'organization',
        })
      }

      return ok({ canAccess: true, accessMode: 'organization' })
    }

    default:
      return err({
        code: 'ACCESS_DENIED' as const,
        message: 'Unknown access mode',
        reason: `Access mode "${workflow.accessMode}" is not supported`,
        accessMode: workflow.accessMode,
      })
  }
}
