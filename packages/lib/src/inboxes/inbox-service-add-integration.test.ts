// packages/lib/src/inboxes/inbox-service-add-integration.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 40 phase 0a — `InboxService.addIntegration`, the write end of the §5.1
 * channel hijack.
 *
 * Two defects, both fixed here:
 *
 *  - the "is this channel already routed?" lookup keyed on `integrationId`
 *    alone, with **no organization scoping** — a cross-org read sitting one
 *    statement-reorder away from a cross-org write;
 *  - finding a row, it silently RE-POINTED the link (`.set({ inboxId })`).
 *    Re-pointing is a privileged act on the SOURCE inbox, and this service
 *    reads no member capabilities, so it cannot authorize one. It now refuses
 *    unless the caller names the inbox it authorized moving the channel out of
 *    — and re-checks that name inside the transaction, so a re-route racing the
 *    router's read cannot land somewhere nobody approved.
 *
 * The mocked collaborators are the constructor's dependencies and the cache
 * event; `db` is a recording fake, so every claim below is about the SQL the
 * method actually builds and the order it builds it in.
 */

const { onCacheEvent } = vi.hoisted(() => ({ onCacheEvent: vi.fn(async () => undefined) }))

vi.mock('../cache', () => ({
  onCacheEvent,
  getUserCache: () => ({ get: async () => ({ isAdmin: false, inboxLens: {} }) }),
}))
vi.mock('../resource-access/resource-access-service', () => ({
  hasPermission: vi.fn(async () => false),
  setInstanceAccess: vi.fn(async () => undefined),
}))
vi.mock('../resources/crud', () => ({
  listAll: vi.fn(async () => ({ items: [] })),
  UnifiedCrudHandler: class {
    create = vi.fn()
    getById = vi.fn()
    update = vi.fn()
    delete = vi.fn()
    getFieldValues = vi.fn()
  },
}))

const { InboxService } = await import('./inbox-service')

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
const TARGET_INBOX = 'ibx_target00000000000000000'
const SOURCE_INBOX = 'ibx_source00000000000000000'
const INTEGRATION = 'int_channel0000000000000000'

interface Journal {
  /** Ordered log of the statements the method issued. */
  steps: string[]
  /** Payloads handed to `.set(...)`, in order. */
  updates: Record<string, unknown>[]
  /** Payloads handed to `.values(...)`, in order. */
  inserts: Record<string, unknown>[]
  /** Whether the link lookup joined a second table (the org scope). */
  joined: boolean
}

/**
 * A transaction handle that records rather than executes.
 *
 * `existingLink` is what the org-scoped link lookup finds; `integration` is
 * what the ownership lookup finds. Drizzle table objects are `{}` under the
 * lib vitest setup, so the WHERE clauses are opaque — which is why the org
 * scope is asserted through the JOIN (a second table is only reachable there)
 * and through the absence of the old `tx.query.InboxIntegration` read.
 */
function makeDb(opts: {
  integration?: { id: string } | undefined
  existingLink?: { id: string; inboxId: string } | undefined
}) {
  const journal: Journal = { steps: [], updates: [], inserts: [], joined: false }

  const selectChain = () => {
    const chain = {
      from: () => chain,
      innerJoin: () => {
        journal.joined = true
        return chain
      },
      where: () => chain,
      limit: async () => (opts.existingLink ? [opts.existingLink] : []),
    }
    return chain
  }

  const updateChain = () => {
    // `.where(...)` is awaited directly by the `isDefault` unset-others branch
    // and `.returning()`-ed by the re-point branch, so it is a real Promise
    // carrying the extra method rather than a thenable object literal.
    const afterWhere = Object.assign(Promise.resolve(undefined), {
      returning: async () => [{ id: 'lnk_updated', ...journal.updates.at(-1) }],
    })
    const chain = {
      set: (payload: Record<string, unknown>) => {
        journal.updates.push(payload)
        return chain
      },
      where: () => afterWhere,
    }
    return chain
  }

  const insertChain = () => {
    const chain = {
      values: (payload: Record<string, unknown>) => {
        journal.inserts.push(payload)
        return chain
      },
      returning: async () => [{ id: 'lnk_created', ...journal.inserts.at(-1) }],
    }
    return chain
  }

  const linkFindFirst = vi.fn(async () => opts.existingLink)

  const tx = {
    query: {
      Integration: {
        findFirst: vi.fn(async () => {
          journal.steps.push('ownership')
          return opts.integration
        }),
      },
      // The pre-fix, unscoped read. Kept on the handle so "it is no longer
      // used" is an assertion rather than an assumption.
      InboxIntegration: { findFirst: linkFindFirst },
    },
    select: () => {
      journal.steps.push('link-lookup')
      return selectChain()
    },
    update: () => {
      journal.steps.push('update')
      return updateChain()
    },
    insert: () => {
      journal.steps.push('insert')
      return insertChain()
    },
  }

  return {
    journal,
    linkFindFirst,
    db: { transaction: async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx) },
  }
}

const service = (db: unknown) => new InboxService(db as never, ORG_ID, USER_ID)
const recordId = (id: string) => `inbox:${id}` as never

beforeEach(() => {
  onCacheEvent.mockReset()
  onCacheEvent.mockResolvedValue(undefined as never)
})

