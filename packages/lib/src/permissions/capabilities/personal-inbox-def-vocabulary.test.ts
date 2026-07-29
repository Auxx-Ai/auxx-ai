// packages/lib/src/permissions/capabilities/personal-inbox-def-vocabulary.test.ts

import { BuiltInEntityType, BuiltInEntityTypeValues } from '@auxx/database/enums'
import { describe, expect, it } from 'vitest'
import {
  isAccessManageable,
  isCustomResourceId,
  isSystemResourceId,
  NON_RECORD_ENTITY_SLUGS,
  type Resource,
} from '../../resources/registry/types'
import { CapabilitySet } from './capability-set'
import { NON_RECORD_DEF_SLUGS } from './entity-access'
import { PermissionKey } from './registry'

/**
 * Plan 40 / 40a §1.3 — the `personal_inbox` def's membership in the slug
 * vocabularies that decide access, expressed as behavior rather than as
 * assertions about the source text.
 *
 * Phase 1 is behavior-INERT: the def is not seeded yet, so nothing here can be
 * exercised end-to-end. What these pin is the shape each list confers the moment
 * it is, plus the two decisions §11 item 2 forced.
 */

/** The org's def CUIDs, as `defIdToSlug` would resolve them. */
const INBOX_DEF_ID = 'qiramlz5m0cswo4n4v10mxkz'
const PERSONAL_INBOX_DEF_ID = 'pi000defcuid00000000000000'
const CONTACT_DEF_ID = 'mzxt3cxyzhm3cbtgcbpmeir1'

const SLUGS: Record<string, string> = {
  [INBOX_DEF_ID]: 'inbox',
  [PERSONAL_INBOX_DEF_ID]: 'personal_inbox',
  [CONTACT_DEF_ID]: 'contact',
}

/**
 * A CapabilitySet with NO records rung at all — the member whose fate the
 * `NON_RECORD_DEF_SLUGS` pass-through decides.
 */
const build = (opts: { keys?: PermissionKey[]; seatType?: 'full' | 'worker' } = {}) =>
  new CapabilitySet(
    new Set(opts.keys ?? []),
    {},
    'USER',
    opts.seatType ?? 'full',
    (id) => SLUGS[id] ?? id,
    new Set(),
    (id) => id,
    {},
    new Set(),
    {}
  )

describe('NON_RECORD_DEF_SLUGS — personal_inbox joins the mail-infrastructure half', () => {
  it('lets a member with no records rung view the def, by slug and by def CUID', () => {
    const caps = build()
    expect(caps.canViewEntity('personal_inbox')).toBe(true)
    expect(caps.canViewEntity(PERSONAL_INBOX_DEF_ID)).toBe(true)
  })

  it('does not hand out the pass-through to ordinary record defs', () => {
    const caps = build()
    expect(caps.canViewEntity('contact')).toBe(false)
    expect(caps.canViewEntity(CONTACT_DEF_ID)).toBe(false)
  })

  it('routes writes through the coarse verb gate, exactly as `inbox` does', () => {
    expect(build().canEditEntity('personal_inbox')).toBe(false)
    expect(build({ keys: [PermissionKey.recordsEdit] }).canEditEntity('personal_inbox')).toBe(true)
  })
})

/**
 * Plan 40 §11 item 2, answered. Plan 36 §7.6 REMOVED `signature`/`snippet` from
 * this set when they became instance-access keys, so the two lists are
 * conventionally mutually exclusive — but `inbox` must diverge, for the same
 * reason `thread` does (§5.4). The evidence is the FE's only inbox list:
 * `useAllRecords({ entityDefinitionId: 'inbox' })` → `record.listAll` →
 * `UnifiedCrudHandler.listAll`, which gates on `canViewEntity` and returns an
 * EMPTY LIST on denial. Removing `inbox` here routes that gate through the
 * Records area, which resolves to no access for a worker seat (`Area.records` is
 * outside `WORKER_AREAS`) or a `Records: None` profile — the mail sidebar,
 * pickers and thread inbox column go silently empty.
 */
