// apps/api/src/routes/workflows/share/auth-status.ts

/**
 * Auth status route for shared workflows
 */

import { Hono } from 'hono'
import { getSharedWorkflowByToken, verifyWorkflowPassport } from '@auxx/services/workflow-share'

const authStatusRoute = new Hono()

/**
 * GET /api/v1/workflows/share/:shareToken/auth-status
 * Check authentication status for a shared workflow
 */
authStatusRoute.get('/', async (c) => {
  const shareToken = c.req.param('shareToken')

  // Get passport from query or header
  const passportToken = c.req.query('passport') || c.req.header('x-workflow-passport')

  let passportValid = false
  let endUserId: string | null = null
  let userId: string | null = null

  if (passportToken) {
    const passportResult = await verifyWorkflowPassport(passportToken)

    if (passportResult.isOk() && passportResult.value.shareToken === shareToken) {
      passportValid = true
      endUserId = passportResult.value.endUserId
      userId = passportResult.value.userId || null
    }
  }

  // Get workflow info
  const workflowResult = await getSharedWorkflowByToken({
    shareToken,
    requireEnabled: false,
  })

  const workflow = workflowResult.isOk() ? workflowResult.value : null

  return c.json({
    success: true,
    data: {
      shareToken,
      accessMode: workflow?.accessMode || 'unknown',
      hasValidPassport: passportValid,
      endUserId,
      userId,
      requiresAuth: workflow?.accessMode !== 'public',
      webEnabled: workflow?.webEnabled || false,
      apiEnabled: workflow?.apiEnabled || false,
    },
  })
})

export default authStatusRoute
