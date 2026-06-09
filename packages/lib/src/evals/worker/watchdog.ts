// packages/lib/src/evals/worker/watchdog.ts
//
// Periodic watchdog: mark abandoned `queued`/`running` eval runs `timed_out`
// (running runs whose heartbeat went stale, or queued runs never claimed). Runs
// on the maintenance schedule. See plans/evals/phase-1-agent-simulation.md §1.9.

import { createScopedLogger } from '@auxx/logger'
import type { JobContext } from '../../jobs/types'
import { markStaleEvalRunsTimedOut } from '../lifecycle'

const logger = createScopedLogger('worker:eval-watchdog')

export const EVAL_WATCHDOG_JOB_NAME = 'evalRunWatchdog'

/** Default staleness window — a run with no heartbeat / never-claimed for this long is dead. */
const DEFAULT_STALE_AFTER_MS = 5 * 60 * 1000

export async function evalRunWatchdog(
  ctx: JobContext<{ staleAfterMs?: number } | undefined>
): Promise<void> {
  const staleAfterMs = ctx.data?.staleAfterMs ?? DEFAULT_STALE_AFTER_MS
  const olderThan = new Date(Date.now() - staleAfterMs)
  const result = await markStaleEvalRunsTimedOut({ olderThan })
  if (result.isErr()) {
    logger.error('Eval watchdog scan failed', { error: result.error.message })
    return
  }
  if (result.value > 0) {
    logger.info('Timed out stale eval runs', { count: result.value })
  }
}
