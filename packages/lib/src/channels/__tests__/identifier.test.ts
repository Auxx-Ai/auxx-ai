// packages/lib/src/channels/__tests__/identifier.test.ts

import { describe, expect, it } from 'vitest'
import { getIdentifier } from '../internal/identifier'

/**
 * The channel label every settings/list surface renders. Meta social channels had
 * no case here at all, so a connected Facebook Page showed as a bare "Facebook
 * Integration" with the page name nowhere on the screen — the name was computed at
 * connect time, emitted on the `integration:connected` event, and then dropped.
 */
describe('getIdentifier — Meta social channels', () => {
  const row = (provider: string, metadata: unknown, name: string | null = null) =>
    ({ provider, email: null, name, metadata }) as Parameters<typeof getIdentifier>[0]

  it('labels a Facebook channel with its page name', () => {
    expect(
      getIdentifier(row('facebook', { pageId: '869289333164075', pageName: 'Auxx-Lift' }))
    ).toBe('Auxx-Lift')
  })

  it('prefers the Instagram handle over the page name', () => {
    // The IG channel is the account customers actually see; the linked Page name
    // is frequently different and would read as the wrong account.
    expect(
      getIdentifier(
        row('instagram', {
          pageId: '869289333164075',
          pageName: 'Auxx-Lift',
          instagramUsername: 'auxxlift',
        })
      )
    ).toBe('auxxlift')
  })

  it('reads from metadata, so channels connected before the name was persisted still resolve', () => {
    expect(getIdentifier(row('facebook', { pageName: 'Auxx-Lift' }, null))).toBe('Auxx-Lift')
  })

  it('still prefers an explicit email over social metadata', () => {
    const channel = {
      provider: 'google',
      email: 'support@auxx.ai',
      name: null,
      metadata: { pageName: 'ignored' },
    } as Parameters<typeof getIdentifier>[0]
    expect(getIdentifier(channel)).toBe('support@auxx.ai')
  })

  it('falls back to the row name, then undefined', () => {
    expect(getIdentifier(row('facebook', {}, 'Fallback'))).toBe('Fallback')
    expect(getIdentifier(row('facebook', {}, null))).toBeUndefined()
  })
})
