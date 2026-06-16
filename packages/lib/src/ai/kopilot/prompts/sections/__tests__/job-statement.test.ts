// packages/lib/src/ai/kopilot/prompts/sections/__tests__/job-statement.test.ts

import { describe, expect, it } from 'vitest'
import { makeCtx } from '../__test-helpers'
import { jobStatement } from '../job-statement'

describe('jobStatement', () => {
  it('interactive job mentions rich UI blocks', () => {
    const out = jobStatement.render(makeCtx({ runMode: 'interactive' }))
    expect(out).toContain('rich UI blocks')
  })

  it('autonomous job mentions audit trail', () => {
    const out = jobStatement.render(makeCtx({ runMode: 'autonomous' }))
    expect(out).toContain('audit trail')
  })

  it('customer audience is a customer reply, not an audit trail (autonomous email)', () => {
    const out = jobStatement.render(makeCtx({ runMode: 'autonomous', audience: 'customer' }))
    expect(out).toContain('customer')
    expect(out).not.toContain('audit trail')
    expect(out).not.toContain('by id')
  })

  it('customer audience on the interactive chat surface is also a customer reply', () => {
    const out = jobStatement.render(
      makeCtx({ runMode: 'interactive', surface: 'chat', audience: 'customer' })
    )
    expect(out).toContain('customer')
    expect(out).not.toContain('rich UI blocks')
  })
})