describe('addIntegration — the link lookup is organization-scoped', () => {
  it('joins the inbox EntityInstance instead of reading on integrationId alone', async () => {
    // `InboxIntegration` carries no organizationId of its own, so the only way
    // to scope the lookup is through the inbox it points at. The pre-fix
    // `tx.query.InboxIntegration.findFirst` had no scope at all.
    const { db, journal, linkFindFirst } = makeDb({
      integration: { id: INTEGRATION },
      existingLink: undefined,
    })
    await service(db).addIntegration(recordId(TARGET_INBOX), INTEGRATION)
    expect(journal.joined).toBe(true)
    expect(linkFindFirst).not.toHaveBeenCalled()
  })

  it('checks integration ownership BEFORE it reads any link row', async () => {
    // Ordering is the point: every read and write below is keyed on this
    // integration, so an out-of-org id must be rejected before any of them.
    const { db, journal } = makeDb({
      integration: { id: INTEGRATION },
      existingLink: { id: 'lnk_1', inboxId: SOURCE_INBOX },
    })
    await service(db).addIntegration(recordId(TARGET_INBOX), INTEGRATION, false, undefined, {
      repointFromInboxId: SOURCE_INBOX,
    })
    expect(journal.steps.indexOf('ownership')).toBeLessThan(journal.steps.indexOf('link-lookup'))
  })

  it('an out-of-org integration is a 404 AuxxError, and nothing else runs', async () => {
    const { db, journal } = makeDb({ integration: undefined, existingLink: undefined })
    await expect(
      service(db).addIntegration(recordId(TARGET_INBOX), INTEGRATION)
    ).rejects.toMatchObject({ name: 'NotFoundError', statusCode: 404 })
    expect(journal.steps).toEqual(['ownership'])
    expect(journal.updates).toEqual([])
    expect(journal.inserts).toEqual([])
  })
})

describe('addIntegration — re-pointing needs the caller’s acknowledgement', () => {
  it('refuses to move a channel out of another inbox when none is given', async () => {
    // The silent re-point, refused. This is step 4 of the §5.1 exploit: with
    // no acknowledgement the service used to just `.set({ inboxId })`.
    const { db, journal } = makeDb({
      integration: { id: INTEGRATION },
      existingLink: { id: 'lnk_1', inboxId: SOURCE_INBOX },
    })
    await expect(
      service(db).addIntegration(recordId(TARGET_INBOX), INTEGRATION)
    ).rejects.toMatchObject({ name: 'ConflictError', statusCode: 409 })
    expect(journal.updates).toEqual([])
    expect(journal.inserts).toEqual([])
  })

  it('refuses when the acknowledgement names an inbox the channel has since left', async () => {
    // The TOCTOU half. The router authorized moving the channel out of the
    // inbox it READ; if the link moved in between, that authorization does not
    // transfer to wherever it moved to.
    const { db, journal } = makeDb({
      integration: { id: INTEGRATION },
      existingLink: { id: 'lnk_1', inboxId: 'ibx_racedelsewhere0000000000' },
    })
    await expect(
      service(db).addIntegration(recordId(TARGET_INBOX), INTEGRATION, false, undefined, {
        repointFromInboxId: SOURCE_INBOX,
      })
    ).rejects.toMatchObject({ name: 'ConflictError', statusCode: 409 })
    expect(journal.updates).toEqual([])
  })

  it('re-points when the acknowledgement matches', async () => {
    // The positive control: an authorized move must still work, or every
    // legitimate re-route in the settings UI breaks.
    const { db, journal } = makeDb({
      integration: { id: INTEGRATION },
      existingLink: { id: 'lnk_1', inboxId: SOURCE_INBOX },
    })
    await expect(
      service(db).addIntegration(recordId(TARGET_INBOX), INTEGRATION, false, undefined, {
        repointFromInboxId: SOURCE_INBOX,
      })
    ).resolves.toBeDefined()
    expect(journal.updates).toEqual([
      expect.objectContaining({ inboxId: TARGET_INBOX, isDefault: false }),
    ])
  })

  it('re-adding to the inbox the channel is already in needs no acknowledgement', async () => {
    // Not a move — the settings UI uses this path to flip `isDefault` and
    // rewrite per-channel settings.
    const { db, journal } = makeDb({
      integration: { id: INTEGRATION },
      existingLink: { id: 'lnk_1', inboxId: TARGET_INBOX },
    })
    await expect(
      service(db).addIntegration(recordId(TARGET_INBOX), INTEGRATION, true)
    ).resolves.toBeDefined()
    expect(journal.updates.at(-1)).toMatchObject({ inboxId: TARGET_INBOX, isDefault: true })
  })

  it('an unrouted channel is inserted, with no acknowledgement required', async () => {
    // The provisioning path — channel connect hooks link a brand-new
    // integration and must not have to prove anything about a prior route.
    const { db, journal } = makeDb({ integration: { id: INTEGRATION }, existingLink: undefined })
    await expect(
      service(db).addIntegration(recordId(TARGET_INBOX), INTEGRATION, true)
    ).resolves.toBeDefined()
    expect(journal.inserts).toEqual([
      expect.objectContaining({ inboxId: TARGET_INBOX, integrationId: INTEGRATION }),
    ])
    expect(onCacheEvent).toHaveBeenCalledWith('channel.inbox-link.changed', { orgId: ORG_ID })
  })

  it('a refused re-point emits no cache event — nothing changed', async () => {
    const { db } = makeDb({
      integration: { id: INTEGRATION },
      existingLink: { id: 'lnk_1', inboxId: SOURCE_INBOX },
    })
    await expect(service(db).addIntegration(recordId(TARGET_INBOX), INTEGRATION)).rejects.toThrow()
    expect(onCacheEvent).not.toHaveBeenCalled()
  })
})
