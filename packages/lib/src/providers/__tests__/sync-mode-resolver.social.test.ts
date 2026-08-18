// packages/lib/src/providers/__tests__/sync-mode-resolver.social.test.ts

import { describe, expect, it, vi } from 'vitest'

vi.mock('@auxx/credentials', () => ({ configService: { get: () => undefined } }))

import { resolveEffectiveSyncMode } from '../sync-mode-resolver'

/**
 * FB/IG plan WS6. Meta delivers page messages by webhook only. Before this branch
 * existed both providers fell through to `'polling'`, and
 * `WebhookManagerService.setupWebhooks` early-returns on a polling channel — so
 * the page `subscribed_apps` arm silently never ran. Quo documents the same trap.
 */
describe('resolveEffectiveSyncMode — social channels', () => {
  it('resolves facebook and instagram to webhook in auto mode', () => {
    expect(resolveEffectiveSyncMode({ syncMode: 'auto', provider: 'facebook' })).toBe('webhook')
    expect(resolveEffectiveSyncMode({ syncMode: 'auto', provider: 'instagram' })).toBe('webhook')
  })

  it('still honours an explicit polling override', () => {
    expect(resolveEffectiveSyncMode({ syncMode: 'polling', provider: 'facebook' })).toBe('polling')
  })
})
