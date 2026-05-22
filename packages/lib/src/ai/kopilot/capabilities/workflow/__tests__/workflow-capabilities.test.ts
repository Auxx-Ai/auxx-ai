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
  assignVariable: ReturnType<typeof vi.fn>
} {
  const assignVariable = vi.fn()
  const ctx = {
    organizationId: 'org-1',
    userId: 'user-1',
    sessionId: 'session-1',
    db: {} as ToolContext['db'],
    workflow: {
      nodeId: 'node-1',
      contextManager: { assignVariable },
    },
    ...overrides,
  } as ToolContext
  return { ctx, assignVariable }
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
  it('forwards (name, value) to ctx.workflow.contextManager.assignVariable and returns success', async () => {
    const { ctx, assignVariable } = makeCtx()
    const result = await runExecute({ name: 'foo', value: 42 }, ctx)

    expect(assignVariable).toHaveBeenCalledTimes(1)
    expect(assignVariable).toHaveBeenCalledWith('foo', 42)
    expect(result).toEqual({ success: true, output: { name: 'foo', value: 42 } })
  })

  it('returns success: false when ctx.workflow is missing (no throw)', async () => {
    const { ctx } = makeCtx({ workflow: undefined })
    const result = await runExecute({ name: 'foo', value: 42 }, ctx)

    expect(result.success).toBe(false)
    expect(result.output).toEqual({
      error: 'assign_variable called outside a workflow context',
    })
  })
})
