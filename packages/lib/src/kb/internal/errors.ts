// @auxx/lib/kb/internal/errors.ts
import { createScopedLogger } from '@auxx/logger'
import { TRPCError } from '@trpc/server'

const logger = createScopedLogger('kb-service')

export function createNotFoundError(message: string): TRPCError {
  return new TRPCError({ code: 'NOT_FOUND', message })
}

/**
 * Convert an arbitrary thrown value into a TRPC error and log it. TRPCErrors
 * pass through unchanged so 404/400 callers get the right code at the wire.
 */
export function handleError(
  error: unknown,
  organizationId: string,
  logMessage: string,
  context: Record<string, unknown> = {}
): never {
  if (error instanceof TRPCError) throw error
  logger.error(logMessage, { error, organizationId, ...context })
  throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: logMessage, cause: error })
}

export { logger as kbLogger }
