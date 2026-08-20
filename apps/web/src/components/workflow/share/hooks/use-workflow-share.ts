// apps/web/src/components/workflow/share/hooks/use-workflow-share.ts

import { useCallback } from 'react'
import { useEnv } from '~/providers/dehydrated-state-provider'
import { readErrorMessage } from '../utils/error-message'

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
  const { apiUrl } = useEnv()

  /**
   * Fetch site info (public, no auth required)
   */
  const fetchSiteInfo = useCallback(async (): Promise<WorkflowSiteInfo> => {
    const res = await fetch(`${apiUrl}/workflows/share/${shareToken}/site`)
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      throw new Error(readErrorMessage(body, 'Failed to fetch site info'))
    }
    const { data } = await res.json()
    return data
  }, [shareToken, apiUrl])

  /**
   * Get run status from Hono API
   */
  const getRunStatus = useCallback(
    async (passport: string, runId: string): Promise<WorkflowRunResponse> => {
      const res = await fetch(`${apiUrl}/workflows/share/${shareToken}/runs/${runId}`, {
        headers: {
          Authorization: `Bearer ${passport}`,
        },
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(readErrorMessage(body, 'Failed to fetch run status'))
      }
      const { data } = await res.json()
      return data
    },
    [shareToken, apiUrl]
  )

  return {
    fetchSiteInfo,
    getRunStatus,
  }
}
