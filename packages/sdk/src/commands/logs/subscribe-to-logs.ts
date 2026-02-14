// packages/sdk/src/commands/logs/subscribe-to-logs.ts

import { api } from '../../api/api.js'
import { complete, isComplete } from '../../errors.js'
import type { LogEvent } from './log-event.js'
import { LogsBuffer } from './logs-buffer.js'

/**
 * Subscription error types
 */
export type LogSubscriptionError =
  | { code: 'FETCH_LOGS_ERROR'; error: unknown }
  | { code: 'POLLING_STOPPED' }

/**
 * Log event handler - called for each log event
 */
type LogEventHandler = (event: LogEvent) => void

/**
 * Log subscription interface
 */
export interface LogSubscription {
  unsubscribe: () => Promise<void>
}

/**
 * Polling configuration
 */
const POLL_INTERVAL_MS = 1000 // 1 second
const BUFFER_DELAY_MS = 200 // 200ms buffer
const MAX_LOGS_PER_POLL = 100

/**
 * Subscribe to logs via HTTP polling
 * Logs are already flattened by the backend
 */
export async function subscribeToLogs(
  params: {
    organizationHandle: string
    appSlug: string
  },
  onLog: LogEventHandler
) {
  const logsBuffer = new LogsBuffer(BUFFER_DELAY_MS)

  // Register buffer listener to forward events to handler
  logsBuffer.listen((events) => {
    events.forEach(onLog)
  })

  let isActive = true
  let pollTimeout: NodeJS.Timeout | null = null
  let newestTimestamp: string | undefined
  let seenLogIds = new Set<string>()
  let isFirstPoll = true

  /**
   * Poll for new logs
   */
  const poll = async (): Promise<void> => {
    if (!isActive) return

    try {
      // Fetch logs using cursor-based pagination
      // For first poll, get recent logs. For subsequent polls, use newest timestamp as cursor
      const result = await api.fetchAppLogs({
        organizationHandle: params.organizationHandle,
        appSlug: params.appSlug,
        cursor: newestTimestamp,
        limit: MAX_LOGS_PER_POLL,
      })

      if (isComplete(result)) {
        const { logs, newestTimestamp: newNewest } = result.value

        if (isFirstPoll) {
          // First poll: add all logs and track their IDs
          for (const log of logs) {
            logsBuffer.add(log)
            seenLogIds.add(log.id)
          }
          isFirstPoll = false
        } else {
          // Subsequent polls: only add logs we haven't seen before
          for (const log of logs) {
            if (!seenLogIds.has(log.id)) {
              logsBuffer.add(log)
              seenLogIds.add(log.id)
            }
          }
        }

        // Update newest timestamp if we got a newer one
        if (newNewest && (!newestTimestamp || newNewest > newestTimestamp)) {
          newestTimestamp = newNewest
        }

        // Limit the size of seenLogIds to prevent memory issues
        // Keep only the most recent 1000 log IDs
        if (seenLogIds.size > 1000) {
          const idsArray = Array.from(seenLogIds)
          seenLogIds = new Set(idsArray.slice(-1000))
        }
      } else {
        // Log error but continue polling
        process.stderr.write(`Warning: Failed to fetch logs: ${result.error.code}\n`)
      }
    } catch (error) {
      // Log error but continue polling
      process.stderr.write(`Warning: Error during log polling: ${error}\n`)
    }

    // Schedule next poll
    if (isActive) {
      pollTimeout = setTimeout(poll, POLL_INTERVAL_MS)
    }
  }

  // Start polling
  poll()

  return complete({
    unsubscribe: async () => {
      isActive = false

      if (pollTimeout) {
        clearTimeout(pollTimeout)
        pollTimeout = null
      }

      logsBuffer.close()
    },
  })
}
