// packages/lib/src/ai/kopilot/prompts/sections/__tests__/members-vs-contacts.test.ts

import { describe, expect, it } from 'vitest'
import { makeCtx } from '../__test-helpers'
import { membersVsContacts } from '../members-vs-contacts'

describe('membersVsContacts', () => {
  it('returns null when list_members is not registered', () => {
    expect(membersVsContacts.render(makeCtx({ runMode: 'interactive' }))).toBeNull()
  })

  it('renders when list_members is registered', () => {
    const out = membersVsContacts.render(
      makeCtx({ runMode: 'interactive', toolNames: new Set(['list_members']) })
    )
    expect(out).toContain('## Members vs contacts')
  })
})
