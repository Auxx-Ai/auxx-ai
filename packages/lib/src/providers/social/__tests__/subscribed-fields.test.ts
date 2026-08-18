// packages/lib/src/providers/social/__tests__/subscribed-fields.test.ts

import { describe, expect, it } from 'vitest'
import { SOCIAL_SUBSCRIBED_FIELDS } from '../api'

/**
 * FB/IG plan WS5/WS6 — one field set, three arm sites.
 *
 * The provisioning hook, the provider's `setupWebhook`, and `recoverChannel`'s
 * re-arm all subscribe the same Page. If they disagree, a channel re-armed by the
 * silent-refresh path ends up subscribed to a NARROWER set than the one it
 * connected with — it looks connected and is deaf to half its events, which is the
 * hardest kind of channel bug to notice.
 */
describe('SOCIAL_SUBSCRIBED_FIELDS', () => {
  it('subscribes messages and postbacks on both channels', () => {
    for (const fields of Object.values(SOCIAL_SUBSCRIBED_FIELDS)) {
      const set = fields.split(',')
      expect(set).toContain('messages')
      expect(set).toContain('messaging_postbacks')
    }
  })

  it('does NOT subscribe feed/comments — comments are not ingested yet (WS10)', () => {
    // Subscribing early would deliver comment events to a route that drops them,
    // making the "we handle comments" question look answered when it isn't.
    for (const fields of Object.values(SOCIAL_SUBSCRIBED_FIELDS)) {
      expect(fields).not.toContain('feed')
      expect(fields).not.toContain('comments')
      expect(fields).not.toContain('mentions')
    }
  })

  it('has an entry for exactly the two social providers', () => {
    expect(Object.keys(SOCIAL_SUBSCRIBED_FIELDS).sort()).toEqual(['facebook', 'instagram'])
  })
})
