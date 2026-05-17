// packages/lib/src/ai/kopilot/prompts/sections/__tests__/active-refs.test.ts

import { describe, expect, it } from 'vitest'
import { makeCtx } from '../__test-helpers'
import { activeRefs } from '../active-refs'

describe('activeRefs', () => {
  it('returns null with no references', () => {
    expect(activeRefs.render(makeCtx({ runMode: 'interactive' }))).toBeNull()
    expect(activeRefs.render(makeCtx({ runMode: 'autonomous' }))).toBeNull()
  })

  it('interactive framing addresses the user', () => {
    const out = activeRefs.render(
      makeCtx({
        runMode: 'interactive',
        domainState: {
          context: {
            references: [{ kind: 'thread', id: 't1', label: 'Hello', origin: 'surface' }],
          },
        },
      })
    )
    expect(out).toContain('The user has these in focus right now')
    expect(out).toContain('- **thread** `t1` — "Hello" *(open on page)*')
  })

  it('autonomous framing references the trigger', () => {
    const out = activeRefs.render(
      makeCtx({
        runMode: 'autonomous',
        domainState: {
          context: {
            references: [{ kind: 'record', id: 'r:1', origin: 'mention' }],
          },
        },
      })
    )
    expect(out).toContain('in focus for this trigger run')
    expect(out).toContain('- **record** `r:1` *(@-mentioned)*')
  })

  it('preserves reference order', () => {
    const out = activeRefs.render(
      makeCtx({
        runMode: 'interactive',
        domainState: {
          context: {
            references: [
              { kind: 'thread', id: 't1', origin: 'surface' },
              { kind: 'record', id: 'r:1', origin: 'surface' },
            ],
          },
        },
      })
    )
    expect(out!.indexOf('`t1`')).toBeLessThan(out!.indexOf('`r:1`'))
  })
})
