// packages/lib/src/inbox-record-ids/inbox-record-ids.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Plan 40 §3 / 40a §5.1 — the shared inbox RecordId minter.
 *
 * Every server-side site that turns a bare inbox instance id into a RecordId
 * goes through this module, so its contract is the one thing all of them share:
 * the definition comes from the merged `inboxes` org cache's
 * `entityDefinitionKey`, NEVER from the `isPersonal` marker.
 *
 * The marker test is the load-bearing one. Between entity migration 059 and
 * data migration 060 a personal mailbox is `isPersonal: true` while still
 * sitting on the `inbox` definition with `'inbox'`-keyed grant rows. A
 * marker-derived minter passes every "does it say personal_inbox?" test and
 * breaks on deploy — before the migration it is supposed to be paired with.
 */

const h = vi.hoisted(() => ({
  cachedInboxes: [] as Array<{ id: string; entityDefinitionKey?: string; isPersonal?: boolean }>,
  getCalls: 0,
}))

vi.mock('../cache', () => ({
  getOrgCache: () => ({
    get: async () => {
      h.getCalls++
      return h.cachedInboxes
    },
  }),
}))

import { inboxDefKeyOf, loadInboxDefKeys, resolveInboxDefKey, toInboxRecordId } from './index'

const ORG = 'org_1'

beforeEach(() => {
  h.cachedInboxes = []
  h.getCalls = 0
})

describe('inbox RecordId minting (plan 40a §5.1)', () => {
  it('mints the shared slug for a mailbox on the `inbox` definition', async () => {
    h.cachedInboxes = [{ id: 'i_shared', entityDefinitionKey: 'inbox', isPersonal: false }]

    expect(await toInboxRecordId(ORG, 'i_shared')).toBe('inbox:i_shared')
  })

  it('mints `personal_inbox:` for a mailbox on the personal definition', async () => {
    h.cachedInboxes = [
      { id: 'i_personal', entityDefinitionKey: 'personal_inbox', isPersonal: true },
    ]

    expect(await toInboxRecordId(ORG, 'i_personal')).toBe('personal_inbox:i_personal')
  })

  it('follows the DEFINITION, not the `isPersonal` marker (the 059 → 060 window)', async () => {
    // Exactly today's dev state: the marker already says personal, the instance
    // has NOT moved defs yet, and its ResourceAccess rows are still `'inbox'`.
    h.cachedInboxes = [{ id: 'i_legacy', entityDefinitionKey: 'inbox', isPersonal: true }]

    expect(await toInboxRecordId(ORG, 'i_legacy')).toBe('inbox:i_legacy')

    // …and the mirror image: moved onto the new def, marker field dropped.
    h.cachedInboxes = [{ id: 'i_moved', entityDefinitionKey: 'personal_inbox', isPersonal: false }]

    expect(await toInboxRecordId(ORG, 'i_moved')).toBe('personal_inbox:i_moved')
  })

  it('falls back to the shared def (fails CLOSED) for an id the cache does not know', async () => {
    h.cachedInboxes = [{ id: 'i_shared', entityDefinitionKey: 'inbox' }]

    expect(await toInboxRecordId(ORG, 'i_missing')).toBe('inbox:i_missing')
    expect(await resolveInboxDefKey(ORG, 'i_missing')).toBe('inbox')
  })

  it('never mints `undefined:` from a cache row with no def discriminator', async () => {
    h.cachedInboxes = [{ id: 'i_stale' }]

    expect(await toInboxRecordId(ORG, 'i_stale')).toBe('inbox:i_stale')
  })

  it('reads the org cache ONCE for a whole batch', async () => {
    h.cachedInboxes = [
      { id: 'a', entityDefinitionKey: 'inbox' },
      { id: 'b', entityDefinitionKey: 'personal_inbox' },
      { id: 'c', entityDefinitionKey: 'inbox' },
    ]

    const defKeys = await loadInboxDefKeys(ORG)

    expect(h.getCalls).toBe(1)
    expect(['a', 'b', 'c', 'unknown'].map((id) => inboxDefKeyOf(defKeys, id))).toEqual([
      'inbox',
      'personal_inbox',
      'inbox',
      'inbox',
    ])
  })

  it('treats a null/undefined inbox id as the shared def rather than throwing', async () => {
    const defKeys = await loadInboxDefKeys(ORG)

    expect(inboxDefKeyOf(defKeys, null)).toBe('inbox')
    expect(inboxDefKeyOf(defKeys, undefined)).toBe('inbox')
  })
})
