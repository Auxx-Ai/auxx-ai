// apps/api/src/routes/workflows/share/runs.ts

/**
 * Run status route for shared workflows
 */

import { Hono } from 'hono'
import { verifyWorkflowPassport } from '@auxx/services/workflow-share'
import { getWorkflowRun } from '@auxx/services/workflows'

const runsRoute = new Hono()

/**
 * GET /api/v1/workflows/share/:shareToken/runs/:runId
 * Get run status and results
 */
runsRoute.get('/:runId', async (c) => {
  const shareToken = c.req.param('shareToken')
  const runId = c.req.param('runId')

  // Get passport from header
  const authHeader = c.req.header('authorization')
  const passportToken = authHeader?.replace('Bearer ', '')

  if (!passportToken) {
    return c.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Passport token required' } },
      401
    )
  }

  // Verify passport
  const passportResult = await verifyWorkflowPassport(passportToken)

  if (passportResult.isErr()) {
    const error = passportResult.error
    return c.json({ success: false, error: { code: error.code, message: error.message } }, 401)
  }

  const passport = passportResult.value

  // Verify share token matches
  if (passport.shareToken !== shareToken) {
    return c.json(
      {
        success: false,
        error: { code: 'INVALID_PASSPORT', message: 'Passport does not match workflow' },
      },
      401
    )
  }

  // Get run status
  const runResult = await getWorkflowRun({ runId })

  if (runResult.isErr()) {
    return c.json(
      { success: false, error: { code: 'RUN_NOT_FOUND', message: 'Run not found' } },
      404
    )
  }

  const run = runResult.value

  // Verify run belongs to the workflow
  if (run.workflowId !== passport.workflowId) {
    return c.json(
      { success: false, error: { code: 'RUN_NOT_FOUND', message: 'Run not found' } },
      404
    )
  }

  return c.json({
    success: true,
    data: {
      id: run.id,
      status: run.status,
      createdAt: run.createdAt,
      finishedAt: run.finishedAt,
      outputs: run.outputs,
      error: run.error,
    },
  })
})

export default runsRoute
