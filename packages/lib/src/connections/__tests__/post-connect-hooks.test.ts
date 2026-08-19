// packages/lib/src/connections/__tests__/post-connect-hooks.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `runPostConnectHook` — the realtime settle it publishes, and the promises it must keep about it.
 *
 * The OAuth callback runs the hook before it can render anything back to the browser, so the tab
 * that started the connect has no reliable way to learn the outcome from the popup alone (COOP
 * severing, a popup blocked into a full-page redirect, or the popup flow settling on its own
 * cancel heuristic while a multi-second hook is still running). `connection:settled` is the push
 * that closes that gap, and these tests pin the three properties the connect UI depends on:
 *
 *  1. it fires on EVERY resolution, including the throw — a failed connect that publishes nothing
 *     leaves the waiting step spinning until its timeout;
 *  2. it never changes what the caller sees — a realtime outage must not turn a good connect bad,
 *     and a hook's throw must still reach the callback route that renders the error page;
 *  3. it carries `awaiting`, because that is what tells the UI a channel does NOT yet exist.
 */

const { publish, getRealtimeService } = vi.hoisted(() => {
  const publish = vi.fn(async () => true)
  return { publish, getRealtimeService: vi.fn(() => ({ publish })) }
})

vi.mock('../../realtime', () => ({ getRealtimeService }))

import { CONNECTION_SETTLED_EVENT, registerPostConnectHook, runPostConnectHook } from '../index'

const ctx = {
  credentialId: 'cred_1',
  providerKey: 'facebook',
  organizationId: 'org_1',
  userId: 'user_1',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('runPostConnectHook', () => {
  it('publishes a settled event on the connecting USER’s room, not the org’s', async () => {
    registerPostConnectHook({ providerKeys: ['provisions'], run: async () => undefined })

    await runPostConnectHook('provisions', { ...ctx, providerKey: 'provisions' })

    expect(publish).toHaveBeenCalledTimes(1)
    const [room, event, payload] = publish.mock.calls[0] as [string, string, any]
    // Addressed to the person, so it survives everything that can happen to the window.
    expect(room).toBe('user-user_1')
    expect(event).toBe(CONNECTION_SETTLED_EVENT)
    expect(payload).toMatchObject({ credentialId: 'cred_1', ok: true, awaiting: null })
  })

  it('carries `awaiting` when the hook parked a choice instead of provisioning', async () => {
    registerPostConnectHook({
      providerKeys: ['parks'],
      run: async () => ({
        awaiting: { kind: 'social-page-selection' as const, credentialId: 'cred_1' },
      }),
    })

    const result = await runPostConnectHook('parks', { ...ctx, providerKey: 'parks' })

    // The return value is unchanged — the callback route still reads it for the popup payload.
    expect(result?.awaiting?.kind).toBe('social-page-selection')
    const [, , payload] = publish.mock.calls[0] as [string, string, any]
    expect(payload).toMatchObject({ ok: true, awaiting: 'social-page-selection' })
  })

  it('publishes the failure AND rethrows, so both the popup and the opener learn about it', async () => {
    registerPostConnectHook({
      providerKeys: ['throws'],
      run: async () => {
        throw new Error('No Facebook Pages found.')
      },
    })

    await expect(runPostConnectHook('throws', { ...ctx, providerKey: 'throws' })).rejects.toThrow(
      'No Facebook Pages found.'
    )

    const [, , payload] = publish.mock.calls[0] as [string, string, any]
    expect(payload).toMatchObject({ ok: false, awaiting: null, error: 'No Facebook Pages found.' })
  })

  it('never lets a realtime outage fail a connect that succeeded', async () => {
    publish.mockRejectedValueOnce(new Error('pusher is down'))
    registerPostConnectHook({
      providerKeys: ['provisions-2'],
      run: async () => undefined,
    })

    await expect(
      runPostConnectHook('provisions-2', { ...ctx, providerKey: 'provisions-2' })
    ).resolves.toBeUndefined()
  })

  it('publishes nothing when no hook is registered — a plain credential is not a connect outcome', async () => {
    await runPostConnectHook('unregistered', { ...ctx, providerKey: 'unregistered' })
    expect(publish).not.toHaveBeenCalled()
  })
})
