// packages/lib/src/accounting/parties/__tests__/guest-contact.test.ts
//
// Task 79 §5. The mint is the whole of the idempotency: pressing the wizard's
// button twice has to leave one guest, and an ARCHIVED guest has to come back
// rather than be replaced — a second guest is how the setting starts lying.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  getCachedEntityDefId: vi.fn(),
  create: vi.fn(),
  readOrganizationSettings: vi.fn(),
  updateOrganizationSetting: vi.fn(),
}))

vi.mock('../../../cache', () => ({ getCachedEntityDefId: h.getCachedEntityDefId }))
vi.mock('../../../resources/crud', () => ({
  seedSession: (reason: string) => ({ origin: 'seed', reason }),
  UnifiedCrudHandler: class {
    create = h.create
  },
}))
vi.mock('../../../settings', () => ({
  readOrganizationSettings: h.readOrganizationSettings,
  updateOrganizationSetting: h.updateOrganizationSetting,
}))
vi.mock('../../../users/system-user-service', () => ({
  SystemUserService: { getSystemUserForActions: async () => 'system-user' },
}))

import { schema } from '@auxx/database'
import { ensureGuestContact } from '../guest-contact'

const ORG = 'org1'
const GUEST = 'contact-guest'

/** Rows the fake `select` answers with, and what the fake `update` recorded. */
let instanceRows: { id: string; archivedAt: Date | null }[] = []
let unarchived: string[] = []
let requeued: { id: string }[] = []

function fakeDb() {
  const db = {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => instanceRows }) }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          if (table === schema.EntityInstance) {
            if (values.archivedAt === null) unarchived.push(instanceRows[0]?.id ?? '')
            return Promise.resolve(undefined)
          }
          return { returning: async () => requeued }
        },
      }),
    }),
  }
  return db as never
}

beforeEach(() => {
  instanceRows = []
  unarchived = []
  requeued = []
  h.getCachedEntityDefId.mockReset().mockResolvedValue('def-contact')
  h.create.mockReset().mockResolvedValue({ instance: { id: GUEST } })
  h.readOrganizationSettings.mockReset().mockResolvedValue({ 'accounting.guestContactId': null })
  h.updateOrganizationSetting.mockReset().mockResolvedValue(undefined)
})

describe('ensureGuestContact', () => {
  it('mints one guest and names it in the setting', async () => {
    requeued = [{ id: 'a1' }, { id: 'a2' }]

    const result = await ensureGuestContact(fakeDb(), ORG)

    expect(result).toEqual({ contactInstanceId: GUEST, created: 1, requeued: 2 })
    expect(h.create).toHaveBeenCalledWith('def-contact', {
      first_name: 'Guest',
      last_name: 'customer',
    })
    expect(h.updateOrganizationSetting).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'accounting.guestContactId', value: GUEST })
    )
  })

  it('carries no email and no phone, so nothing can match it on either', async () => {
    await ensureGuestContact(fakeDb(), ORG)

    const [, values] = h.create.mock.calls[0] as [string, Record<string, unknown>]
    expect(Object.keys(values).sort()).toEqual(['first_name', 'last_name'])
  })

  it('mints nothing the second time and reports created: 0', async () => {
    h.readOrganizationSettings.mockResolvedValue({ 'accounting.guestContactId': GUEST })
    instanceRows = [{ id: GUEST, archivedAt: null }]

    const result = await ensureGuestContact(fakeDb(), ORG)

    expect(result).toEqual({ contactInstanceId: GUEST, created: 0, requeued: 0 })
    expect(h.create).not.toHaveBeenCalled()
    expect(h.updateOrganizationSetting).not.toHaveBeenCalled()
  })

  it('un-archives an archived guest rather than minting a second one', async () => {
    h.readOrganizationSettings.mockResolvedValue({ 'accounting.guestContactId': GUEST })
    instanceRows = [{ id: GUEST, archivedAt: new Date('2026-01-01') }]

    const result = await ensureGuestContact(fakeDb(), ORG)

    expect(result).toEqual({ contactInstanceId: GUEST, created: 0, requeued: 0 })
    expect(unarchived).toEqual([GUEST])
    expect(h.create).not.toHaveBeenCalled()
  })

  it('re-mints when the setting names a row that is gone', async () => {
    h.readOrganizationSettings.mockResolvedValue({ 'accounting.guestContactId': 'contact-deleted' })
    instanceRows = []

    const result = await ensureGuestContact(fakeDb(), ORG)

    expect(result.created).toBe(1)
    expect(result.contactInstanceId).toBe(GUEST)
  })

  it('does nothing for an org with no contact definition', async () => {
    h.getCachedEntityDefId.mockResolvedValue(null)

    const result = await ensureGuestContact(fakeDb(), ORG)

    expect(result).toEqual({ contactInstanceId: null, created: 0, requeued: 0 })
    expect(h.create).not.toHaveBeenCalled()
  })

  it('reads the setting through db, not the org cache', async () => {
    const db = fakeDb()

    await ensureGuestContact(db, ORG)

    expect(h.readOrganizationSettings).toHaveBeenCalledWith(ORG, ['accounting.guestContactId'], db)
  })
})
