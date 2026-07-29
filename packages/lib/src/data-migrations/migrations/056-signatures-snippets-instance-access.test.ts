// packages/lib/src/data-migrations/migrations/056-signatures-snippets-instance-access.test.ts

import { describe, expect, it } from 'vitest'
import {
  buildInstanceAccessRows,
  type InstanceAccessSeed,
  normalizeSingleSelect,
} from './056-signatures-snippets-instance-access'

const seed = (over: Partial<InstanceAccessSeed> = {}): InstanceAccessSeed => ({
  organizationId: 'org1',
  instanceId: 'i1',
  ownerId: 'u1',
  shareWithOrg: false,
  ...over,
})

/**
 * The DB's `ResourceAccess_entity_grantee_key` unique constraint, as a key —
 * the conflict target both write paths arbitrate on, so a re-run that adds no
 * NEW key is exactly what "idempotent" means here.
 */
const uniqueKey = (row: {
  organizationId: string
  entityDefinitionId: string
  entityInstanceId?: string | null
  granteeType: string
  granteeId: string
}) =>
  [
    row.organizationId,
    row.entityDefinitionId,
    row.entityInstanceId ?? '',
    row.granteeType,
    row.granteeId,
  ].join('|')

describe('normalizeSingleSelect', () => {
  it('unwraps the array shape a SINGLE_SELECT reads back as', () => {
    expect(normalizeSingleSelect(['org_members'])).toBe('org_members')
  })

  it('passes a scalar through', () => {
    expect(normalizeSingleSelect('private')).toBe('private')
  })

  it('returns undefined for empty, null and non-string shapes', () => {
    expect(normalizeSingleSelect([])).toBeUndefined()
    expect(normalizeSingleSelect(null)).toBeUndefined()
    expect(normalizeSingleSelect(undefined)).toBeUndefined()
    expect(normalizeSingleSelect('')).toBeUndefined()
    expect(normalizeSingleSelect(42)).toBeUndefined()
    expect(normalizeSingleSelect({ value: 'org_members' })).toBeUndefined()
  })
})

describe('buildInstanceAccessRows — snippets', () => {
  // `sharingType = PRIVATE` and `GROUPS` both arrive as `shareWithOrg: false`:
  // PRIVATE was never shared, and the user decision of 2026-07-28 makes the
  // legacy GROUPS rows disposable rather than something to reconstruct.
  it('PRIVATE → owner admin row only', () => {
    const { ownerRows, orgRows, skipped } = buildInstanceAccessRows('snippet', [seed()])
    expect(skipped).toEqual([])
    expect(orgRows).toEqual([])
    expect(ownerRows).toHaveLength(1)
    expect(ownerRows[0]).toMatchObject({
      organizationId: 'org1',
      entityDefinitionId: 'snippet',
      entityInstanceId: 'i1',
      granteeType: 'user',
      granteeId: 'u1',
      permission: 'admin',
      grantedById: 'u1',
    })
  })

  it('GROUPS → owner admin row only (legacy grant rows left as they are)', () => {
    const { ownerRows, orgRows } = buildInstanceAccessRows('snippet', [
      seed({ shareWithOrg: false }),
    ])
    expect(ownerRows.map((r) => r.granteeType)).toEqual(['user'])
    expect(orgRows).toEqual([])
  })

  it('ORGANIZATION → owner admin row plus role:org_member @ view', () => {
    const { ownerRows, orgRows } = buildInstanceAccessRows('snippet', [
      seed({ shareWithOrg: true }),
    ])
    expect(ownerRows).toHaveLength(1)
    expect(orgRows).toHaveLength(1)
    expect(orgRows[0]).toMatchObject({
      entityDefinitionId: 'snippet',
      entityInstanceId: 'i1',
      granteeType: 'role',
      granteeId: 'org_member',
      permission: 'view',
    })
  })
})

describe('buildInstanceAccessRows — signatures', () => {
  it('visibility=private → owner admin row only', () => {
    const { ownerRows, orgRows } = buildInstanceAccessRows('signature', [
      seed({ instanceId: 'sig1' }),
    ])
    expect(orgRows).toEqual([])
    expect(ownerRows).toHaveLength(1)
    expect(ownerRows[0]).toMatchObject({
      entityDefinitionId: 'signature',
      entityInstanceId: 'sig1',
      granteeType: 'user',
      permission: 'admin',
    })
  })

  it('visibility=org_members → owner admin row plus role:org_member @ view', () => {
    const { ownerRows, orgRows } = buildInstanceAccessRows('signature', [
      seed({ instanceId: 'sig1', shareWithOrg: true }),
    ])
    expect(ownerRows.map((r) => `${r.granteeType}:${r.permission}`)).toEqual(['user:admin'])
    expect(orgRows.map((r) => `${r.granteeType}:${r.permission}`)).toEqual(['role:view'])
    expect([...ownerRows, ...orgRows].every((r) => r.entityDefinitionId === 'signature')).toBe(true)
  })
})

