// apps/api/src/routes/workflows/public.ts

/**
 * Public workflow routes (no authentication required)
 */

import { hydrateGraph } from '@auxx/lib/workflow-engine/client'
import { getPublicWorkflowApp } from '@auxx/services/workflows'
import { Hono } from 'hono'

/** Environment variable type for sanitization */
interface EnvVar {
  id: string
  name: string
  type?: string
  value?: string | number | boolean | string[]
}

/** Sanitized environment variable (without value) */
interface SanitizedEnvVar {
  id: string
  name: string
  type: string
}

/**
 * Sanitize environment variables for public API
 * Returns only id, name, and type - never the actual values
 */
function sanitizeEnvVarsForPublic(envVars: EnvVar[] | null | undefined): SanitizedEnvVar[] {
  if (!envVars || !Array.isArray(envVars)) return []

  return envVars.map((envVar) => ({
    id: envVar.id,
    name: envVar.name,
    type: envVar.type || 'string',
  }))
}

/**
 * Public workflows Hono app (no auth context needed)
 */
const publicWorkflows = new Hono()

/**
 * GET /api/v1/workflows/public/:id
 * Fetch a public workflow for embedding/viewing
 */
publicWorkflows.get('/public/:id', async (c) => {
  const workflowId = c.req.param('id')

  const result = await getPublicWorkflowApp({
    workflowAppId: workflowId,
  })

  if (result.isErr()) {
    const error = result.error

    if (error.code === 'WORKFLOW_APP_NOT_FOUND' || error.code === 'WORKFLOW_NOT_PUBLISHED') {
      return c.json(
        {
          success: false,
          error: {
            code: error.code,
            message: 'Workflow not found or not public',
          },
        },
        404
      )
    }

    // Database error
    return c.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch workflow',
        },
      },
      500
    )
  }

  const { workflowApp, publishedWorkflow } = result.value

  return c.json({
    success: true,
    data: {
      id: workflowApp.id,
      name: workflowApp.name,
      description: workflowApp.description,
      updatedAt: workflowApp.updatedAt,
      version: publishedWorkflow.version,
      // Hydrated, not raw. This is a DOCUMENTED EXTERNAL RESPONSE BODY (plan 23
      // §7), and hydration is what keeps it byte-compatible with what callers
      // see today: once the write seams store canonical documents, the column
      // no longer carries `node.type`, the derived `edge.data.*` set or the
      // default handles, and a raw passthrough would silently change the public
      // shape. `@auxx/services` is tier 2 and cannot import `@auxx/lib`, so the
      // hydration for this seam lives here at the app layer rather than in
      // `get-public-workflow-app.ts`.
      graph: hydrateGraph(publishedWorkflow.graph as never),
      envVars: sanitizeEnvVarsForPublic(publishedWorkflow.envVars as EnvVar[] | null | undefined),
    },
  })
})

export default publicWorkflows
