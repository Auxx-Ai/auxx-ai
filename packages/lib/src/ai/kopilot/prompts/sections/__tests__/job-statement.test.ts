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
})
