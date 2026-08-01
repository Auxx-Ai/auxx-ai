// packages/lib/src/chat/agent/tools/__tests__/handoff.test.ts

import { describe, expect, it, vi } from 'vitest'
import { PROC_SIGNAL_KEY } from '../../../../agents/procedures/control-tools'
import type { ToolContext } from '../../../../ai/agent-framework/tool-context'
import { createHandoffTool } from '../handoff'

function makeCtx() {
  const write = vi.fn(async () => {})
  return { ctx: { context: { write } } as unknown as ToolContext, write }
}

describe('the unified `handoff` tool', () => {
  it('is named `handoff` and offered on the chat surface', () => {
    const tool = createHandoffTool()
    expect(tool.name).toBe('handoff')
    expect(tool.surfaces).toEqual(['chat'])
  })

  it('is pure intent — writes {kind:handoff} and does NOT flip the thread', async () => {
    const { ctx, write } = makeCtx()
    const r = await createHandoffTool().execute({ reason: 'cannot help' }, ctx)
    expect(write).toHaveBeenCalledWith(PROC_SIGNAL_KEY, { kind: 'handoff' })
    expect(r).toMatchObject({ success: true, output: { handedOff: true, reason: 'cannot help' } })
  })

  it('does not require a thread anchor (works in evals / with no subject)', async () => {
    const { ctx } = makeCtx()
    const r = await createHandoffTool().execute({}, ctx)
    expect(r).toMatchObject({ success: true })
  })
})
