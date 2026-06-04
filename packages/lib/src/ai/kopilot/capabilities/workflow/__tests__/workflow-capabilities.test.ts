// packages/lib/src/ai/kopilot/capabilities/workflow/__tests__/workflow-capabilities.test.ts

import { describe, expect, it, vi } from 'vitest'
import type { ToolContext } from '../../../../agent-framework/tool-context'
import type { AgentToolResult } from '../../../../agent-framework/types'
import type { GetToolDeps, ToolDeps } from '../../types'
import { assignVariableTool } from '../assign-variable'
import {
  createNativeWorkflowCapabilities,
  WORKFLOW_AI_NODE_PAGE,
  WORKFLOW_NATIVE_TOOLSET_SLUG,
} from '../index'

// The workflow factory ignores deps — a bare stub matches the GetToolDeps
// signature without dragging the kopilot bootstrap into the test.
const getDeps: GetToolDeps = () => ({}) as unknown as ToolDeps

function makeCtx(overrides: Partial<ToolContext> = {}): {
  ctx: ToolContext
  write: ReturnType<typeof vi.fn>
} {
  const write = vi.fn()
  const ctx = {
    organizationId: 'org-1',
    userId: 'user-1',
    sessionId: 'session-1',
    db: {} as ToolContext['db'],
    // assign_variable now writes through ctx.context (chat v9). In a workflow
    // run this is the live ECM; here a minimal ContextManager stub.
    context: { write } as unknown as ToolContext['context'],
    ...overrides,
  } as ToolContext
  return { ctx, write }
}

async function runExecute(
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<AgentToolResult> {
  const tool = assignVariableTool(getDeps)
  const result = await tool.execute(args, ctx)
  // assign_variable is a buffered tool — no async generator path.
  if (Symbol.asyncIterator in (result as object)) {
    throw new Error('assign_variable must not return a streaming generator')
  }
  return result as AgentToolResult
}

describe('createNativeWorkflowCapabilities', () => {
  it('returns the workflow.ai-node page with exactly one tagged tool', () => {
    const capability = createNativeWorkflowCapabilities(getDeps)
    expect(capability.page).toBe(WORKFLOW_AI_NODE_PAGE)
    expect(capability.tools).toHaveLength(1)
    const [tool] = capability.tools
    expect(tool?.name).toBe('assign_variable')
    expect(tool?.toolsetSlug).toBe(WORKFLOW_NATIVE_TOOLSET_SLUG)
  })
})

describe('assignVariableTool', () => {
  it('writes (var:name, value) through ctx.context and returns success', async () => {
    const { ctx, write } = makeCtx()
    const result = await runExecute({ name: 'foo', value: 42 }, ctx)

    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith('var:foo', 42)
    expect(result).toEqual({ success: true, output: { name: 'foo', value: 42 } })
  })

  it('works outside a workflow run (writes to ctx.context regardless)', async () => {
    const { ctx, write } = makeCtx({ workflow: undefined })
    const result = await runExecute({ name: 'bar', value: 'x' }, ctx)

    expect(write).toHaveBeenCalledWith('var:bar', 'x')
    expect(result.success).toBe(true)
  })
})
