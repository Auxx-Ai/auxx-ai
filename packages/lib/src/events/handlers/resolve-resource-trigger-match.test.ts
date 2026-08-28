// packages/lib/src/events/handlers/resolve-resource-trigger-match.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  getCachedEntityDefId: vi.fn<(orgId: string, slug: string) => Promise<string | undefined>>(),
}))

vi.mock('../../cache', () => ({
  getCachedWorkflowAppsByTrigger: vi.fn(async () => []),
  // Re-implement the real helper's gate over a mocked cache read so the test
  // exercises the tier rule rather than the cache plumbing.
  canonicalizeEntityDefinitionId: async (orgId: string, value: string) => {
    const { isEntityDefinitionType } = await import('@auxx/types/resource')
    if (!isEntityDefinitionType(value)) return value
    return (await hoisted.getCachedEntityDefId(orgId, value)) ?? value
  },
}))

const ORG = 'org_1'
const TICKET_DEF = 'i5aezsg4bc6n8gof2uan3wcf'

// Every org has a `thread` EntityDefinition row, so the cache DOES resolve it —
// the gate is what must keep it slug-keyed.
const CACHE: Record<string, string> = {
  ticket: TICKET_DEF,
  contact: 'mzxt3cxyzhm3cbtgcbpmeir1',
  thread: 'thread_def_cuid',
  article: 'article_def_cuid',
}

const event = (type: string, data: Record<string, unknown> = {}) =>
  ({ type, data: { organizationId: ORG, ...data } }) as never

describe('resolveResourceTriggerMatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.getCachedEntityDefId.mockImplementation(async (_orgId, slug) => CACHE[slug])
  })

  // 30s, not the 10s default. This test pays for the whole
  // `trigger-resource-workflows` module graph on its dynamic import — ~6.1s on an
  // idle machine, and the rest of the file rides on it for free. Against a 10s
  // budget that tipped whenever the box was busy, and a timing failure on a loaded
  // machine reads exactly like a deterministic one: it has now cost three separate
  // false-alarm investigations. The number is the import, not the assertion.
  it('normalizes the legacy ticket slug to the org EntityDefinition id', async () => {
    const { resolveResourceTriggerMatch } = await import('./trigger-resource-workflows')

    const match = await resolveResourceTriggerMatch(
      event('ticket:created', { ticketId: 't1' }),
      ORG
    )

    // The picker stores the CUID; without this the strict compare in
    // `byTrigger` / `trigger-agents` never matches and the trigger is dead.
    expect(match?.entityDefinitionId).toBe(TICKET_DEF)
  }, 30_000)

  it('keeps the slug in matchIds so slug-keyed rows still fire', async () => {
    const { resolveResourceTriggerMatch } = await import('./trigger-resource-workflows')

    const match = await resolveResourceTriggerMatch(
      event('contact:created', { contactId: 'c1' }),
      ORG
    )

    // Regression: normalizing ONLY the event side broke a real workflow whose
    // column held 'contact' — the picker writes
    // `resource.entityDefinitionId || resourceType`, so both forms exist in
    // production. Filtering must accept either.
    expect(match?.matchIds).toEqual(['mzxt3cxyzhm3cbtgcbpmeir1', 'contact'])
  })

  it('collapses matchIds when there is nothing to normalize', async () => {
    const { resolveResourceTriggerMatch } = await import('./trigger-resource-workflows')

    const match = await resolveResourceTriggerMatch(
      event('entity:created', { entityDefinitionId: 'custom_def_cuid' }),
      ORG
    )

    expect(match?.matchIds).toEqual(['custom_def_cuid'])
  })

  it('normalizes contact events too', async () => {
    const { resolveResourceTriggerMatch } = await import('./trigger-resource-workflows')

    const match = await resolveResourceTriggerMatch(
      event('contact:deleted', { contactId: 'c1' }),
      ORG
    )

    expect(match?.entityDefinitionId).toBe('mzxt3cxyzhm3cbtgcbpmeir1')
  })

  it('leaves a modern payload entityDefinitionId untouched', async () => {
    const { resolveResourceTriggerMatch } = await import('./trigger-resource-workflows')

    const match = await resolveResourceTriggerMatch(
      event('entity:created', { entityDefinitionId: 'custom_def_cuid' }),
      ORG
    )

    expect(match?.entityDefinitionId).toBe('custom_def_cuid')
    expect(hoisted.getCachedEntityDefId).not.toHaveBeenCalled()
  })

  it('returns null for an event that is not a resource CRUD trigger', async () => {
    const { resolveResourceTriggerMatch } = await import('./trigger-resource-workflows')

    expect(await resolveResourceTriggerMatch(event('integration:connected'), ORG)).toBeNull()
  })

  it('falls back to the slug when the org has no definition for it', async () => {
    hoisted.getCachedEntityDefId.mockResolvedValue(undefined)
    const { resolveResourceTriggerMatch } = await import('./trigger-resource-workflows')

    const match = await resolveResourceTriggerMatch(
      event('ticket:created', { ticketId: 't1' }),
      ORG
    )

    expect(match?.entityDefinitionId).toBe('ticket')
  })

  it('leaves a tier-A slug alone even when the org has a definition row for it', async () => {
    const { resolveResourceTriggerMatch } = await import('./trigger-resource-workflows')

    // `thread` reaches this path only via a hand-written event today, but the
    // gate is what keeps it slug-keyed — see the dedicated unit test in
    // `cache/canonicalize-entity-definition-id.test.ts`.
    const match = await resolveResourceTriggerMatch(
      event('entity:created', { entityDefinitionId: 'thread' }),
      ORG
    )

    expect(match?.entityDefinitionId).toBe('thread')
  })
})
