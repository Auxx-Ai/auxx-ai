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
 */
export function withAgentRunLog<T>(sessionId: string, fn: () => T): T {
  const logFile = path.join(
    process.cwd(),
    '.logs',
    'agent-sessions',
    sessionId,
    `${Date.now()}.log`
  )
  return withRunLog(sessionId, logFile, fn, { filter: agentRunLogFilter })
}
