// packages/lib/src/chat/agent/run-log.ts

import { type RunLogFilter, runLogPath, withRunLog } from '@auxx/logger/run-log'

/**
 * Scope prefixes considered relevant to a chat-conversation trace. We keep the
 * chat orchestration scopes (`process-chat-turn`, `chat-`, `procedure-`) AND the
 * agent-engine scopes (`agent-`, `kopilot-`) because a chat turn drives the real
 * agent engine — the agent's turn-by-turn reasoning, tool calls, and procedure
 * stepping are precisely what you want to inspect when debugging a live chat.
 * Everything else (provider clients, registry plumbing, unrelated cross-cutting
 * work) is dropped.
 *
 * Add a prefix here when introducing a new chat- or agent-domain module that
 * should appear in chat traces.
 */
const CHAT_SCOPE_PREFIXES = ['process-chat-turn', 'chat-', 'procedure-', 'agent-', 'kopilot-']

/**
 * Levels excluded from the chat trace. Debug/trace are useful for targeted local
 * debugging via console but produce too much noise in the per-turn file (full
 * message dumps, internal state snapshots, etc.).
 */
const EXCLUDED_LEVELS = new Set(['debug', 'trace'])

const chatRunLogFilter: RunLogFilter = ({ scope, level }) => {
  if (EXCLUDED_LEVELS.has(level)) return false
  return CHAT_SCOPE_PREFIXES.some((prefix) => scope.startsWith(prefix))
}

/**
 * Tee chat-relevant logs from `fn`'s async context to a per-thread file.
 * Dev only — callers should gate on NODE_ENV before invoking.
 *
 * The path, scope allowlist, and level threshold are all decided here so the
 * logger package stays domain-blind. Mirrors `withAgentRunLog`, but keyed on the
 * chat `Thread` (one file per turn) and bucketed under its own `chat-sessions`
 * root so live chat traces don't intermix with builder/trigger agent sessions.
 *
 * File layout: `<root>/.logs/chat-sessions/<YYYY-MM-DD>/<HH-mm-ss-SSSZ>__<threadId>.log`.
 * The root `.logs` is shared across apps (see `runLogPath`). Date-bucketed so a
 * day's turns sort lexically; thread id stays in the filename for grep +
 * multi-turn lookup. Colons replaced with hyphens so the names work on every
 * filesystem.
 */
export function withChatRunLog<T>(threadId: string, fn: () => T): T {
  const now = new Date()
  const datePart = now.toISOString().slice(0, 10) // YYYY-MM-DD
  const timePart = now.toISOString().slice(11, 23).replace(/[:.]/g, '-') // HH-mm-ss-SSS
  const logFile = runLogPath('chat-sessions', datePart, `${timePart}Z__${threadId}.log`)
  return withRunLog(threadId, logFile, fn, { filter: chatRunLogFilter })
}
