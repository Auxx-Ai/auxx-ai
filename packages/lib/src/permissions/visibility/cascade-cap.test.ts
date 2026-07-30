// packages/lib/src/permissions/visibility/cascade-cap.test.ts

import { describe, expect, it } from 'vitest'
import {
  deriveThreadRungFromRecordGrant,
  recordThreadDerivationCap,
} from '../capabilities/record-thread-derivation'
import type { UserInstanceGrants } from './context'
import { primaryEntityThreadIdsAtOrAbove, primaryEntityThreadRung } from './context'

/**
 * Plan v3/03 §13.1 — **the cascade cap**, product-decided 2026-07-29.
 *
 * Before this, ANY record grant raised the lens on every thread whose
 * `primaryEntityInstanceId` was that record, at whatever rung the grant carried.
 * That was an accident of the keyspace, not a decision, and P5 widens who may
 * write record grants — so "I shared the deal" would have silently meant "and
 * its whole email history".
 *
 * The two readers under test are the two halves of the SAME question, and they
 * must agree: {@link primaryEntityThreadRung} answers it for ONE thread (the
 * lens evaluator) and {@link primaryEntityThreadIdsAtOrAbove} answers it as an
 * id list (the SQL list predicate). A cap applied to only one of them produces a
 * row the member can list but whose every field redacts.
 */

const TICKET_DEF = 'edf_ticket000000000000000000'
const DEAL_DEF = 'edf_deal00000000000000000000'

function vis(over: Partial<UserInstanceGrants> = {}): UserInstanceGrants {
  return {
    userId: 'u1',
    role: 'USER',
    isAdmin: false,
    isMailAdmin: false,
    inboxLens: {},
    personalInboxIds: {},
    grants: {},
    defEntityTypes: {},
    ...over,
  }
}

describe('the declaration', () => {
  it('caps ticket-like defs at `read` and everything else at `none`', () => {
    expect(recordThreadDerivationCap('ticket')).toBe('read')
    expect(recordThreadDerivationCap('deal')).toBe('none')
    expect(recordThreadDerivationCap(null)).toBe('none')
    expect(recordThreadDerivationCap(undefined)).toBe('none')
  })

  it('is a CEILING in both directions — never a floor', () => {
    expect(deriveThreadRungFromRecordGrant('admin', 'ticket')).toBe('read')
    expect(deriveThreadRungFromRecordGrant('metadata', 'ticket')).toBe('metadata')
    expect(deriveThreadRungFromRecordGrant('admin', null)).toBe('none')
    expect(deriveThreadRungFromRecordGrant(undefined, 'ticket')).toBe('none')
  })
})

describe('primaryEntityThreadRung — the per-thread evaluator', () => {
  it('a ticket grant derives `read`', () => {
    const v = vis({
      grants: { [TICKET_DEF]: { tkt_1: 'edit' } },
      defEntityTypes: { [TICKET_DEF]: 'ticket' },
    })
    expect(primaryEntityThreadRung(v, 'tkt_1')).toBe('read')
  })

  it('a generic record grant derives NOTHING, however strong', () => {
    const v = vis({
      grants: { [DEAL_DEF]: { deal_1: 'admin' } },
      defEntityTypes: { [DEAL_DEF]: null },
    })
    expect(primaryEntityThreadRung(v, 'deal_1')).toBe('none')
  })

  it('holding a grant and deriving a lens are now DIFFERENT questions', () => {
    // The regression this whole cap exists to prevent: the grant is real, the
    // read path honours it on the RECORD, and the thread lane derives nothing.
    const v = vis({
      grants: { [DEAL_DEF]: { deal_1: 'admin' } },
      defEntityTypes: { [DEAL_DEF]: null },
    })
    expect(v.grants[DEAL_DEF]?.deal_1).toBe('admin')
    expect(primaryEntityThreadRung(v, 'deal_1')).toBe('none')
  })

  it('mail sharing defs are skipped — they have their own rules', () => {
    const v = vis({
      grants: { thread: { t1: 'read' }, contact: { c1: 'read' } },
      defEntityTypes: {},
    })
    expect(primaryEntityThreadRung(v, 't1')).toBe('none')
    expect(primaryEntityThreadRung(v, 'c1')).toBe('none')
  })
})

describe('primaryEntityThreadIdsAtOrAbove — the SQL list predicate', () => {
  it('lists a ticket id and omits a generic-def id at the same rung', () => {
    const v = vis({
      grants: { [TICKET_DEF]: { tkt_1: 'admin' }, [DEAL_DEF]: { deal_1: 'admin' } },
      defEntityTypes: { [TICKET_DEF]: 'ticket', [DEAL_DEF]: null },
    })
    expect(primaryEntityThreadIdsAtOrAbove(v, 'read')).toEqual(['tkt_1'])
    expect(primaryEntityThreadIdsAtOrAbove(v, 'metadata')).toEqual(['tkt_1'])
  })

  it('`need: none` still lists nothing for an uncapped def', () => {
    // `RUNG_ORDER['none'] >= RUNG_ORDER['none']` is true, so a bare `>=` would
    // have listed every generic-def instance at the bottom tier.
    const v = vis({
      grants: { [DEAL_DEF]: { deal_1: 'admin' } },
      defEntityTypes: { [DEAL_DEF]: null },
    })
    expect(primaryEntityThreadIdsAtOrAbove(v, 'none')).toEqual([])
  })

  it('agrees with the per-thread evaluator on every id it lists', () => {
    const v = vis({
      grants: { [TICKET_DEF]: { a: 'read', b: 'metadata' }, [DEAL_DEF]: { c: 'admin' } },
      defEntityTypes: { [TICKET_DEF]: 'ticket', [DEAL_DEF]: null },
    })
    for (const id of ['a', 'b', 'c']) {
      const listed = primaryEntityThreadIdsAtOrAbove(v, 'metadata').includes(id)
      const derived = primaryEntityThreadRung(v, id)
      expect(listed).toBe(derived !== 'none')
    }
  })
})
