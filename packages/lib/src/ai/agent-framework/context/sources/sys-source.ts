// packages/lib/src/ai/agent-framework/context/sources/sys-source.ts

import type { ToolContext } from '../../tool-context'

/**
 * The read-only `sys:*` source — system values drawn from the `ToolContext`.
 *
 * `now` is captured once at construction so every `sys:now` read within a turn
 * returns the same timestamp (the store is rebuilt each turn / on resume). In
 * Phase 1 `agentName`/`now` may be absent on `ctx`; they're populated at every
 * ctx-build site in Phase 2, with `now` falling back to capture-time here.
 */
export function createSysSource(ctx: ToolContext): (key: string) => unknown {
  const now = ctx.now ?? Date.now()
  return (key) => {
    switch (key) {
      case 'userId':
        return ctx.userId
      case 'organizationId':
        return ctx.organizationId
      case 'agentName':
        return ctx.agentName
      case 'now':
        return now
      default:
        return undefined
    }
  }
}
