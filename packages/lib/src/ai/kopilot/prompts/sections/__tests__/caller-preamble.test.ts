// packages/lib/src/ai/kopilot/prompts/sections/__tests__/caller-preamble.test.ts

import type { ActorId } from '@auxx/types/actor'
import { describe, expect, it } from 'vitest'
import { makeCtx } from '../__test-helpers'
import { callerPreamble } from '../caller-preamble'

describe('callerPreamble', () => {
  it('returns null when currentUser is null', () => {
    expect(callerPreamble.render(makeCtx({ runMode: 'interactive' }))).toBeNull()
  })

  it('renders the caller line with actorId, role, and the mention link', () => {
    const out = callerPreamble.render(
      makeCtx({
        runMode: 'interactive',
        currentUser: {
          userId: 'u_1',
          actorId: 'user:u_1' as ActorId,
          name: 'Markus',
          email: 'm@example.com',
          role: 'admin',
        },
      })
    )
    expect(out).toContain('Markus <m@example.com>')
    expect(out).toContain('actorId `user:u_1`')
    expect(out).toContain('role admin')
    // The reason this section exists: the model must address the caller with
    // in-app link syntax, not a bare name.
    expect(out).toContain('[Markus](auxx://actor/user:u_1)')
  })
})