/**
 * The owner row is the ONE row that must never be skipped on conflict. A legacy
 * `setSnippetSharing` GROUPS write could already hold `user:<owner> @ view` on
 * the owner's own snippet — dev had two — and with `baselineAtCreate: true` plus
 * no ADMIN override (§0.6) that owner could no longer share or delete their own
 * content. The split return type is what lets `run()` upsert this family and
 * merely insert the other.
 */
describe('write-path split', () => {
  it('separates the raise-to-admin family from the never-stomp family', () => {
    const { ownerRows, orgRows } = buildInstanceAccessRows('snippet', [
      seed({ instanceId: 'a', shareWithOrg: true }),
      seed({ instanceId: 'b', shareWithOrg: true }),
    ])
    expect(ownerRows.every((r) => r.granteeType === 'user' && r.permission === 'admin')).toBe(true)
    expect(orgRows.every((r) => r.granteeType === 'role' && r.permission === 'view')).toBe(true)
    expect(ownerRows).toHaveLength(2)
    expect(orgRows).toHaveLength(2)
  })
})

describe('buildInstanceAccessRows — unresolvable owner', () => {
  // `ResourceAccess.grantedById` is a real FK to `User`. A signature whose
  // `created_by_id` resolves to nothing (no `EntityInstance.createdById`, no
  // user-kind actor value) must be SKIPPED and reported, never written with a
  // fabricated owner — that would abort the whole migration on the FK.
  it('skips the instance entirely and reports it', () => {
    const orphan = seed({ instanceId: 'sig_orphan', ownerId: null, shareWithOrg: true })
    const { ownerRows, orgRows, skipped } = buildInstanceAccessRows('signature', [orphan])
    expect(ownerRows).toEqual([])
    expect(orgRows).toEqual([])
    expect(skipped).toEqual([orphan])
  })

  it('does not let one orphan suppress its siblings', () => {
    const { ownerRows, orgRows, skipped } = buildInstanceAccessRows('signature', [
      seed({ instanceId: 'a' }),
      seed({ instanceId: 'orphan', ownerId: null }),
      seed({ instanceId: 'b', shareWithOrg: true }),
    ])
    expect(ownerRows.map((r) => r.entityInstanceId)).toEqual(['a', 'b'])
    expect(orgRows.map((r) => r.entityInstanceId)).toEqual(['b'])
    expect(skipped.map((s) => s.instanceId)).toEqual(['orphan'])
  })

  it('never emits a row with a null grantee or granter', () => {
    const { ownerRows, orgRows } = buildInstanceAccessRows('snippet', [
      seed({ instanceId: 'a' }),
      seed({ instanceId: 'orphan', ownerId: null, shareWithOrg: true }),
    ])
    expect(
      [...ownerRows, ...orgRows].every((r) => Boolean(r.granteeId) && Boolean(r.grantedById))
    ).toBe(true)
  })
})

describe('idempotency', () => {
  const seeds = [
    seed({ instanceId: 'a' }),
    seed({ instanceId: 'b', shareWithOrg: true }),
    seed({ instanceId: 'c', ownerId: 'u2', shareWithOrg: true }),
  ]

  it('produces identical rows on a re-run', () => {
    const first = buildInstanceAccessRows('snippet', seeds)
    const second = buildInstanceAccessRows('snippet', seeds)
    expect(second.ownerRows).toEqual(first.ownerRows)
    expect(second.orgRows).toEqual(first.orgRows)
  })

  it('adds no new unique keys on a second apply', () => {
    const applied = new Set<string>()
    const apply = () => {
      const { ownerRows, orgRows } = buildInstanceAccessRows('snippet', seeds)
      for (const row of [...ownerRows, ...orgRows]) applied.add(uniqueKey(row))
    }

    apply()
    const afterFirst = applied.size
    expect(afterFirst).toBe(5) // 3 owner rows + 2 org-shared rows

    apply()
    expect(applied.size).toBe(afterFirst)
  })

  it('keeps signature and snippet rows in separate keyspaces', () => {
    const applied = new Set<string>()
    for (const row of buildInstanceAccessRows('snippet', [seed()]).ownerRows) {
      applied.add(uniqueKey(row))
    }
    for (const row of buildInstanceAccessRows('signature', [seed()]).ownerRows) {
      applied.add(uniqueKey(row))
    }
    // Same org + instance id, different resource key — two distinct rows.
    expect(applied.size).toBe(2)
  })
})
