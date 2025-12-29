// apps/web/src/components/workflow/share/hooks/use-workflow-share.ts

import { useCallback } from 'react'
import { API_URL } from '@auxx/config/urls'

/**
 * Shared workflow site info from API
 */
export interface WorkflowSiteInfo {
  shareToken: string
  workflowId: string
  accessMode: string
  site: {
    title: string
    description: string | null
    about?: string
    logoUrl?: string
    brandName?: string
    hideBranding: boolean
  }
  triggerConfig: {
    showWorkflowPreview: boolean
    showInputForm: boolean
    submitButtonText: string
    successMessage: string
    showWorkflowDetails: boolean
  }
  workflow: {
    id: string
    name: string
    description: string | null
    graph: unknown
    inputSchema?: Record<string, unknown>
  }
}

/**
 * Passport response from API
 */
export interface PassportResponse {
  passport: string
  endUserId: string
  expiresAt: string
}

/**
 * Workflow run response from API
 */
export interface WorkflowRunResponse {
  id: string
  status: string
}

/**
 * Hook for fetching shared workflow data from Hono API
 */
export function useWorkflowShare(shareToken: string) {
  /**
   * Fetch site info (public, no auth required)
   */
  const fetchSiteInfo = useCallback(async (): Promise<WorkflowSiteInfo> => {
    const res = await fetch(`${API_URL}/api/v1/workflows/share/${shareToken}/site`)
    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: 'Failed to fetch site info' }))
      throw new Error(error.message || 'Failed to fetch site info')
    }
    const { data } = await res.json()
    return data
  }, [shareToken])

  /**
   * Fetch or create passport (sets cookie)
   */
  const fetchPassport = useCallback(async (): Promise<PassportResponse> => {
    const res = await fetch(`${API_URL}/api/v1/workflows/share/${shareToken}/passport`, {
      credentials: 'include',
    })
    if (!res.ok) {
      const error = await res
        .json()
        .catch(() => ({ message: 'You dont have access to this workflow' }))
      throw new Error(error.message || 'You dont have access to this workflow')
    }
    const { data } = await res.json()
    return data
  }, [shareToken])

  /**
   * Get run status from Hono API
   */
  const getRunStatus = useCallback(
    async (passport: string, runId: string): Promise<WorkflowRunResponse> => {
      const res = await fetch(`${API_URL}/api/v1/workflows/share/${shareToken}/runs/${runId}`, {
        headers: {
          Authorization: `Bearer ${passport}`,
        },
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({ message: 'Failed to fetch run status' }))
        throw new Error(error.message || 'Failed to fetch run status')
      }
      const { data } = await res.json()
      return data
    },
    [shareToken]
  )

  return {
    fetchSiteInfo,
    fetchPassport,
    getRunStatus,
  }
}
