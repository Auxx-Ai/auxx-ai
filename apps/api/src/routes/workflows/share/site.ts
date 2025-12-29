// apps/api/src/routes/workflows/share/site.ts

/**
 * Site info route for shared workflows
 */

import { Hono } from 'hono'
import { getSharedWorkflowByToken } from '@auxx/services/workflow-share'

const siteRoute = new Hono()

/**
 * GET /api/v1/workflows/share/:shareToken/site
 * Get workflow site info and configuration for display
 */
siteRoute.get('/', async (c) => {
  const shareToken = c.req.param('shareToken')!
  const includeGraph = c.req.query('includeGraph') !== 'false'

  const result = await getSharedWorkflowByToken({
    shareToken,
    includeGraph,
  })

  if (result.isErr()) {
    const error = result.error

    if (error.code === 'WORKFLOW_NOT_FOUND' || error.code === 'WORKFLOW_SHARING_DISABLED') {
      return c.json(
        {
          success: false,
          error: { code: error.code, message: 'Workflow not found or sharing disabled' },
        },
        404
      )
    }

    return c.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch site info' } },
      500
    )
  }

  const workflow = result.value
  const config = workflow.config || {}

  // Format response with site display configuration
  return c.json({
    success: true,
    data: {
      shareToken: workflow.shareToken,
      workflowId: workflow.id,
      accessMode: workflow.accessMode,
      site: {
        title: config.title || workflow.name,
        description: config.description || workflow.description,
        about: config.about,
        logoUrl: config.logoUrl,
        brandName: config.brandName,
        hideBranding: config.hideBranding || false,
      },
      triggerConfig: {
        showWorkflowPreview: config.showWorkflowPreview ?? true,
        showInputForm: config.showInputForm ?? true,
        submitButtonText: config.submitButtonText || 'Run Workflow',
        successMessage: config.successMessage || 'Workflow executed successfully',
        showWorkflowDetails: config.showWorkflowDetails ?? false,
      },
      workflow: {
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        graph: workflow.graph,
        icon: workflow.icon,
      },
    },
  })
})

export default siteRoute
