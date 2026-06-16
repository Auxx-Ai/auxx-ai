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

  it('customer audience replies to the customer, not an audit trail', () => {
    const out = instructions.render(makeCtx({ runMode: 'autonomous', audience: 'customer' }))
    expect(out).toContain('## Instructions')
    expect(out).toContain('reply to the customer')
    expect(out).not.toContain('audit trail')
    expect(out).not.toContain('by id')
  })

  it('customer audience forbids naming a failed tool/integration or error code', () => {
    const out = instructions.render(makeCtx({ runMode: 'interactive', audience: 'customer' }))
    expect(out).toContain('do not tell the customer a tool/integration failed')
    expect(out).toContain('quote an error code')
  })
})
