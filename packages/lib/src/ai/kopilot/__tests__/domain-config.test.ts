// packages/lib/src/ai/kopilot/__tests__/domain-config.test.ts

import { describe, expect, it } from 'vitest'
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
})
