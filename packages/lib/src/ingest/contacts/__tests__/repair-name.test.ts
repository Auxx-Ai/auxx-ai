// packages/lib/src/ingest/contacts/__tests__/repair-name.test.ts

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The contact-name repair — FB/IG follow-up, Aug 2026.
 *
 * Contact creation and Meta name resolution run on different clocks: ingest
 * mints a contact on the first outbound reply, and `resolveSocialCounterpartName`
 * only learns the real name once Graph answers. A contact minted inside that
 * window was named from a nameless participant and stayed called
 * `27893553143563440` forever, because name resolution writes `Participant`,
 * never the record.
 *
 * What has to hold: the repair upgrades a record whose display value is only the
 * identifier echoed back, and refuses to touch anything a human might have
 * named.
 */

const { update } = vi.hoisted(() => ({ update: vi.fn() }))

vi.mock('@auxx/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/logger')>()),
  createScopedLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('../../../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    update = update
  },
}))

vi.mock('../../../users/system-user-service', () => ({
  SystemUserService: { getSystemUserForActions: vi.fn().mockResolvedValue('system_user_1') },
}))

import { repairContactNameFromParticipant } from '../repair-name'

const PSID = '27893553143563440'

/** One `select(...).from(...).where(...).limit(...)` answering `rows`. */
function fakeDb(rows: unknown[]): Database {
  return {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => rows }) }),
    }),
  } as unknown as Database
}

function contactRow(displayName: string | null) {
  return { id: 'contact_1', displayName, entityDefinitionId: 'def_contact' }
}

const args = {
  organizationId: 'org_1',
  entityInstanceId: 'contact_1',
  identifier: PSID,
  name: 'Markus Klooth',
}

beforeEach(() => {
  vi.clearAllMocks()
  update.mockResolvedValue(undefined)
})

describe('repairContactNameFromParticipant', () => {
  it('names a contact whose display value is just the PSID echoed back', async () => {
    const repaired = await repairContactNameFromParticipant(fakeDb([contactRow(PSID)]), args)

    expect(repaired).toBe(true)
    expect(update).toHaveBeenCalledWith('def_contact:contact_1', {
      first_name: 'Markus',
      last_name: 'Klooth',
    })
  })

  it('names a contact that has no display value at all', async () => {
    // What a Meta contact now looks like at creation time: the identifier is no
    // longer laundered into First Name, so the record starts out blank.
    const repaired = await repairContactNameFromParticipant(fakeDb([contactRow(null)]), args)

    expect(repaired).toBe(true)
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('leaves a contact that already carries a real name alone', async () => {
    const repaired = await repairContactNameFromParticipant(
      fakeDb([contactRow('Ada Lovelace')]),
      args
    )

    expect(repaired).toBe(false)
    expect(update).not.toHaveBeenCalled()
  })

  it('writes a single-word name as the first name only', async () => {
    const repaired = await repairContactNameFromParticipant(fakeDb([contactRow(PSID)]), {
      ...args,
      name: 'auxxlift',
    })

    expect(repaired).toBe(true)
    expect(update).toHaveBeenCalledWith('def_contact:contact_1', {
      first_name: 'auxxlift',
      last_name: null,
    })
  })

  it('does nothing when the participant is linked to no contact', async () => {
    const db = fakeDb([contactRow(PSID)])
    const select = vi.spyOn(db, 'select')

    const repaired = await repairContactNameFromParticipant(db, {
      ...args,
      entityInstanceId: null,
    })

    expect(repaired).toBe(false)
    // The null guard is ahead of the read: no query is spent on the ordinary
    // case of a counterpart no contact was ever minted for.
    expect(select).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('does nothing when the contact is gone or archived', async () => {
    // `Participant.entityInstanceId` is not cleared on archival, so a stale link
    // is normal — and repairing an archived record would resurrect it into every
    // list that filters on `archivedAt IS NULL`.
    const repaired = await repairContactNameFromParticipant(fakeDb([]), args)

    expect(repaired).toBe(false)
    expect(update).not.toHaveBeenCalled()
  })

  it('swallows a write failure — the caller is a post-200 webhook hook', async () => {
    update.mockRejectedValue(new Error('field validator rejected the value'))

    await expect(repairContactNameFromParticipant(fakeDb([contactRow(PSID)]), args)).resolves.toBe(
      false
    )
  })
})
