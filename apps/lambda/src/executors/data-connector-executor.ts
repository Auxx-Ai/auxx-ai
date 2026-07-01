// apps/lambda/src/executors/data-connector-executor.ts

/**
 * Data connector executor for the Lambda runtime.
 *
 * Loads the bundled app's `__AUXX_DATA_CONNECTORS__` registry, looks up the
 * requested connector by id, and calls
 * `connector.execute({ streamKey, mode, state, connection, config })` for one
 * stream fetch. The app fetches from the provider and yields source-shaped
 * `ConnectorRecord` batches; the executor returns `{ records, nextState }`.
 *
 * The transport is request/response — one batch + cursor per invocation. The
 * platform re-invokes with the returned `nextState` to page. `execute` may
 * return `records` as an array or an async iterable; this executor materializes
 * iterables into an array for JSON transport (one page worth, bounded by the
 * app's own paging — the platform persists the cursor between calls).
 *
 * The app NEVER receives target defs, mappings, or entity write access. The
 * platform validates the returned records against the stream's source schema,
 * then maps + sinks them (the mapping layer + sink are platform-side).
 *
 * See plans/data-connectors/claude/03-connectors-and-sources.md §4.
 */

import {
  cleanupServerRuntimeHelpers,
  getCapturedLogs,
  injectServerRuntimeHelpers,
} from '../runtime-helpers/index.ts'
import type { ExecutionResult } from '../types.ts'
import { parseError } from '../utils.ts'
import type { DataConnectorExecutionEvent } from '../validator.ts'

/** Hard cap on records materialized from a single fetch (defensive against a runaway iterable). */
const MAX_RECORDS_PER_FETCH = 5000

export async function executeDataConnector(
  options: Omit<DataConnectorExecutionEvent, 'context' | 'serverBundleSha'> & {
    bundleCode: string
    context: any
  }
): Promise<ExecutionResult> {
  const {
    bundleCode,
    connectorId,
    streamKey,
    mode,
    state,
    config,
    triggerContext,
    context,
    timeout,
  } = options

  console.log('[DataConnectorExecutor] Starting execution:', { connectorId, streamKey, mode })

  injectServerRuntimeHelpers(context)

  try {
    // Mirror the tool/workflow-block executors — append a return so we extract
    // the connector registry from the bundle's top-level scope.
    const codeWithReturn = bundleCode + '\nreturn { __AUXX_DATA_CONNECTORS__ };'
    const fn = new Function(codeWithReturn)
    const result = fn()
    const connectors = result.__AUXX_DATA_CONNECTORS__

    if (!connectors) {
      throw new Error('Server bundle does not export data connectors (__AUXX_DATA_CONNECTORS__)')
    }

    const connector = connectors[connectorId]
    if (!connector) {
      throw new Error(`Data connector not found: ${connectorId}`)
    }
    if (typeof connector.execute !== 'function') {
      throw new Error(`Data connector ${connectorId} does not have an execute function`)
    }

    // Build the connection from the connection already resolved into the runtime
    // context. Connectors borrow the app's OAuth credential — surface only the
    // decrypted shape the SDK contract documents (value + fields + metadata).
    const resolved = context.organizationConnection ?? context.userConnection ?? null
    const connection = resolved
      ? {
          value: resolved.value,
          fields: resolved.fields,
          metadata: resolved.metadata,
        }
      : null

    const execPromise = (async () => {
      const fetchResult = await connector.execute({
        streamKey,
        mode,
        state,
        connection,
        config,
        triggerContext,
      })

      // Materialize records (array or async iterable) into a bounded array.
      const records: unknown[] = []
      const raw = fetchResult?.records
      if (Array.isArray(raw)) {
        for (const rec of raw) {
          if (records.length >= MAX_RECORDS_PER_FETCH) break
          records.push(rec)
        }
      } else if (
        raw &&
        typeof (raw as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function'
      ) {
        for await (const rec of raw as AsyncIterable<unknown>) {
          if (records.length >= MAX_RECORDS_PER_FETCH) break
          records.push(rec)
        }
      }

      return {
        records,
        nextState: fetchResult?.nextState ?? {},
      }
    })()

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Data connector fetch timed out after ${timeout}ms`)),
        timeout
      )
    )

    const fetchOutput = await Promise.race([execPromise, timeoutPromise])
    const consoleLogs = getCapturedLogs()

    console.log('[DataConnectorExecutor] Execution complete:', {
      connectorId,
      streamKey,
      recordCount: fetchOutput.records.length,
    })

    return {
      result: fetchOutput,
      metadata: { consoleLogs },
    }
  } catch (error: unknown) {
    getCapturedLogs() // Drain captured logs before re-throwing
    const { message } = parseError(error)
    console.error('[DataConnectorExecutor] Execution failed:', message)
    throw error
  } finally {
    cleanupServerRuntimeHelpers()
  }
}
