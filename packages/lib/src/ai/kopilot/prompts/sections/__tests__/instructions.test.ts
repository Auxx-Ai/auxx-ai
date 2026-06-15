// packages/lib/src/ai/kopilot/prompts/sections/__tests__/instructions.test.ts

import { describe, expect, it } from 'vitest'
import { makeCtx } from '../__test-helpers'
import { instructions } from '../instructions'

describe('instructions', () => {
  it('interactive instructions reference auxx:* fences', () => {
    const out = instructions.render(makeCtx({ runMode: 'interactive' }))
    expect(out).toContain('## Instructions')
    expect(out).toContain('`auxx:*` fences')
  })

  it('autonomous instructions forbid fenced code blocks', () => {
    const out = instructions.render(makeCtx({ runMode: 'autonomous' }))
    expect(out).toContain('## Instructions')
    expect(out).toContain('Do not emit fenced code blocks')
  })

  it('customer-conversation instructions reply to the customer, not an audit trail', () => {
    const out = instructions.render(
      makeCtx({
        runMode: 'autonomous',
        triggerContext: { kind: 'customer_message', instructions: null, payload: {} },
      })
    )
    expect(out).toContain('## Instructions')
    expect(out).toContain('reply to the customer')
    expect(out).not.toContain('audit trail')
    expect(out).not.toContain('by id')
  })
})
