// packages/lib/src/ai/kopilot/prompts/sections/__tests__/caller-preamble.test.ts

import type { ActorId } from '@auxx/types/actor'
import { describe, expect, it } from 'vitest'
import { makeCtx } from '../__test-helpers'
import { callerPreamble } from '../caller-preamble'
import { sectionApplies } from '../render'

const caller = {
  userId: 'u_1',
  actorId: 'user:u_1' as ActorId,
  name: 'Markus',
  email: 'm@example.com',
  role: 'admin',
}

describe('callerPreamble', () => {
  it('returns null when currentUser is null', () => {
    expect(callerPreamble.render(makeCtx({ runMode: 'interactive' }))).toBeNull()
  })

  it('renders the caller line with actorId, role, and the mention link on builder', () => {
    const out = callerPreamble.render(
      makeCtx({ runMode: 'interactive', surface: 'builder', currentUser: caller })
    )
    expect(out).toContain('Markus <m@example.com>')
    expect(out).toContain('actorId `user:u_1`')
    expect(out).toContain('role admin')
    // The reason this section exists: the model must address the caller with
    // in-app link syntax, not a bare name.
    expect(out).toContain('[Markus](auxx://actor/user:u_1)')
  })

  for (const surface of ['chat', 'email', 'internal'] as const) {
    it(`renders identity as plain text on the ${surface} surface, without link syntax`, () => {
      const ctx = makeCtx({ runMode: 'interactive', surface, currentUser: caller })
      // Ungated: the section must not be filtered out before render.
      expect(sectionApplies(callerPreamble, ctx)).toBe(true)
      const out = callerPreamble.render(ctx)
      expect(out).toContain('Markus <m@example.com>')
      expect(out).toContain('actorId `user:u_1`')
      expect(out).not.toContain('auxx://actor/')
    })
  }

  it('does not apply on an autonomous run — there is no caller', () => {
    expect(
      sectionApplies(callerPreamble, makeCtx({ runMode: 'autonomous', currentUser: caller }))
    ).toBe(false)
  })

  it('does not apply for a customer audience — `currentUser` there is the agent, not a caller', () => {
    expect(
      sectionApplies(
        callerPreamble,
        makeCtx({
          runMode: 'interactive',
          surface: 'chat',
          audience: 'customer',
          currentUser: caller,
        })
      )
    ).toBe(false)
  })
})
