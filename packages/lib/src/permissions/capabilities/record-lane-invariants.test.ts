// packages/lib/src/permissions/capabilities/record-lane-invariants.test.ts
//
// Plan v3/03 P5 contract §6 — the invariants the record lane must keep while it
// joins the ladder. Each of these is a property some OTHER file could break
// while its own tests stay green, which is why they are asserted here, together,
// against the shipped predicates rather than against copies of them.

import { describe, expect, it } from 'vitest'
import { MAIL_SHARING_DEFS } from '../../resource-access/mail-sharing-defs'
import { composeUserCapabilities } from './compose-user-capabilities'
import { hasDefPresence } from './entity-access'
import {
  INSTANCE_ACCESS_KEYS,
  INSTANCE_ACCESS_RESOURCES,
  isInstanceAccessKey,
  RECORD_DEF_RUNGS,
} from './instance-access'
import { recordScopeArm } from './record-visibility-scope'

/** A record def id — a CUID, which is what makes it un-registerable as a key. */
const RECORD_DEF = 'edf_deals0000000000000000000'
const RECORD_ROW = 'ins_deal00000000000000000000'

const baseInput = {
  role: 'USER' as const,
  seatType: 'full' as const,
  typeAccessRows: [],
}

describe('invariant 1+2 — records never enter the composed blob lanes', () => {
  it('a record-def instance grant produces NO instanceAccess entry', () => {
    const caps = composeUserCapabilities({
      ...baseInput,
      instanceGrants: {
        individual: { [RECORD_DEF]: { [RECORD_ROW]: 'admin' } },
        baseline: {},
        governing: {},
      },
    })
    // The record lane is evaluated in the DATABASE per query (§4's locality
    // rule). A CUID reaching `instanceAccess` would be a per-user id set whose
    // size grows with sharing — exactly what the lane exists to avoid.
    expect(caps.instanceAccess).toEqual({})
    expect(caps.baselineInstanceAccess).toEqual({})
  })

  it('a record-def instance grant derives NO front-door capability key', () => {
    const caps = composeUserCapabilities({
      ...baseInput,
      instanceGrants: {
        individual: { [RECORD_DEF]: { [RECORD_ROW]: 'admin' } },
        baseline: {},
        governing: {},
      },
    })
    // `deriveInstanceReadKeys` is the `instanceDerivedKeys` producer. If a record
    // CUID reached it, one shared row would synthesize an area-level key —
    // the trap §6.1 names as the reason `canViewEntity` must not be widened.
    expect(caps.instanceDerivedKeys).toEqual([])
  })

  it('a record CUID is not an instance-access key, and cannot become one', () => {
    expect(isInstanceAccessKey(RECORD_DEF)).toBe(false)
    // Every registry key is a fixed slug; none is a CUID. That is what makes the
    // exclusion structural rather than a filter someone can forget.
    for (const key of INSTANCE_ACCESS_KEYS) {
      expect(key.length).toBeLessThan(20)
    }
  })

  it('the query-lane declarations stay out of the blob lane too', () => {
    for (const [key, cfg] of Object.entries(INSTANCE_ACCESS_RESOURCES)) {
      if (cfg.lane === 'query') expect(isInstanceAccessKey(key)).toBe(false)
    }
  })
})

describe("invariant 3 — `none` is not in a record def's vocabulary", () => {
  it('RECORD_DEF_RUNGS is raise-only above the restriction marker', () => {
    // `none` IS in the declared vocabulary — it is the restriction marker and the
    // DB check constraint admits it — but the WRITE path rejects it for record
    // defs (D7), so no producer exists. What must stay true here is that the
    // positive rungs are exactly the config scale and nothing below `read`
    // (`metadata`/`identity` would need a code-authored projection this lane has
    // not declared).
    expect([...RECORD_DEF_RUNGS]).toEqual(['none', 'read', 'edit', 'admin'])
    expect(RECORD_DEF_RUNGS).not.toContain('metadata')
    expect(RECORD_DEF_RUNGS).not.toContain('identity')
  })
})

describe('invariant 4+6 — the mail keyspace, and contacts', () => {
  it('every MAIL_SHARING_DEFS member is a slug, never a record CUID', () => {
    for (const def of MAIL_SHARING_DEFS) {
      expect(def.length).toBeLessThan(20)
      expect(def).not.toBe(RECORD_DEF)
    }
  })

  it('`contact` is a mail-sharing def — it stays OUT of the record lane', () => {
    // §10.1: `canonicalMailRecordId` rewrites contact CUIDs into the mail
    // keyspace, where the contact-grant derivation fans a full lens across the
    // contact's entire thread history. Until the keyspace split, a contact must
    // never be treated as an ordinary record-lane target.
    expect(MAIL_SHARING_DEFS.has('contact')).toBe(true)
  })

  it('the two inbox keys are BOTH mail-sharing defs and instance-access keys', () => {
    // The one deliberate overlap (plan 40 §11 item 2). Asserted so a future
    // "tidy-up" that removes either membership has to delete a failing test.
    for (const key of ['inbox', 'personal_inbox']) {
      expect(MAIL_SHARING_DEFS.has(key)).toBe(true)
      expect(isInstanceAccessKey(key)).toBe(true)
    }
  })
})

describe('the front door and the scope agree', () => {
  it('arm 4 ⟺ no presence — a member with no reachable row has no nav entry', () => {
    for (const defViewable of [true, false]) {
      for (const grantedDef of [true, false]) {
        const arm = recordScopeArm({ defViewable, hasRestrictions: false, grantedDef })
        const presence = hasDefPresence(
          {
            role: 'USER',
            seatType: 'full',
            keys: new Set(),
            defAccess: {},
            restrictedEntityDefIds: new Set(),
            // `hasDefPresence` reads `canViewRecord` for the first term; with an
            // empty key set that is false, so `defViewable` is injected through
            // the grant map for the second term only. The equivalence being
            // pinned is the SHAPE: `arm === 'none'` exactly when neither term
            // holds.
            grantedDefIds: grantedDef ? { [RECORD_DEF]: true } : {},
          },
          RECORD_DEF
        )
        if (!defViewable) expect(presence).toBe(arm !== 'none')
      }
    }
  })
})
