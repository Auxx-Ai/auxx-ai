// apps/web/src/server/api/unwrap.ts

import { TRPCError } from '@trpc/server'

/**
 * Unwrap a neverthrow `Result`, mapping an error to a `TRPCError`. On error,
 * throws `INTERNAL_SERVER_ERROR` with `"<message>: <error detail>"`. Structurally
 * typed so callers don't have to import neverthrow's `Result`.
 */
export function unwrap<T>(
  result: { isErr(): boolean; value?: T; error?: { message?: string } | Error },
  message: string
): T {
  if (result.isErr()) {
    const detail =
      (result.error as { message?: string } | undefined)?.message ?? String(result.error)
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `${message}: ${detail}`,
      cause: result.error,
    })
  }
  return result.value as T
}
