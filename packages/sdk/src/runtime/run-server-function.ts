// packages/sdk/src/runtime/run-server-function.ts

import {
  AuxxNoOrganizationConnectionError,
  AuxxNoUserConnectionError,
  AuxxUnexpectedTransportError,
  ServerFunctionError,
} from '../shared/errors.js'
import { Host } from './host.js'

/**
 * Result format from platform server execution.
 */
interface ServerFunctionResult {
  error?: string
  value?: {
    error?: string
    value?: string
  }
}

/**
 * Check if result is errored at top level.
 */
function isErrored(result: ServerFunctionResult): result is { error: string } {
  return 'error' in result && typeof result.error === 'string'
}

/**
 * Executes a server function by sending a request to the platform.
 *
 * This function is injected into globalThis and called by the bundler-generated
 * proxy modules when a .server import is invoked.
 *
 * @param moduleHash - Relative path to the server module (e.g., "actions/myAction.server")
 * @param args - Array of arguments to pass to the server function
 * @returns The deserialized result from the server function
 * @throws {AuxxNoUserConnectionError} When user is not connected
 * @throws {AuxxNoOrganizationConnectionError} When organization is not connected
 * @throws {AuxxUnexpectedTransportError} When transport/communication fails
 * @throws {ServerFunctionError} When server execution fails
 * @throws {Error} For other unexpected errors
 */
export async function runServerFunction(moduleHash: string, args: any[]): Promise<any> {
  console.log('[runServerFunction] Calling server function:', moduleHash, 'with args:', args)

  try {
    // Send request to platform to execute server function
    const result: ServerFunctionResult = await Host.sendRequest('run-server-function', {
      moduleHash,
      args: JSON.stringify(args),
    })

    // Handle top-level errors (transport/connection errors)
    if (isErrored(result)) {
      switch (result.error) {
        case 'no-user-connection':
          throw new AuxxNoUserConnectionError()
        case 'no-organization-connection':
          throw new AuxxNoOrganizationConnectionError()
        case 'unexpected-transport-error':
          throw new AuxxUnexpectedTransportError()
        default:
          throw new Error(result.error)
      }
    }

    // Handle execution errors (errors from the server function itself)
    if (result.value && 'error' in result.value && result.value.error) {
      let deserializedError: Error | undefined

      try {
        const errorObj = JSON.parse(result.value.error)
        if ('message' in errorObj) {
          deserializedError = new Error(errorObj.message)
          if ('stack' in errorObj) {
            deserializedError.stack = errorObj.stack
          }
          // Add validation details if present
          if ('details' in errorObj && errorObj.details) {
            console.error('[runServerFunction] Validation errors:', errorObj.details)
            ;(deserializedError as any).details = errorObj.details
          }
        }
      } catch {
        // Ignore JSON parse errors - use raw error string instead
      }

      if (deserializedError) {
        throw deserializedError
      }

      throw new ServerFunctionError(result.value.error)
    }

    // Deserialize successful result
    // Special case: undefined can't be JSON.parsed
    if (!result.value || !result.value.value || result.value.value === 'undefined') {
      return undefined
    }

    return JSON.parse(result.value.value)
  } catch (error: any) {
    console.error('[runServerFunction] Error executing server function:', error)
    throw error
  }
}
