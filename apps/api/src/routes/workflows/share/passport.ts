// apps/api/src/routes/workflows/share/passport.ts

/**
 * Passport issuance route for shared workflows
 */

import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import {
  getSharedWorkflowByToken,
  getOrCreateEndUser,
  validateWorkflowAccess,
  issueWorkflowPassport,
} from '@auxx/services/workflow-share'
import { validateSessionFromCookies } from '../../../lib/session-validator'

const passportRoute = new Hono()

/**
 * GET /api/v1/workflows/share/:shareToken/passport
 * Issue or refresh passport token for workflow access
 */
passportRoute.get('/', async (c) => {
  const shareToken = c.req.param('shareToken')

  if (!shareToken) {
    return c.json(
      { success: false, error: { code: 'INVALID_REQUEST', message: 'Share token is required' } },
      400
    )
  }

  // Get workflow by share token
  const workflowResult = await getSharedWorkflowByToken({ shareToken })

  if (workflowResult.isErr()) {
    const error = workflowResult.error

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
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch workflow' } },
      500
    )
  }

  const workflow = workflowResult.value

  // Get or create session ID from cookie
  let sessionId = getCookie(c, 'auxx_session_id')

  if (!sessionId) {
    sessionId = randomUUID()
  }

  // Validate user session if present (for organization access mode)
  const session = await validateSessionFromCookies(c)
  const userId = session?.userId

  // Check access (for non-public workflows)
  const accessResult = await validateWorkflowAccess({
    workflow,
    userId,
  })

  if (accessResult.isErr()) {
    const error = accessResult.error

    if (error.code === 'ACCESS_DENIED') {
      return c.json(
        {
          success: false,
          error: { code: error.code, message: error.message },
          requiresAuth: true,
          accessMode: error.accessMode,
        },
        401
      )
    }

    return c.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Access check failed' } },
      500
    )
  }

  // Get or create end user (link to authenticated user if present)
  const endUserResult = await getOrCreateEndUser({
    workflowAppId: workflow.id,
    identification: {
      sessionId,
      userId,
      metadata: {
        userAgent: c.req.header('user-agent'),
        ip: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
      },
    },
  })

  if (endUserResult.isErr()) {
    return c.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to create session' } },
      500
    )
  }

  const endUser = endUserResult.value

  // Issue passport
  const passportResult = await issueWorkflowPassport({
    endUserId: endUser.id,
    shareToken: workflow.shareToken,
    workflowId: workflow.id,
    organizationId: workflow.organizationId,
    accessMode: workflow.accessMode,
    userId: endUser.userId,
    externalId: endUser.externalId,
  })

  if (passportResult.isErr()) {
    return c.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to issue passport' } },
      500
    )
  }

  const passport = passportResult.value

  // Set session cookie
  setCookie(c, 'auxx_session_id', sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  })

  return c.json({
    success: true,
    data: {
      passport: passport.token,
      endUserId: endUser.id,
      userId: endUser.userId,
      expiresIn: passport.expiresIn,
    },
  })
})

export default passportRoute