describe('NON_RECORD_DEF_SLUGS — `inbox` deliberately STAYS (plan 40 §11 item 2)', () => {
  it('keeps the sidebar readable for a member holding no records rung', () => {
    expect(build().canViewEntity('inbox')).toBe(true)
    expect(build().canViewEntity(INBOX_DEF_ID)).toBe(true)
  })

  it('keeps it readable for a worker seat, whose records ceiling is None', () => {
    const worker = build({ keys: [PermissionKey.recordsViewLinked], seatType: 'worker' })
    expect(worker.canViewEntity('inbox')).toBe(true)
    expect(worker.canViewEntity('personal_inbox')).toBe(true)
  })

  it('records the divergence: both mail keys sit in the set together', () => {
    expect(NON_RECORD_DEF_SLUGS.has('inbox')).toBe(true)
    expect(NON_RECORD_DEF_SLUGS.has('personal_inbox')).toBe(true)
    // `thread` stands on the same reasoning and stays for the same reason.
    expect(NON_RECORD_DEF_SLUGS.has('thread')).toBe(true)
  })
})

/**
 * `agent-permission-policy.ts` clamps a published agent's policy to its author,
 * skipping defs governed outside the record keyspace via
 * `!NON_RECORD_DEF_SLUGS.has(r.entityType ?? r.apiSlug)`. 40a §1.3 claims the
 * new def is covered for free; this is the verification, not the assumption.
 */
describe('agent Records-policy filter is covered by NON_RECORD_DEF_SLUGS', () => {
  const skipped = (r: { entityType?: string; apiSlug: string }) =>
    NON_RECORD_DEF_SLUGS.has(r.entityType ?? r.apiSlug)

  it('skips the personal-inbox def by its entityType', () => {
    expect(skipped({ entityType: 'personal_inbox', apiSlug: 'personal-inboxes' })).toBe(true)
  })

  it('still clamps ordinary record defs', () => {
    expect(skipped({ entityType: 'contact', apiSlug: 'contacts' })).toBe(false)
    expect(skipped({ apiSlug: 'deals' })).toBe(false)
  })
})

/**
 * The client mirror (`resources/registry/types.ts`) does a DIFFERENT job under a
 * similar name: it hides a def from the type-level Access grid, where a row
 * would write `ResourceAccess` rows the mail path never reads.
 */
describe('NON_RECORD_ENTITY_SLUGS — the def is hidden from the type-level Access grid', () => {
  const resource = (entityType: string | undefined, apiSlug: string, id: string) =>
    ({ id, entityDefinitionId: id, apiSlug, entityType, type: 'custom' }) as unknown as Resource

  it('hides personal_inbox, matched on entityType', () => {
    expect(
      isAccessManageable(resource('personal_inbox', 'personal-inboxes', PERSONAL_INBOX_DEF_ID))
    ).toBe(false)
    expect(NON_RECORD_ENTITY_SLUGS.has('personal_inbox')).toBe(true)
  })

  it('leaves an ordinary record def manageable', () => {
    expect(isAccessManageable(resource(undefined, 'deals', 'deal5defcuid0000000000000'))).toBe(true)
  })
})

/**
 * `BuiltInEntityTypeValues` is the vocabulary for grant rows whose
 * `ResourceAccess.entityDefinitionId` is a SLUG rather than a def CUID. Missing
 * it, a personal-inbox share has no name in the grant keyspace and nothing fails
 * loudly. The invariant that makes the slug keyspace safe is that a slug row can
 * never be mistaken for a def RESTRICTION — `restrictedEntityDefIdsProvider`
 * filters its rows through `isCustomResourceId`, which must reject the slug.
 */
describe('BuiltInEntityType — personal_inbox names the slug grant keyspace', () => {
  it('is part of the built-in grant vocabulary', () => {
    expect(BuiltInEntityTypeValues).toContain('personal_inbox')
    expect(BuiltInEntityType.personal_inbox).toBe('personal_inbox')
  })

  it('a slug-keyed row can never mark a def restricted (isCustomResourceId rejects it)', () => {
    for (const slug of BuiltInEntityTypeValues) {
      expect(isCustomResourceId(slug)).toBe(false)
    }
    expect(isCustomResourceId(PERSONAL_INBOX_DEF_ID)).toBe(true)
  })

  it('adding personal_inbox to ModelTypeValues did NOT grow a phantom system table', () => {
    // `ENTITY_DEFINITION_TYPES` membership is what excludes it from
    // `RESOURCE_TABLE_REGISTRY`; without that, `isSystemResourceId` would start
    // answering `true` for a def that has no table.
    expect(isSystemResourceId('personal_inbox')).toBe(false)
    expect(isSystemResourceId('thread')).toBe(true)
  })
})
