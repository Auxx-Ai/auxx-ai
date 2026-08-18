// packages/lib/src/providers/social/__tests__/profile.test.ts

import type { Database } from '@auxx/database'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getUserProfile } from '../api'
import { buildSocialDisplayName, resolveSocialCounterpartName } from '../profile'

/**
 * FB/IG plan WS13 — the counterpart display name.
 *
 * Meta's messaging webhook carries only `sender.id`, so without this resolver
 * every Messenger/Instagram thread is labelled with a raw PSID. The properties
 * worth pinning are the failure ones: a person who restricted profile access is
 * a NORMAL outcome that must not throw (ingest runs behind a webhook Meta
 * retries), and a participant that already has a name must not cost a Graph
 * call at all — that lookup IS the cache.
 */

const { getChannelTokens, findOrCreateParticipant } = vi.hoisted(() => ({
  getChannelTokens: vi.fn(),
  findOrCreateParticipant: vi.fn(),
}))

vi.mock('../../channel-token-accessor', () => ({ getChannelTokens }))

vi.mock('../../../participants/participant-service', () => ({
  ParticipantService: class {
    findOrCreateParticipant = findOrCreateParticipant
  },
}))

/** Queue one array per `select(...).from(...).where(...).limit(...)` in order. */
function fakeDb(results: unknown[][]): Database {
  const queue = [...results]
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => queue.shift() ?? [],
        }),
      }),
    }),
  } as unknown as Database
}

function graphOk(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response
}

function graphError(status: number, error: Record<string, unknown>): Response {
  return { ok: false, status, json: async () => ({ error }) } as unknown as Response
}

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  getChannelTokens.mockReset()
  findOrCreateParticipant.mockReset()
  getChannelTokens.mockResolvedValue({
    accessToken: 'page-token',
    refreshToken: null,
    expiresAt: null,
  })
  findOrCreateParticipant.mockResolvedValue({ id: 'participant_1' })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('buildSocialDisplayName', () => {
  it('prefers the Instagram-style single `name`', () => {
    expect(buildSocialDisplayName({ name: 'Ada Lovelace', username: 'ada' })).toBe('Ada Lovelace')
  })

  it('joins the Messenger-style first/last pair', () => {
    expect(buildSocialDisplayName({ first_name: 'Ada', last_name: 'Lovelace' })).toBe(
      'Ada Lovelace'
    )
  })

  it('tolerates a half-present name pair', () => {
    expect(buildSocialDisplayName({ first_name: 'Ada' })).toBe('Ada')
    expect(buildSocialDisplayName({ last_name: 'Lovelace' })).toBe('Lovelace')
  })

  it('falls back to the Instagram handle when no name came back', () => {
    expect(buildSocialDisplayName({ username: 'ada' })).toBe('ada')
  })

  it('returns undefined for a node that carried nothing usable', () => {
    expect(buildSocialDisplayName({ id: '27893553143563440' })).toBeUndefined()
    expect(buildSocialDisplayName({ first_name: '  ' })).toBeUndefined()
    expect(buildSocialDisplayName(null)).toBeUndefined()
  })
})

describe('getUserProfile', () => {
  it('asks Messenger for first_name/last_name and sends the token as a header', async () => {
    fetchMock.mockResolvedValue(graphOk({ id: 'psid_1', first_name: 'Ada', last_name: 'Lovelace' }))

    const profile = await getUserProfile({
      platform: 'facebook',
      userId: 'psid_1',
      pageAccessToken: 'page-token',
    })

    expect(profile).toEqual({ id: 'psid_1', first_name: 'Ada', last_name: 'Lovelace' })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/psid_1?')
    expect(decodeURIComponent(url)).toContain('fields=first_name,last_name,profile_pic')
    // Never in the query string: a token there leaks into logs and paging links.
    expect(url).not.toContain('access_token')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer page-token')
  })

  it('asks Instagram for name/username instead', async () => {
    fetchMock.mockResolvedValue(graphOk({ id: 'igsid_1', name: 'Ada', username: 'ada' }))

    const profile = await getUserProfile({
      platform: 'instagram',
      userId: 'igsid_1',
      pageAccessToken: 'page-token',
    })

    expect(profile).toEqual({ id: 'igsid_1', name: 'Ada', username: 'ada' })
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(decodeURIComponent(url)).toContain('fields=name,username,profile_pic')
  })

  it('returns null instead of throwing when Graph refuses', async () => {
    fetchMock.mockResolvedValue(
      graphError(400, { message: 'Unsupported get request.', code: 100, error_subcode: 33 })
    )

    await expect(
      getUserProfile({ platform: 'facebook', userId: 'psid_1', pageAccessToken: 'page-token' })
    ).resolves.toBeNull()
  })
})

