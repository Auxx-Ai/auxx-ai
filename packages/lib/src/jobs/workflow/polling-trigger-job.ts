// packages/lib/src/jobs/workflow/polling-trigger-job.ts

import { database as db, schema } from '@auxx/database'
import type { Job } from 'bullmq'
import { and, eq } from 'drizzle-orm'
import { createScopedLogger } from '../../logger'
import { PollingTriggerService } from '../../workflows/polling-trigger-service'
import { WorkflowRunStatus } from '../../workflows/types'
import { createWorkflowRun } from '../../workflows/workflow-execution-service'
import { getQueue, Queues } from '../queues'

const logger = createScopedLogger('polling-trigger-job')

export type PollingTriggerJobData = {
  workflowAppId: string
  organizationId: string
  nodeId: string
  appId: string
  triggerId: string
  installationId: string
  connectionId?: string
  triggerConfig: Record<string, unknown>
}

/**
 * Cancel the scheduler for a workflow that is no longer valid.
 */
async function cancelInvalidPollingScheduler(workflowAppId: string, reason: string): Promise<void> {
  try {
    const pollingTriggerService = new PollingTriggerService()
    await pollingTriggerService.unschedulePollingTrigger(workflowAppId)
    logger.warn('Cancelled polling scheduler for invalid workflow', { workflowAppId, reason })
  } catch (error) {
    logger.error('Failed to cancel polling scheduler', {
      workflowAppId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Load or create polling state for a workflow trigger.
 */
async function loadPollingState(workflowAppId: string, triggerId: string) {
  const existing = await db.query.PollingTriggerState.findFirst({
    where: and(
      eq(schema.PollingTriggerState.workflowAppId, workflowAppId),
      eq(schema.PollingTriggerState.triggerId, triggerId)
    ),
  })

  return {
    state: (existing?.state as Record<string, unknown>) ?? {},
    consecutiveErrors: existing?.consecutiveErrors ?? 0,
    backoffSkips: ((existing?.state as any)?.backoffSkips as number) ?? 0,
    id: existing?.id,
  }
}

/**
 * Persist updated polling state.
 */
async function updatePollingState(
  workflowAppId: string,
  triggerId: string,
  organizationId: string,
  updates: {
    state?: Record<string, unknown>
    lastPollAt?: Date
    lastPollStatus?: string
    lastPollError?: string | null
    consecutiveErrors?: number
  }
) {
  const existing = await db.query.PollingTriggerState.findFirst({
    where: and(
      eq(schema.PollingTriggerState.workflowAppId, workflowAppId),
      eq(schema.PollingTriggerState.triggerId, triggerId)
    ),
  })

  if (existing) {
    await db
      .update(schema.PollingTriggerState)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(schema.PollingTriggerState.id, existing.id))
  } else {
    await db.insert(schema.PollingTriggerState).values({
      workflowAppId,
      triggerId,
      organizationId,
      state: updates.state ?? {},
      lastPollAt: updates.lastPollAt,
      lastPollStatus: updates.lastPollStatus,
      lastPollError: updates.lastPollError,
      consecutiveErrors: updates.consecutiveErrors ?? 0,
      updatedAt: new Date(),
    })
  }
}

/**
 * BullMQ job handler: execute a polling trigger's execute function,
 * then dispatch any returned events through the existing app trigger pipeline.
 */
export async function executePollingTrigger(job: Job<PollingTriggerJobData>) {
  const {
    workflowAppId,
    organizationId,
    appId,
    triggerId,
    installationId,
    connectionId,
    triggerConfig,
  } = job.data

  logger.info('Executing polling trigger', {
    workflowAppId,
    appId,
    triggerId,
    jobId: job.id,
  })

  // 1. Validate workflow still exists + enabled, and fetch published workflow for error runs
  const workflowAppData = await db.query.WorkflowApp.findFirst({
    where: and(
      eq(schema.WorkflowApp.id, workflowAppId),
      eq(schema.WorkflowApp.organizationId, organizationId)
    ),
    columns: { id: true, enabled: true },
    with: { publishedWorkflow: true },
  })

  if (!workflowAppData) {
    await cancelInvalidPollingScheduler(workflowAppId, 'Workflow deleted')
    return { skipped: true, reason: 'Workflow deleted' }
  }

  if (!workflowAppData.enabled) {
    await cancelInvalidPollingScheduler(workflowAppId, 'Workflow disabled')
    return { skipped: true, reason: 'Workflow disabled' }
  }

  // 2. Load current polling state
  const pollingState = await loadPollingState(workflowAppId, triggerId)

  // 3. Exponential backoff after 10+ consecutive errors
  if (pollingState.consecutiveErrors >= 10) {
    const skipCount = pollingState.backoffSkips
    if (skipCount < 9) {
      await updatePollingState(workflowAppId, triggerId, organizationId, {
        state: { ...pollingState.state, backoffSkips: skipCount + 1 },
      })
      return { skipped: true, reason: `Backoff: attempt in ${9 - skipCount} cycles` }
    }
    // Reset skip counter — this cycle will attempt execution
    await updatePollingState(workflowAppId, triggerId, organizationId, {
      state: { ...pollingState.state, backoffSkips: 0 },
    })
  }

  // 4. Resolve org handle — needed for Lambda context and available in catch for error runs
  const org = await db.query.Organization.findFirst({
    where: eq(schema.Organization.id, organizationId),
    columns: { id: true, handle: true },
  })
  if (!org) {
    await cancelInvalidPollingScheduler(workflowAppId, 'Organization not found')
    return { skipped: true, reason: 'Organization not found' }
  }

  // 5. Invoke Lambda with polling trigger type
  let pollResult: { events: Record<string, unknown>[]; state: Record<string, unknown> }

  try {
    const { getInstallationDeployment } = await import('@auxx/services/app-installations')
    const { resolveAppConnectionForRuntime } = await import('@auxx/services/app-connections')
    const { prepareLambdaContext, invokeLambdaExecutor } = await import(
      '@auxx/services/lambda-execution'
    )

    const installationResult = await getInstallationDeployment({
      installationId,
      organizationHandle: org.handle,
      appId,
    })

    if (installationResult.isErr()) {
      throw new Error(`Failed to get installation: ${installationResult.error.message}`)
    }

    const { serverBundleSha, installation } = installationResult.value

    if (!serverBundleSha) {
      const bundleError = new Error('App does not have a server bundle') as Error & {
        code?: string
      }
      bundleError.code = 'NO_SERVER_BUNDLE'
      throw bundleError
    }

    // Resolve connection
    const connectionsResult = await resolveAppConnectionForRuntime({
      appId,
      organizationId,
      userId: undefined, // Polling triggers run without a user context
      connectionId,
    })

    const connections = connectionsResult.isOk() ? connectionsResult.value : {}

    const baseContext = prepareLambdaContext({
      appId,
      installationId: installation.id,
      organizationId,
      organizationHandle: org.handle,
      userId: undefined,
      userEmail: undefined,
      userName: undefined,
      userConnection: (connections as any).userConnection,
      organizationConnection: (connections as any).organizationConnection,
    })

    const lambdaResult = await invokeLambdaExecutor({
      caller: 'worker',
      payload: {
        type: 'polling-trigger',
        serverBundleSha,
        triggerId,
        triggerInput: triggerConfig,
        pollingState: pollingState.state,
        context: baseContext,
        timeout: 30000,
      },
    })

    if (lambdaResult.isErr()) {
      const lambdaError = new Error(
        `Lambda execution failed: ${lambdaResult.error.message}`
      ) as Error & { code?: string }
      lambdaError.code = lambdaResult.error.code
      throw lambdaError
    }

    const execResult = lambdaResult.value.execution_result
    pollResult = {
      events: execResult?.events ?? [],
      state: execResult?.state ?? {},
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorCode: string | undefined = error instanceof Error ? (error as any).code : undefined
    const newConsecutiveErrors = pollingState.consecutiveErrors + 1
    const isUnrecoverableError =
      errorCode === 'CONNECTION_REQUIRED' || errorCode === 'NO_SERVER_BUNDLE'

    // 1. FIRST: persist polling state — must not be blocked by run creation
    await updatePollingState(workflowAppId, triggerId, organizationId, {
      lastPollStatus: 'error',
      lastPollError: errorMessage,
      consecutiveErrors: newConsecutiveErrors,
    })

    // 2. Create FAILED run (best-effort) — only on first error + every 10th to avoid flooding
    //    For connection errors, always create on first occurrence (auto-pause stops further polls)
    const shouldCreateRun =
      isUnrecoverableError ||
      pollingState.consecutiveErrors === 0 ||
      newConsecutiveErrors % 10 === 0
    if (shouldCreateRun && workflowAppData.publishedWorkflow) {
      try {
        await createWorkflowRun(db, {
          workflow: workflowAppData.publishedWorkflow,
          organizationId,
          inputs: {
            _meta: {
              trigger_type: 'app-polling-trigger',
              app_id: appId,
              trigger_id: triggerId,
              triggered_at: new Date().toISOString(),
              failure_reason: 'Polling trigger failed before execution',
            },
          },
          mode: 'production',
          userId: null,
          status: WorkflowRunStatus.FAILED,
          error: classifyPollingError(errorMessage, errorCode),
          finishedAt: new Date(),
          elapsedTime: 0,
        })
      } catch (runError) {
        logger.warn('Failed to create error run for polling trigger', {
          workflowAppId,
          error: runError instanceof Error ? runError.message : String(runError),
        })
      }
    }

    // 3. Auto-pause on connection errors — expired/missing tokens won't self-heal
    if (isUnrecoverableError) {
      await db
        .update(schema.WorkflowApp)
        .set({ enabled: false, updatedAt: new Date() })
        .where(eq(schema.WorkflowApp.id, workflowAppId))

      await cancelInvalidPollingScheduler(workflowAppId, `Unrecoverable error: ${errorCode}`)

      logger.warn('Auto-paused workflow due to unrecoverable error', {
        workflowAppId,
        errorCode,
      })
    }

    logger.error('Polling trigger execute failed', {
      workflowAppId,
      triggerId,
      error: errorMessage,
    })
    throw error
  }

  // 6. Dispatch events before persisting state (see plan §4.5 step 7)
  if (pollResult.events.length > 0) {
    const appTriggerQueue = getQueue(Queues.appTriggerQueue)

    for (const event of pollResult.events) {
      const eventId = (event as any).eventId
        ? `poll-${triggerId}-${(event as any).eventId}`
        : `poll-${triggerId}-${Date.now()}-${Math.random().toString(36).slice(2)}`

      await appTriggerQueue.add('dispatchAppTrigger', {
        appInstallationId: installationId,
        appId,
        triggerId,
        connectionId,
        triggerData: event,
        eventId,
        organizationId,
      })
    }
  }

  // 7. Persist updated state after successful dispatch
  await updatePollingState(workflowAppId, triggerId, organizationId, {
    state: { ...pollingState.state, ...pollResult.state },
    lastPollAt: new Date(),
    lastPollStatus: pollResult.events.length > 0 ? 'success' : 'no_events',
    lastPollError: null,
    consecutiveErrors: 0,
  })

  logger.info('Polling trigger complete', {
    workflowAppId,
    triggerId,
    eventsDispatched: pollResult.events.length,
  })

  return { success: true, eventsDispatched: pollResult.events.length }
}

/**
 * Classify a polling error into a user-friendly plain text message.
 * The classified message is stored in WorkflowRun.error and rendered as-is in the UI.
 */
function classifyPollingError(rawError: string, errorCode?: string): string {
  if (errorCode === 'CONNECTION_REQUIRED') {
    return `Connection expired or not found — please reconnect your account in the workflow trigger settings.\n\nOriginal error: ${rawError}`
  }
  if (errorCode === 'NO_SERVER_BUNDLE') {
    return `App does not have a server bundle — please republish the app.\n\nOriginal error: ${rawError}`
  }
  if (/rate limit|429|too many requests/i.test(rawError)) {
    return `Rate limited by provider — will retry automatically.\n\nOriginal error: ${rawError}`
  }
  if (/timeout|ETIMEDOUT|ECONNREFUSED/i.test(rawError)) {
    return `Request timed out — will retry automatically.\n\nOriginal error: ${rawError}`
  }
  return `Polling trigger failed: ${rawError}`
}
