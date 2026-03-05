// packages/lib/src/jobs/workflow/polling-trigger-job.ts

import { database as db, schema } from '@auxx/database'
import type { Job } from 'bullmq'
import { and, eq } from 'drizzle-orm'
import { createScopedLogger } from '../../logger'
import { PollingTriggerService } from '../../workflows/polling-trigger-service'
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

  // 1. Validate workflow still exists + enabled
  const [workflowAppRow] = await db
    .select({
      id: schema.WorkflowApp.id,
      enabled: schema.WorkflowApp.enabled,
    })
    .from(schema.WorkflowApp)
    .where(
      and(
        eq(schema.WorkflowApp.id, workflowAppId),
        eq(schema.WorkflowApp.organizationId, organizationId)
      )
    )
    .limit(1)

  if (!workflowAppRow) {
    await cancelInvalidPollingScheduler(workflowAppId, 'Workflow deleted')
    return { skipped: true, reason: 'Workflow deleted' }
  }

  if (!workflowAppRow.enabled) {
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

  // 4. Invoke Lambda with polling trigger type
  let pollResult: { events: Record<string, unknown>[]; state: Record<string, unknown> }

  try {
    const { getInstallationDeployment } = await import('@auxx/services/app-installations')
    const { resolveAppConnectionForRuntime } = await import('@auxx/services/app-connections')
    const { prepareLambdaContext, invokeLambdaExecutor } = await import(
      '@auxx/services/lambda-execution'
    )

    // Resolve org handle for Lambda context
    const org = await db.query.Organization.findFirst({
      where: eq(schema.Organization.id, organizationId),
      columns: { id: true, handle: true },
    })
    if (!org) {
      await cancelInvalidPollingScheduler(workflowAppId, 'Organization not found')
      return { skipped: true, reason: 'Organization not found' }
    }

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
      throw new Error('App does not have a server bundle')
    }

    // Resolve connection
    const connectionsResult = await resolveAppConnectionForRuntime({
      appId,
      organizationId,
      userId: '', // Polling triggers run without a user context
      connectionId,
    })

    const connections = connectionsResult.isOk() ? connectionsResult.value : {}

    const baseContext = prepareLambdaContext({
      appId,
      installationId: installation.id,
      organizationId,
      organizationHandle: org.handle,
      userId: '',
      userEmail: '',
      userName: '',
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
      throw new Error(`Lambda execution failed: ${lambdaResult.error.message}`)
    }

    const execResult = lambdaResult.value.execution_result
    pollResult = {
      events: execResult?.events ?? [],
      state: execResult?.state ?? {},
    }
  } catch (error) {
    await updatePollingState(workflowAppId, triggerId, organizationId, {
      lastPollStatus: 'error',
      lastPollError: error instanceof Error ? error.message : String(error),
      consecutiveErrors: pollingState.consecutiveErrors + 1,
    })
    logger.error('Polling trigger execute failed', {
      workflowAppId,
      triggerId,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }

  // 5. Dispatch events before persisting state (see plan §4.5 step 7)
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

  // 6. Persist updated state after successful dispatch
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
