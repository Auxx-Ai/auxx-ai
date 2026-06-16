// packages/lib/src/agents/procedures/__tests__/control-tools.test.ts

import { describe, expect, it, vi } from 'vitest'
import type { ToolContext } from '../../../ai/agent-framework/tool-context'
import {
  advanceProcedure,
  awaitCustomer,
  digress,
  endProcedure,
  PROC_SIGNAL_KEY,
  PROCEDURE_CONTROL_TOOLS,
} from '../control-tools'

function makeCtx() {
  const write = vi.fn(async () => {})
  return { ctx: { context: { write } } as unknown as ToolContext, write }
}

describe('control tools record their signal', () => {
  it('advance_procedure writes {kind:advance}', async () => {
    const { ctx, write } = makeCtx()
    const r = await advanceProcedure.execute({}, ctx)
    expect(write).toHaveBeenCalledWith(PROC_SIGNAL_KEY, { kind: 'advance' })
    expect(r).toMatchObject({ success: true })
  })

  it('await_customer writes {kind:await}', async () => {
    const { ctx, write } = makeCtx()
    await awaitCustomer.execute({}, ctx)
    expect(write).toHaveBeenCalledWith(PROC_SIGNAL_KEY, { kind: 'await' })
  })

  it('digress writes {kind:digress, reason} from the arg', async () => {
    const { ctx, write } = makeCtx()
    await digress.execute({ reason: 'wants a refund' }, ctx)
    expect(write).toHaveBeenCalledWith(PROC_SIGNAL_KEY, {
      kind: 'digress',
      reason: 'wants a refund',
    })
  })

  it('digress coerces a missing reason to empty string', async () => {
    const { ctx, write } = makeCtx()
    await digress.execute({}, ctx)
    expect(write).toHaveBeenCalledWith(PROC_SIGNAL_KEY, { kind: 'digress', reason: '' })
  })

  it('end_procedure writes {kind:end}', async () => {
    const { ctx, write } = makeCtx()
    await endProcedure.execute({}, ctx)
    expect(write).toHaveBeenCalledWith(PROC_SIGNAL_KEY, { kind: 'end' })
  })

  it('exposes all four tools with unique names + required AgentToolDefinition fields', () => {
    // Handoff is no longer a control tool — the unified `handoff` tool covers it.
    expect(PROCEDURE_CONTROL_TOOLS).toHaveLength(4)
    const names = PROCEDURE_CONTROL_TOOLS.map((t) => t.name)
    expect(new Set(names).size).toBe(4)
    for (const t of PROCEDURE_CONTROL_TOOLS) {
      expect(t.name).toBeTruthy()
      expect(t.displayName).toBeTruthy()
      expect(t.description).toBeTruthy()
      expect(t.parameters).toBeTruthy()
      expect(typeof t.execute).toBe('function')
    }
  })
})
