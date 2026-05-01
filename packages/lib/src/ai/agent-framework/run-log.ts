// packages/lib/src/ai/agent-framework/run-log.ts

import path from 'node:path'
import { type RunLogFilter, withRunLog } from '@auxx/logger/run-log'

/**
 * Scope prefixes considered relevant to an agent-session trace. Logs from any
 * other scope (provider clients, orchestrator, registry plumbing, unrelated
 * cross-cutting work) are dropped from the per-session file.
 *
 * Add a prefix here when introducing a new agent-domain or agent-tool module
 * that should appear in agent traces.
 */
const AGENT_SCOPE_PREFIXES = ['agent-', 'kopilot-']

/**
 * Levels excluded from the agent-session trace. Debug/trace are useful for
 * targeted local debugging via console but produce too much noise in the
 * per-turn file (full message dumps, internal state snapshots, etc.).
 */
const EXCLUDED_LEVELS = new Set(['debug', 'trace'])

const agentRunLogFilter: RunLogFilter = ({ scope, level }) => {
  if (EXCLUDED_LEVELS.has(level)) return false
  return AGENT_SCOPE_PREFIXES.some((prefix) => scope.startsWith(prefix))
}

/**
 * Tee agent-relevant logs from `fn`'s async context to a per-session file.
 * Dev only — callers should gate on NODE_ENV before invoking.
 *
 * The path, scope allowlist, and level threshold are all decided here so the
 * logger package stays domain-blind.
 *
 * File layout: `agent-sessions/<YYYY-MM-DD>/<HH-mm-ss-SSSZ>__<sessionId>.log`.
 * Date-bucketed so a day's runs sort lexically; session id stays in the
 * filename for grep + multi-turn lookup. Colons replaced with hyphens so the
 * names work on every filesystem.
 */
export function withAgentRunLog<T>(sessionId: string, fn: () => T): T {
  const now = new Date()
  const datePart = now.toISOString().slice(0, 10) // YYYY-MM-DD
  const timePart = now.toISOString().slice(11, 23).replace(/[:.]/g, '-') // HH-mm-ss-SSS
  const logFile = path.join(
    process.cwd(),
    '.logs',
    'agent-sessions',
    datePart,
    `${timePart}Z__${sessionId}.log`
  )
  return withRunLog(sessionId, logFile, fn, { filter: agentRunLogFilter })
}