describe('resolveSocialCounterpartName', () => {
  const base = {
    organizationId: 'org_1',
    integrationId: 'int_1',
    counterpartId: '27893553143563440',
  }

  it('resolves a Facebook counterpart and writes it through the participant seam', async () => {
    fetchMock.mockResolvedValue(graphOk({ first_name: 'Ada', last_name: 'Lovelace' }))
    // 1st query: the participant (unnamed). 2nd: the integration's inbox link.
    const db = fakeDb([[{ name: null }], [{ inboxId: 'inbox_1' }]])

    const name = await resolveSocialCounterpartName(db, { ...base, platform: 'facebook' })

    expect(name).toBe('Ada Lovelace')
    expect(findOrCreateParticipant).toHaveBeenCalledWith(
      {
        identifier: '27893553143563440',
        identifierType: 'FACEBOOK_PSID',
        name: 'Ada Lovelace',
      },
      // The publish context is what makes the open thread list flip live.
      { inboxId: 'inbox_1' }
    )
  })

  it('resolves an Instagram counterpart on the IGSID identifier space', async () => {
    fetchMock.mockResolvedValue(graphOk({ name: 'Ada Lovelace', username: 'ada' }))
    const db = fakeDb([[{ name: null }], [{ inboxId: 'inbox_2' }]])

    const name = await resolveSocialCounterpartName(db, { ...base, platform: 'instagram' })

    expect(name).toBe('Ada Lovelace')
    expect(findOrCreateParticipant).toHaveBeenCalledWith(
      expect.objectContaining({ identifierType: 'INSTAGRAM_IGSID', name: 'Ada Lovelace' }),
      { inboxId: 'inbox_2' }
    )
  })

  it('returns undefined without throwing when profile access is restricted', async () => {
    fetchMock.mockResolvedValue(
      graphError(400, { message: 'Unsupported get request.', code: 100, error_subcode: 33 })
    )
    const db = fakeDb([[{ name: null }], [{ inboxId: 'inbox_1' }]])

    await expect(
      resolveSocialCounterpartName(db, { ...base, platform: 'facebook' })
    ).resolves.toBeUndefined()
    expect(findOrCreateParticipant).not.toHaveBeenCalled()
  })

  it('leaves the id fallback in place when the profile carried no name at all', async () => {
    fetchMock.mockResolvedValue(graphOk({ id: '27893553143563440' }))
    const db = fakeDb([[{ name: null }], [{ inboxId: 'inbox_1' }]])

    await expect(
      resolveSocialCounterpartName(db, { ...base, platform: 'facebook' })
    ).resolves.toBeUndefined()
    expect(findOrCreateParticipant).not.toHaveBeenCalled()
  })

  it('spends no Graph call when the participant already has a name', async () => {
    const db = fakeDb([[{ name: 'Ada Lovelace' }]])

    await expect(
      resolveSocialCounterpartName(db, { ...base, platform: 'facebook' })
    ).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(getChannelTokens).not.toHaveBeenCalled()
    expect(findOrCreateParticipant).not.toHaveBeenCalled()
  })

  it('does NOT treat the raw id stored as a name as "already named"', async () => {
    fetchMock.mockResolvedValue(graphOk({ first_name: 'Ada', last_name: 'Lovelace' }))
    const db = fakeDb([[{ name: '27893553143563440' }], [{ inboxId: 'inbox_1' }]])

    await expect(resolveSocialCounterpartName(db, { ...base, platform: 'facebook' })).resolves.toBe(
      'Ada Lovelace'
    )
  })

  it('skips the Graph call when the channel has no page token', async () => {
    getChannelTokens.mockResolvedValue({ accessToken: null, refreshToken: null, expiresAt: null })
    const db = fakeDb([[{ name: null }]])

    await expect(
      resolveSocialCounterpartName(db, { ...base, platform: 'facebook' })
    ).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('swallows a credential read failure rather than surfacing it to the webhook', async () => {
    getChannelTokens.mockRejectedValue(new Error('Channel int_1 not found'))
    const db = fakeDb([[{ name: null }]])

    await expect(
      resolveSocialCounterpartName(db, { ...base, platform: 'facebook' })
    ).resolves.toBeUndefined()
  })
})
