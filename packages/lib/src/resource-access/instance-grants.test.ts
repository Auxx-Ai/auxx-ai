// packages/lib/src/resource-access/instance-grants.test.ts

import { ResourceGranteeType, type Rung } from '@auxx/database/enums'
import { describe, expect, it } from 'vitest'
import { composeUserCapabilities } from '../permissions/capabilities/compose-user-capabilities'
import { Level, PermissionKey } from '../permissions/capabilities/registry'
import { MEMBER_BASELINE_LEVELS } from '../permissions/capabilities/seat-policy'
import { composeUserInstanceGrants } from '../permissions/visibility/compute-user-instance-grants'
import { ORG_MEMBER_GRANTEE_ID } from './grantee-resolution'
import {
  bucketInstanceGrantRows,
  grantedDefIds,
  type InstanceGrantRow,
  isIndividualGranteeType,
  mergedRung,
} from './instance-grants'

/**
 * Plan v3/03 P4 — the ONE bucketing pass, and the two blobs that project from it.
 *
 * The point of this file is the SECOND describe block. Before P4 the capability
 * composer's instance query carried `entityDefinitionId IN (INSTANCE_ACCESS_KEYS)`
 * in SQL, so a thread share or a record-def grant could not physically reach it.
 * Unifying the two queries onto the wider (mail) shape means those rows DO reach
 * it now, and `isInstanceAccessKey` in `flattenBlobLane` / `deriveInstanceReadKeys`
 * is the only thing keeping them out of the capability blob. That is a load-bearing
 * predicate promoted from belt-and-braces to the sole guard, so it gets a test.
 */

const USER = 'u_1'
const RECORD_DEF = 'clx0000000000000000000000'

const row = (over: Partial<InstanceGrantRow>): InstanceGrantRow => ({
  entityDefinitionId: 'dataset',
  entityInstanceId: 'i_1',
  granteeType: ResourceGranteeType.user,
  granteeId: USER,
  rung: 'read',
  ...over,
})

const baselineRow = (over: Partial<InstanceGrantRow>): InstanceGrantRow =>
  row({ granteeType: ResourceGranteeType.role, granteeId: ORG_MEMBER_GRANTEE_ID, ...over })

describe('bucketInstanceGrantRows — the lane split', () => {
  it.each([
    [ResourceGranteeType.user, true],
    [ResourceGranteeType.group, true],
    [ResourceGranteeType.profile, true],
    [ResourceGranteeType.role, false],
  ] as const)('sorts %s into the individual lane: %s', (granteeType, individual) => {
    expect(isIndividualGranteeType(granteeType)).toBe(individual)
    const bucket = bucketInstanceGrantRows([row({ granteeType, granteeId: 'g' })])
    const lane = individual ? bucket.individual : bucket.baseline
    const other = individual ? bucket.baseline : bucket.individual
    expect(lane.dataset?.i_1).toBe('read')
    expect(other).toEqual({})
  })

  /**
   * The allowlist direction. An unrecognised grantee kind must land in the
   * BASELINE lane, which is the area-GATED one — a denylist (`!== 'role'`) would
   * wave it past the area level instead.
   */
  it('sorts an UNKNOWN grantee kind into the gated baseline lane', () => {
    const bucket = bucketInstanceGrantRows([
      row({ granteeType: 'team_of_the_future', granteeId: 'x' }),
    ])
    expect(bucket.individual).toEqual({})
    expect(bucket.baseline.dataset?.i_1).toBe('read')
  })

  it('keeps the HIGHEST rung per (def, instance), in either row order', () => {
    const rows = [row({ rung: 'none' }), row({ rung: 'edit' })]
    for (const ordering of [rows, [...rows].reverse()]) {
      expect(bucketInstanceGrantRows(ordering).individual.dataset?.i_1).toBe('edit')
    }
  })

  it('keeps two defs apart even though instance ids are globally unique', () => {
    const bucket = bucketInstanceGrantRows([
      row({ entityDefinitionId: 'thread', entityInstanceId: 't_1', rung: 'metadata' }),
      row({ entityDefinitionId: RECORD_DEF, entityInstanceId: 'e_1', rung: 'admin' }),
    ])
    expect(bucket.individual.thread).toEqual({ t_1: 'metadata' })
    expect(bucket.individual[RECORD_DEF]).toEqual({ e_1: 'admin' })
    expect(grantedDefIds(bucket).sort()).toEqual([RECORD_DEF, 'thread'].sort())
  })

  it('keeps `none` — it is the restriction marker, not an absence', () => {
    const bucket = bucketInstanceGrantRows([row({ rung: 'none' })])
    expect(bucket.individual.dataset?.i_1).toBe('none')
  })

  describe('the governing set — `isGoverningInstanceRow`, per member', () => {
    it('marks a baseline row at ANY rung, including a down-tier', () => {
      for (const rung of ['none', 'metadata', 'identity', 'read', 'admin'] as Rung[]) {
        expect(bucketInstanceGrantRows([baselineRow({ rung })]).governing).toEqual({ i_1: true })
      }
    })

    it('marks any `none` row, whatever the grantee', () => {
      expect(bucketInstanceGrantRows([row({ rung: 'none' })]).governing).toEqual({ i_1: true })
    })

    it('does NOT mark an ordinary positive individual grant — sharing is not restricting', () => {
      expect(bucketInstanceGrantRows([row({ rung: 'admin' })]).governing).toEqual({})
    })
  })

  it('mergedRung folds both lanes, highest wins', () => {
    const bucket = bucketInstanceGrantRows([
      row({ rung: 'metadata' }),
      baselineRow({ rung: 'read' }),
    ])
    expect(mergedRung(bucket, 'dataset', 'i_1')).toBe('read')
    expect(mergedRung(bucket, 'dataset', 'nope')).toBeUndefined()
    expect(mergedRung(bucket, 'kb', 'i_1')).toBeUndefined()
  })
})

