// packages/lib/src/ai/kopilot/agents/__tests__/caller-timezone.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentDeps, AgentState } from '../../../agent-framework/types'
import { fixtureDomainState, fixtureTools } from '../../prompts/__test-fixtures'
import type { KopilotDomainState } from '../../types'

/**
 * The caller's `User.preferredTimezone` reaching the `now` prompt clock.
 *
 * The wiring is deliberately thin (org `members` cache projection → one field on
 * the `buildKopilotPrompt` args), and every interesting case is a *missing*
 * value, so these assertions are all about what the fallback does rather than
 * about the formatting — `sections/__tests__/now.test.ts` owns the rendering.
 */

/** Mutable stand-in for one row of the org `members` cache. */
let cachedMember: Record<string, unknown> | null = null

vi.mock('../../../../cache/org-cache-helpers', () => ({
  getCachedResources: async () => [],
  getCachedKbCatalog: async () => [],
  getCachedMembersByUserIds: async () => (cachedMember ? [cachedMember] : []),
}))

vi.mock('../../../../cache/integration-catalog', () => ({
  getCachedIntegrationCatalog: async () => [],
}))

import { createKopilotAgent } from '../agent'

const deps: AgentDeps = {
  organizationId: 'org_1',
  userId: 'u_42',
  sessionId: 's_1',
}

const state: AgentState<KopilotDomainState> = {
  messages: [],
  domainState: fixtureDomainState,
}

/** A `members` row with whatever `user` projection the test wants to simulate. */
function member(user: Record<string, unknown> | null) {
  return {
    id: 'm_1',
    userId: 'u_42',
    organizationId: 'org_1',
    role: 'ADMIN',
    seatType: 'full',
    status: 'ACTIVE',
    onChatDuty: false,
    permissionProfileId: null,
    user,
  }
}

async function renderPrompt(): Promise<string> {
  const agent = createKopilotAgent({ tools: fixtureTools })
  const [system] = await agent.buildMessages(state, deps)
  return String(system?.content ?? '')
}

describe('Kopilot clock — caller timezone', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-04T09:07:00.000Z'))
    cachedMember = null
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("renders the caller's own zone, and the local calendar date with it", async () => {
    // 09:07 UTC is 20:07 the same day in Sydney — the point of threading a zone
    // is that a "yesterday" resolved off this line lands in the caller's day.
    cachedMember = member({ id: 'u_42', name: 'Markus', preferredTimezone: 'Australia/Sydney' })
    const out = await renderPrompt()
    expect(out).toContain('timezone **Australia/Sydney**')
    expect(out).toContain('Wednesday, 4 March 2026, 20:07')
  })

  it('renders UTC for a member who never set a zone', async () => {
    cachedMember = member({ id: 'u_42', name: 'Markus', preferredTimezone: null })
    expect(await renderPrompt()).toContain('timezone **UTC**')
  })

  it('renders UTC on a pre-v2 cached blob that has no timezone key at all', async () => {
    // The `members` key was bumped to v2 for this field, but `undefined` stays a
    // reachable state (hand-written blobs, a rolled-back writer), and it must
    // coalesce to UTC rather than fall through to the host clock.
    cachedMember = member({ id: 'u_42', name: 'Markus' })
    expect(await renderPrompt()).toContain('timezone **UTC**')
  })

  it('renders UTC when the stored zone is not a real IANA zone', async () => {
    cachedMember = member({ id: 'u_42', name: 'Markus', preferredTimezone: 'Mars/Olympus' })
    expect(await renderPrompt()).toContain('timezone **UTC**')
  })

  it('renders UTC when there is no caller at all (autonomous run)', async () => {
    cachedMember = null
    const out = await renderPrompt()
    expect(out).toContain('timezone **UTC**')
    // The section must still render — a missing caller drops the preamble, not
    // the clock.
    expect(out).toContain('## Current date and time')
  })
})
