// packages/lib/src/ai/agent-framework/__test-helpers.ts
//
// Shared test-only helpers for exercising `AgentToolDefinition`s.
//
// Two things every tool test needs and nothing provided before:
//
//  1. A `ToolContext`. Tools receive a `ToolContext`, not an `AgentDeps` —
//     `db` and `context` are required on top. Tests that hand-rolled an
//     `AgentDeps` literal were passing an incomplete context.
//  2. A way to await `execute()`. Its return type is
//     `Promise<AgentToolResult> | AsyncGenerator<ToolProgressPayload, AgentToolResult, void>`,
//     so `(await tool.execute(...)).success` does not typecheck — the union has
//     to be narrowed and the streaming branch drained.

import type { Database } from '@auxx/database'
import type { ContextManager } from './context/context-manager'
import type { ToolContext } from './tool-context'
import type { AgentToolDefinition, AgentToolResult, ToolProgressPayload } from './types'

/** In-memory {@link ContextManager} — reads back whatever was written. */
export function createContextManagerMock(initial: Record<string, unknown> = {}): ContextManager {
  const store = new Map<string, unknown>(Object.entries(initial))
  const manager: ContextManager = {
    read: async (ref) => store.get(String(ref)),
    interpolate: async (text) => text,
    write: async (ref, value) => {
      store.set(String(ref), value)
    },
    captureToolResult: () => {},
    list: () => [],
  }
  return manager
}

/**
 * Build a {@link ToolContext} for a tool test. Defaults cover the identity
 * fields every tool reads; pass overrides for anything the case asserts on.
 */
export function createToolContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    organizationId: 'org-1',
    userId: 'u-1',
    sessionId: 's-1',
    db: {} as Database,
    context: createContextManagerMock(),
    ...overrides,
  }
}

function isAsyncGenerator(
  value: unknown
): value is AsyncGenerator<ToolProgressPayload, AgentToolResult, void> {
  return typeof (value as AsyncGenerator | undefined)?.[Symbol.asyncIterator] === 'function'
}

/**
 * Invoke a tool and return its final {@link AgentToolResult}, draining the
 * streaming variant if the tool returns a generator. Progress payloads are
 * discarded — use {@link runToolWithProgress} when a case asserts on them.
 */
export async function runTool(
  tool: Pick<AgentToolDefinition, 'execute'>,
  args: Record<string, unknown>,
  ctx: ToolContext = createToolContext()
): Promise<AgentToolResult> {
  const { result } = await runToolWithProgress(tool, args, ctx)
  return result
}

/** As {@link runTool}, but also returns every progress payload yielded. */
export async function runToolWithProgress(
  tool: Pick<AgentToolDefinition, 'execute'>,
  args: Record<string, unknown>,
  ctx: ToolContext = createToolContext()
): Promise<{ result: AgentToolResult; progress: ToolProgressPayload[] }> {
  const returned = tool.execute(args, ctx)
  if (!isAsyncGenerator(returned)) return { result: await returned, progress: [] }

  const progress: ToolProgressPayload[] = []
  for (;;) {
    const step = await returned.next()
    if (step.done) return { result: step.value, progress }
    progress.push(step.value)
  }
}