/**
 * §4's locality principle, now enforced in CODE rather than in the WHERE clause.
 *
 * Each case feeds rows that the pre-P4 capability query could never have returned,
 * and asserts the composed blob is unchanged by them.
 */
describe('composeUserCapabilities — non-blob-lane rows reach it and are dropped', () => {
  const compose = (rows: InstanceGrantRow[]) =>
    composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      profileLevels: MEMBER_BASELINE_LEVELS,
      profileBaseLevel: null,
      typeAccessRows: [],
      instanceGrants: bucketInstanceGrantRows(rows),
    })

  it.each([
    ['a record definition CUID', RECORD_DEF],
    ['the query-lane `thread` key', 'thread'],
    ['the query-lane `sequence` key', 'sequence'],
    ['the mail `contact` slug', 'contact'],
  ])('drops %s from both instance maps and from instanceDerivedKeys', (_label, defId) => {
    const caps = compose([
      row({ entityDefinitionId: defId, entityInstanceId: 'x_1', rung: 'admin' }),
      row({
        entityDefinitionId: defId,
        entityInstanceId: 'x_2',
        rung: 'admin',
        granteeType: ResourceGranteeType.role,
        granteeId: ORG_MEMBER_GRANTEE_ID,
      }),
    ])
    expect(caps.instanceAccess).toEqual({})
    expect(caps.baselineInstanceAccess).toEqual({})
    expect(caps.instanceDerivedKeys).toEqual([])
  })

  it('still admits a blob-lane row from the same unfiltered batch', () => {
    const caps = compose([
      row({ entityDefinitionId: RECORD_DEF, entityInstanceId: 'rec_1', rung: 'admin' }),
      row({ entityDefinitionId: 'thread', entityInstanceId: 't_1', rung: 'read' }),
      row({ entityDefinitionId: 'dataset', entityInstanceId: 'ds_1', rung: 'edit' }),
    ])
    expect(caps.instanceAccess).toEqual({ ds_1: 'edit' })
    expect(caps.instanceDerivedKeys).toContain(PermissionKey.datasetsView)
  })

  it('derives the front-door key from the INDIVIDUAL lane only', () => {
    const baselineOnly = compose([
      baselineRow({ entityDefinitionId: 'dashboard', entityInstanceId: 'dash_1', rung: 'read' }),
    ])
    expect(baselineOnly.instanceDerivedKeys).toEqual([])
    expect(baselineOnly.baselineInstanceAccess).toEqual({ dash_1: 'read' })
  })
})

/**
 * The other projection of the SAME bucket. Both blobs are composed from one
 * value here, which is what "one bucketing pass feeding capabilities +
 * instance-grants" means in practice.
 */
describe('composeUserInstanceGrants — the def-keyed projection', () => {
  const INBOX = 'ib_1'
  const rows: InstanceGrantRow[] = [
    row({ entityDefinitionId: 'thread', entityInstanceId: 't_1', rung: 'metadata' }),
    row({ entityDefinitionId: 'contact', entityInstanceId: 'c_1', rung: 'read' }),
    row({ entityDefinitionId: RECORD_DEF, entityInstanceId: 'e_1', rung: 'edit' }),
    row({ entityDefinitionId: 'inbox', entityInstanceId: INBOX, rung: 'admin' }),
    row({ entityDefinitionId: 'dashboard', entityInstanceId: 'dash_1', rung: 'admin' }),
  ]
  const bucket = bucketInstanceGrantRows(rows)

  const vis = composeUserInstanceGrants({
    userId: USER,
    role: 'USER',
    inboxesAreaLevel: Level.Read,
    inboxes: [{ id: INBOX }],
    instanceGrants: bucket,
  })

  it('keys grants by DEFINITION, not by a def-named field', () => {
    expect(vis.grants.thread).toEqual({ t_1: 'metadata' })
    expect(vis.grants.contact).toEqual({ c_1: 'read' })
    expect(vis.grants[RECORD_DEF]).toEqual({ e_1: 'edit' })
  })

  it('keeps the record grant at its STORED rung — the clamp is a read-time concern', () => {
    expect(vis.grants[RECORD_DEF]?.e_1).toBe('edit')
  })

  it('folds inbox defs into inboxLens and keeps them OUT of the grant map', () => {
    expect(vis.grants.inbox).toBeUndefined()
    expect(vis.grants.personal_inbox).toBeUndefined()
    expect(vis.inboxLens[INBOX]).toBe('read')
  })

  it('drops the instance-access config resources', () => {
    expect(vis.grants.dashboard).toBeUndefined()
  })

  it('composes from the same bucket the capability blob does', () => {
    const caps = composeUserCapabilities({
      role: 'USER',
      seatType: 'full',
      profileLevels: MEMBER_BASELINE_LEVELS,
      profileBaseLevel: null,
      typeAccessRows: [],
      instanceGrants: bucket,
    })
    // Disjoint by construction: the capability blob carries the blob-lane keys,
    // this one carries the mail/record lane. Neither sees the other's rows.
    expect(caps.instanceAccess).toEqual({ dash_1: 'admin', [INBOX]: 'admin' })
    expect(Object.keys(vis.grants).sort()).toEqual([RECORD_DEF, 'contact', 'thread'].sort())
  })
})
