// packages/lib/src/evals/worker/run-log.ts

import path from 'node:path'
import { type RunLogFilter, withRunLog } from '@auxx/logger/run-log'

/**
 * Scope prefixes considered relevant to an eval-run trace. We keep both the eval
 * orchestration scopes (`eval-`, `worker:eval-`) AND the agent-engine scopes
 * (`agent-`, `kopilot-`) because an eval run drives the real agent engine — the
 * agent's turn-by-turn reasoning is precisely what you want to inspect when
 * developing and debugging a simulation. Everything else (provider clients,
 * registry plumbing, unrelated cross-cutting work) is dropped.
 *
 * Add a prefix here when introducing a new eval or agent-domain module that
 * should appear in eval-run traces.
 */
const EVAL_SCOPE_PREFIXES = ['eval-', 'worker:eval-', 'agent-', 'kopilot-']

/**
 * Levels excluded from the eval-run trace. Debug/trace are useful for targeted
 * local debugging via console but produce too much noise in the per-run file
 * (full message dumps, internal state snapshots, etc.).
 */
const EXCLUDED_LEVELS = new Set(['debug', 'trace'])

const evalRunLogFilter: RunLogFilter = ({ scope, level }) => {
  if (EXCLUDED_LEVELS.has(level)) return false
  return EVAL_SCOPE_PREFIXES.some((prefix) => scope.startsWith(prefix))
}

/**
 * Tee eval-relevant logs from `fn`'s async context to a per-run file.
 * Dev only — callers should gate on NODE_ENV before invoking.
 *
 * The path, scope allowlist, and level threshold are all decided here so the
 * logger package stays domain-blind. Mirrors `withAgentRunLog` so eval traces
 * sit alongside agent-session traces under `.logs`.
 *
 * File layout: `eval-runs/<YYYY-MM-DD>/<HH-mm-ss-SSSZ>__<runId>.log`.
 * Date-bucketed so a day's runs sort lexically; run id stays in the filename for
 * grep + cross-reference with the persisted run row. Colons replaced with
 * hyphens so the names work on every filesystem.
 */
export function withEvalRunLog<T>(runId: string, fn: () => T): T {
  const now = new Date()
  const datePart = now.toISOString().slice(0, 10) // YYYY-MM-DD
  const timePart = now.toISOString().slice(11, 23).replace(/[:.]/g, '-') // HH-mm-ss-SSS
  const logFile = path.join(
    process.cwd(),
    '.logs',
    'eval-runs',
    datePart,
    `${timePart}Z__${runId}.log`
  )
  return withRunLog(runId, logFile, fn, { filter: evalRunLogFilter })
}
