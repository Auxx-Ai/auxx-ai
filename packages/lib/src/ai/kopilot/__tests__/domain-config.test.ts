// packages/lib/src/ai/kopilot/__tests__/domain-config.test.ts

import { describe, expect, it } from 'vitest'
import { PROCEDURE_SLICE_KEY } from '../../../agents/procedures/persist'
import { CONTEXT_SLICE_KEY } from '../../agent-framework/context'
import { createKopilotDomainConfig } from '../domain-config'

describe('createKopilotDomainConfig — resetTurnDomainState (chat v9)', () => {
  it('drops the turn capture sub-slice but preserves var:* on a new turn', () => {
    const config = createKopilotDomainConfig()
    const domainState: Record<string, unknown> = {
      [CONTEXT_SLICE_KEY]: {
        vars: { plan: { steps: [] }, my_orders: [{ id: 'a' }] },
        turn: {
          tools: {
            get_order_info: [{ toolCallId: 'id1', toolName: 'get_order_info', result: {}, seq: 0 }],
          },
          calls: { id1: { toolCallId: 'id1', toolName: 'get_order_info', result: {}, seq: 0 } },
        },
      },
    }

    const next = config.resetTurnDomainState!(domainState)
    const slice = next[CONTEXT_SLICE_KEY] as { vars: unknown; turn?: unknown }

    expect(slice.vars).toEqual({ plan: { steps: [] }, my_orders: [{ id: 'a' }] })
    expect(slice.turn).toBeUndefined()
    // Original is not mutated.
    expect((domainState[CONTEXT_SLICE_KEY] as { turn?: unknown }).turn).toBeDefined()
  })

  it('returns the same domainState when there is no turn sub-slice to clear', () => {
    const config = createKopilotDomainConfig()
    const domainState: Record<string, unknown> = {
      [CONTEXT_SLICE_KEY]: { vars: { plan: { steps: [] } } },
    }

    const next = config.resetTurnDomainState!(domainState)
    expect(next).toBe(domainState)
  })

  it('returns the same domainState when there is no context slice at all', () => {
    const config = createKopilotDomainConfig()
    const domainState: Record<string, unknown> = { capabilities: {} }

    const next = config.resetTurnDomainState!(domainState)
    expect(next).toBe(domainState)
  })

  // Procedure-stack exemption (Phase 4 §2.1) — the stack is cross-turn control
  // state and must survive a fresh user turn exactly as `vars` does.
  const stack = { frames: [{ procedureId: 'p1', procedureVersionId: 'v1', cursor: 's1' }] }

  it('preserves the procedure slice while dropping the context turn sub-slice', () => {
    const config = createKopilotDomainConfig()
    const domainState: Record<string, unknown> = {
      [CONTEXT_SLICE_KEY]: {
        vars: { plan: { steps: [] } },
        turn: { tools: {}, calls: {} },
      },
      [PROCEDURE_SLICE_KEY]: stack,
    }

    const next = config.resetTurnDomainState!(domainState)

    // turn capture dropped, vars kept, procedure stack carried through.
    expect((next[CONTEXT_SLICE_KEY] as { turn?: unknown }).turn).toBeUndefined()
    expect((next[CONTEXT_SLICE_KEY] as { vars: unknown }).vars).toEqual({ plan: { steps: [] } })
    expect(next[PROCEDURE_SLICE_KEY]).toEqual(stack)
  })

  it('preserves the procedure slice when there is no context turn to clear', () => {
    const config = createKopilotDomainConfig()
    const domainState: Record<string, unknown> = { [PROCEDURE_SLICE_KEY]: stack }

    const next = config.resetTurnDomainState!(domainState)
    // No rebuild needed → same object, stack intact.
    expect(next).toBe(domainState)
    expect(next[PROCEDURE_SLICE_KEY]).toEqual(stack)
  })
})
