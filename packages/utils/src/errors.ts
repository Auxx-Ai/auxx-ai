// packages/utils/src/errors.ts

/**
 * Extract a human-readable message from a caught value.
 *
 * `catch (error)` gives you `unknown` under `useUnknownInCatchVariables`, and the
 * repo answers that with `error instanceof Error ? error.message : String(error)`
 * inlined in ~450 places. This is that expression, named once.
 *
 * ```ts
 * catch (error) {
 *   logger.error('Sync failed', { error })            // logger takes `unknown` args — no helper needed
 *   throw new BadRequestError(getErrorMessage(error)) // but a `string` slot does
 * }
 * ```
 *
 * Note the first line: `@auxx/logger`'s methods are
 * `(message: string, ...args: unknown[])`, so an error belongs in the ARGS slot
 * raw — passing `getErrorMessage(error)` there would discard the stack. Reach for
 * this only where a `string` is genuinely required.
 *
 * Not to be confused with `parseError` in `apps/lambda/src/utils.ts`, which is
 * deliberately separate: it defaults the code to `EXECUTION_ERROR` and forwards
 * the structured `@auxx/sdk` error fields across the sandbox boundary, and that
 * app runs under Deno with only two dependencies on purpose.
 */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Coerce a caught value to an `Error`, preserving the original as `cause` when it
 * was not one. Use when an API demands an `Error` — prefer rethrowing the original
 * where you can, since wrapping costs you the original stack.
 */
export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error), { cause: error })
}
