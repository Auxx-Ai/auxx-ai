// packages/lib/src/messages/__tests__/automated-send-guard.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, number>()
const redis = {
  incr: vi.fn(async (key: string) => {
    const next = (store.get(key) ?? 0) + 1
    store.set(key, next)
    return next
  }),
  pexpire: vi.fn(async () => 1),
  pttl: vi.fn(async () => 60_000),
}

vi.mock('@auxx/redis', () => ({
  getRedisClient: async () => redis,
}))

const settings = {
  'email.automation.maxPerRecipientPerHour': 2,
  'email.automation.maxPerOrgPer15Min': 30,
} as Record<string, unknown>

vi.mock('../../settings/settings-service', () => ({
  getOrganizationSetting: vi.fn(async ({ key }: { key: string }) => settings[key]),
}))

const sendNotification = vi.fn(async () => ({}))
vi.mock('../../notifications/notification-service', () => ({
  NotificationService: class {
    sendNotification = sendNotification
  },
}))
vi.mock('../../cache', () => ({
  getCachedMembers: vi.fn(async () => [
    { userId: 'admin-1', role: 'OWNER', status: 'ACTIVE' },
    { userId: 'admin-2', role: 'ADMIN', status: 'ACTIVE' },
  ]),
}))

import { checkAutomatedSendLimits, notifyAdminsOfSendBreakerTrip } from '../automated-send-guard'

beforeEach(() => {
  store.clear()
  sendNotification.mockClear()
  settings['email.automation.maxPerRecipientPerHour'] = 2
  settings['email.automation.maxPerOrgPer15Min'] = 30
})

describe('checkAutomatedSendLimits', () => {
  it('allows sends under both limits', async () => {
    const result = await checkAutomatedSendLimits({
      organizationId: 'org-1',
      recipientEmail: 'a@example.com',
    })
    expect(result.allowed).toBe(true)
  })

  it('blocks the 3rd send to the same recipient within the hour', async () => {
    await checkAutomatedSendLimits({ organizationId: 'org-1', recipientEmail: 'a@example.com' })
    await checkAutomatedSendLimits({ organizationId: 'org-1', recipientEmail: 'a@example.com' })
    const blocked = await checkAutomatedSendLimits({
      organizationId: 'org-1',
      recipientEmail: 'a@example.com',
    })
    expect(blocked).toMatchObject({ allowed: false, scope: 'recipient', limit: 2, firstTrip: true })

    // Subsequent blocks in the same window are not first trips.
    const again = await checkAutomatedSendLimits({
      organizationId: 'org-1',
      recipientEmail: 'A@Example.com', // case-insensitive key
    })
    expect(again).toMatchObject({ allowed: false, scope: 'recipient', firstTrip: false })
  })

  it('does not count a recipient-blocked send against the org window', async () => {
    for (let i = 0; i < 3; i++) {
      await checkAutomatedSendLimits({ organizationId: 'org-1', recipientEmail: 'a@example.com' })
    }
    expect(store.get('ratelimit:autosend:org:org-1')).toBe(2)
  })

  it('trips the org circuit breaker across distinct recipients, notifying only once', async () => {
    let last: Awaited<ReturnType<typeof checkAutomatedSendLimits>> = { allowed: true }
    for (let i = 0; i < 31; i++) {
      last = await checkAutomatedSendLimits({
        organizationId: 'org-2',
        recipientEmail: `r${i}@example.com`,
      })
    }
    expect(last).toMatchObject({ allowed: false, scope: 'org', limit: 30, firstTrip: true })

    const next = await checkAutomatedSendLimits({
      organizationId: 'org-2',
      recipientEmail: 'r31@example.com',
    })
    expect(next).toMatchObject({ allowed: false, scope: 'org', firstTrip: false })
  })

  it('treats a limit of 0 as disabled', async () => {
    settings['email.automation.maxPerRecipientPerHour'] = 0
    settings['email.automation.maxPerOrgPer15Min'] = 0
    for (let i = 0; i < 50; i++) {
      const result = await checkAutomatedSendLimits({
        organizationId: 'org-3',
        recipientEmail: 'same@example.com',
      })
      expect(result.allowed).toBe(true)
    }
    expect(store.size).toBe(0)
  })
})

describe('notifyAdminsOfSendBreakerTrip', () => {
  it('sends a notification to every owner/admin', async () => {
    await notifyAdminsOfSendBreakerTrip({ organizationId: 'org-1', limit: 30 })
    expect(sendNotification).toHaveBeenCalledTimes(2)
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'SYSTEM_MESSAGE',
        userId: 'admin-1',
        organizationId: 'org-1',
      })
    )
  })

  it('never throws when notification delivery fails', async () => {
    sendNotification.mockRejectedValueOnce(new Error('realtime down'))
    await expect(
      notifyAdminsOfSendBreakerTrip({ organizationId: 'org-1', limit: 30 })
    ).resolves.toBeUndefined()
  })
})
