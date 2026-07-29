// packages/lib/src/data-migrations/migrations/060-personal-inbox-move.test.ts

import { describe, expect, it } from 'vitest'
import type { Lens } from '../../permissions/visibility/lens'
import {
  buildFloorRow,
  DROPPED_PERSONAL_ATTRS,
  findStrayInstanceGrants,
  type GrantRow,
  type KeyspaceProbeRow,
  type MovingFieldValue,
  planFieldValueMoves,
  planGrantRekey,
} from './060-personal-inbox-move'

const probe = (over: Partial<KeyspaceProbeRow> = {}): KeyspaceProbeRow => ({
  id: 'ra_1',
  organizationId: 'org1',
  entityDefinitionId: 'def_cuid_inbox',
  entityInstanceId: 'inbox_1',
  ...over,
})

const grant = (over: Partial<GrantRow> = {}): GrantRow => ({
  id: 'g1',
  granteeType: 'user',
  granteeId: 'u1',
  permission: 'admin',
  lens: null,
  ...over,
})

// ═══════════════════════════════════════════════════════════════════════════
// PRE-FLIGHT (plan 40 §4.1, corrected)
// ═══════════════════════════════════════════════════════════════════════════

describe('findStrayInstanceGrants', () => {
  it('aborts on an instance-level CUID-keyed mail row', () => {
    const stray = probe()
    expect(findStrayInstanceGrants([stray])).toEqual([stray])
  })

  // The plan's wording ("zero mail-def rows keyed by def CUID") also catches
  // these, and it would make the pre-flight unpassable: a CUID-keyed row with a
  // NULL instance is the dual keyspace's OTHER, legitimate meaning — a def-level
  // record RESTRICTION marker (`restricted-entity-def-ids-provider.ts`). Dev's
  // DemoOrg1 holds three of them on `contact`.
  it('does NOT abort on a legitimate def-level CUID row', () => {
    expect(findStrayInstanceGrants([probe({ entityInstanceId: null })])).toEqual([])
  })

  it('reports only the instance-level rows out of a mixed set', () => {
    const stray = probe({ id: 'stray' })
    const legit = probe({ id: 'legit', entityInstanceId: null })
    expect(findStrayInstanceGrants([legit, stray, legit]).map((r) => r.id)).toEqual(['stray'])
  })

  it('passes cleanly on an empty keyspace', () => {
    expect(findStrayInstanceGrants([])).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// FIELDVALUE REMAP
// ═══════════════════════════════════════════════════════════════════════════

/** Dev's actual seven: five remap, two drop. */
const DEV_VALUES: MovingFieldValue[] = [
  { id: 'v_name', fieldId: 'old_name', systemAttribute: 'inbox_name' },
  { id: 'v_color', fieldId: 'old_color', systemAttribute: 'inbox_color' },
  { id: 'v_status', fieldId: 'old_status', systemAttribute: 'inbox_status' },
  { id: 'v_settings', fieldId: 'old_settings', systemAttribute: 'inbox_settings' },
  { id: 'v_owner', fieldId: 'old_owner', systemAttribute: 'inbox_owner_user_id' },
  { id: 'v_lens', fieldId: 'old_lens', systemAttribute: 'inbox_default_lens' },
  { id: 'v_personal', fieldId: 'old_personal', systemAttribute: 'inbox_is_personal' },
]

const NEW_FIELDS = new Map<string, string>([
  ['inbox_name', 'new_name'],
  ['inbox_color', 'new_color'],
  ['inbox_status', 'new_status'],
  ['inbox_settings', 'new_settings'],
  ['inbox_owner_user_id', 'new_owner'],
  ['inbox_description', 'new_description'],
  ['created_by_id', 'new_created_by'],
])

describe('planFieldValueMoves', () => {
  it('remaps the five survivors onto the new def and drops the two retired attributes', () => {
    const plan = planFieldValueMoves({ values: DEV_VALUES, newFieldIdByAttr: NEW_FIELDS })
    expect(plan.updates).toEqual([
      { id: 'v_name', fieldId: 'new_name' },
      { id: 'v_color', fieldId: 'new_color' },
      { id: 'v_status', fieldId: 'new_status' },
      { id: 'v_settings', fieldId: 'new_settings' },
      { id: 'v_owner', fieldId: 'new_owner' },
    ])
    expect(plan.deletes).toEqual(['v_lens', 'v_personal'])
    expect(plan.unmapped).toEqual([])
  })

  it('drops exactly the attributes DROPPED_PERSONAL_ATTRS names', () => {
    const plan = planFieldValueMoves({ values: DEV_VALUES, newFieldIdByAttr: NEW_FIELDS })
    const droppedAttrs = plan.deletes.map(
      (id) => DEV_VALUES.find((v) => v.id === id)?.systemAttribute
    )
    expect(droppedAttrs).toEqual([...DROPPED_PERSONAL_ATTRS])
  })

  // The second half of idempotency: a value that already points at the new def's
  // field produces no update, so a re-run after a partial failure writes nothing.
  it('is a no-op on already-remapped values', () => {
    const remapped: MovingFieldValue[] = [
      { id: 'v_name', fieldId: 'new_name', systemAttribute: 'inbox_name' },
      { id: 'v_owner', fieldId: 'new_owner', systemAttribute: 'inbox_owner_user_id' },
    ]
    const plan = planFieldValueMoves({ values: remapped, newFieldIdByAttr: NEW_FIELDS })
    expect(plan.updates).toEqual([])
    expect(plan.deletes).toEqual([])
    expect(plan.unmapped).toEqual([])
  })

  // A dropped attribute is deleted whichever def's field it still points at, so
  // a half-applied move cleans up rather than stranding the marker.
  it('still deletes a retired attribute that was already remapped', () => {
    const plan = planFieldValueMoves({
      values: [{ id: 'v_personal', fieldId: 'new_personal', systemAttribute: 'inbox_is_personal' }],
      newFieldIdByAttr: NEW_FIELDS,
    })
    expect(plan.deletes).toEqual(['v_personal'])
    expect(plan.updates).toEqual([])
  })

  it('reports a value with no counterpart instead of silently dropping it', () => {
    const orphan: MovingFieldValue = { id: 'v_x', fieldId: 'old_x', systemAttribute: 'inbox_zzz' }
    const plan = planFieldValueMoves({ values: [orphan], newFieldIdByAttr: NEW_FIELDS })
    expect(plan.unmapped).toEqual([orphan])
    expect(plan.updates).toEqual([])
    expect(plan.deletes).toEqual([])
  })

  it('reports a custom (non-system) field value rather than remapping it', () => {
    const custom: MovingFieldValue = { id: 'v_c', fieldId: 'old_c', systemAttribute: null }
    const plan = planFieldValueMoves({ values: [custom], newFieldIdByAttr: NEW_FIELDS })
    expect(plan.unmapped).toEqual([custom])
  })

  it('produces the identical plan when run twice on the same input', () => {
    const first = planFieldValueMoves({ values: DEV_VALUES, newFieldIdByAttr: NEW_FIELDS })
    const second = planFieldValueMoves({ values: DEV_VALUES, newFieldIdByAttr: NEW_FIELDS })
    expect(second).toEqual(first)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// RESOURCEACCESS RE-KEY
// ═══════════════════════════════════════════════════════════════════════════

describe('planGrantRekey', () => {
  it('flips a row with no counterpart in place — id and createdAt survive', () => {
    const plan = planGrantRekey({ legacy: [grant()], existing: [] })
    expect(plan).toEqual({ recode: ['g1'], raise: [], drop: [] })
  })

  it('re-keys dev’s single personal-inbox owner row', () => {
    const owner = grant({ id: 'ra_owner', granteeId: 'JR28eYz', permission: 'admin' })
    expect(planGrantRekey({ legacy: [owner], existing: [] }).recode).toEqual(['ra_owner'])
  })

  // Phase 0b's lesson on this exact table: letting the unique arbiter pick the
  // survivor downgraded a creator-Manager from `admin` to `view`. The stronger
  // row must win explicitly, and it must be RAISED before the legacy row is
  // dropped so no ordering of partial failures can lose the permission.
  it('raises a weaker counterpart to the legacy row’s strength, then drops the legacy row', () => {
    const plan = planGrantRekey({
      legacy: [grant({ id: 'legacy', permission: 'admin', lens: null })],
      existing: [grant({ id: 'kept', permission: 'view', lens: 'subject' })],
    })
    expect(plan.raise).toEqual([{ id: 'kept', permission: 'admin', lens: null }])
    expect(plan.drop).toEqual(['legacy'])
    expect(plan.recode).toEqual([])
  })

  it('never downgrades a stronger counterpart', () => {
    const plan = planGrantRekey({
      legacy: [grant({ id: 'legacy', permission: 'view', lens: 'metadata' })],
      existing: [grant({ id: 'kept', permission: 'admin', lens: null })],
    })
    expect(plan.raise).toEqual([])
    expect(plan.drop).toEqual(['legacy'])
  })

  it('compares lens, not just permission, between two view rows', () => {
    const stronger = planGrantRekey({
      legacy: [grant({ id: 'legacy', permission: 'view', lens: 'full' })],
      existing: [grant({ id: 'kept', permission: 'view', lens: 'metadata' })],
    })
    expect(stronger.raise).toEqual([{ id: 'kept', permission: 'view', lens: 'full' }])

    const weaker = planGrantRekey({
      legacy: [grant({ id: 'legacy', permission: 'view', lens: 'metadata' })],
      existing: [grant({ id: 'kept', permission: 'view', lens: 'full' })],
    })
    expect(weaker.raise).toEqual([])
  })

  it('treats a lens-less view row as full, matching grantLens', () => {
    const plan = planGrantRekey({
      legacy: [grant({ id: 'legacy', permission: 'view', lens: null })],
      existing: [grant({ id: 'kept', permission: 'view', lens: 'subject' })],
    })
    expect(plan.raise).toEqual([{ id: 'kept', permission: 'view', lens: null }])
  })

  it('matches counterparts per grantee, not per instance', () => {
    const plan = planGrantRekey({
      legacy: [
        grant({ id: 'l_user', granteeType: 'user', granteeId: 'u1' }),
        grant({ id: 'l_group', granteeType: 'group', granteeId: 'u1' }),
      ],
      existing: [grant({ id: 'e_user', granteeType: 'user', granteeId: 'u1' })],
    })
    // Same granteeId, different granteeType — a distinct unique key.
    expect(plan.recode).toEqual(['l_group'])
    expect(plan.drop).toEqual(['l_user'])
  })

  // A re-run finds no legacy rows at all: everything is already in the new
  // keyspace, so the plan is empty and the DB is untouched.
  it('is empty once the re-key has already happened', () => {
    expect(planGrantRekey({ legacy: [], existing: [grant({ id: 'moved' })] })).toEqual({
      recode: [],
      raise: [],
      drop: [],
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// FLOOR ROWS (plan 40 §4.1)
// ═══════════════════════════════════════════════════════════════════════════

const floor = (lens: Lens) => buildFloorRow({ organizationId: 'org1', instanceId: 'ib_1', lens })

describe('buildFloorRow', () => {
  // `baselineAtCreate: false` + no row ⇒ the member's `Area.inboxes` level,
  // which IS the org-shared default. Writing a row here would be redundant at
  // best and a downgrade vector at worst.
  it('writes nothing for a full-lens inbox', () => {
    expect(floor('full')).toBeNull()
  })

  it('preserves the lens on a subject-floor inbox', () => {
    expect(floor('subject')).toMatchObject({
      entityDefinitionId: 'inbox',
      entityInstanceId: 'ib_1',
      granteeType: 'role',
      granteeId: 'org_member',
      permission: 'view',
      lens: 'subject',
    })
  })

  it('preserves the lens on a metadata-floor inbox', () => {
    expect(floor('metadata')).toMatchObject({ permission: 'view', lens: 'metadata' })
  })

  // The v2 restriction marker. `lens` stays null: it only discriminates `view`
  // rows, and `compute-user-mail-visibility.grantLens` reads `none` as `none`.
  it('writes the restriction marker for a none-floor inbox', () => {
    expect(floor('none')).toMatchObject({
      granteeType: 'role',
      granteeId: 'org_member',
      permission: 'none',
      lens: null,
    })
  })

  // `grantedById` is a real FK to `User` and a migration has no user actor.
  it('leaves grantedById null rather than inventing a granter', () => {
    expect(floor('none')?.grantedById).toBeNull()
    expect(floor('subject')?.grantedById).toBeNull()
  })

  it('always keys the shared slug, never the new personal one', () => {
    for (const lens of ['metadata', 'subject', 'none'] as const) {
      expect(floor(lens)?.entityDefinitionId).toBe('inbox')
    }
  })
})

/**
 * The §4.1 fail-open guard, as a property: per org, the number of rows written
 * must equal the number of shared inboxes whose floor is not `full`. Dev's
 * DemoOrg1 is exactly this shape — one `subject`, one `none`, two `full` — and
 * the plan's stale "1 baseline row" is wrong: a shared inbox moved `full → none`
 * after that census, so it is TWO.
 */
describe('floor-row count parity', () => {
  const devSharedInboxes: { instanceId: string; lens: Lens }[] = [
    { instanceId: 'ib_chat_support', lens: 'none' },
    { instanceId: 'ib_restricted', lens: 'subject' },
    { instanceId: 'ib_open_a', lens: 'full' },
    { instanceId: 'ib_open_b', lens: 'full' },
  ]

  it('writes one row per non-full inbox and none for the rest', () => {
    const rows = devSharedInboxes
      .map((i) => buildFloorRow({ organizationId: 'org1', ...i }))
      .filter((r) => r !== null)
    expect(rows).toHaveLength(devSharedInboxes.filter((i) => i.lens !== 'full').length)
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r?.permission).sort()).toEqual(['none', 'view'])
  })

  // Idempotency at the level the DB actually arbitrates on: a second apply adds
  // no NEW `ResourceAccess_entity_grantee_key`, so `onConflictDoNothing` writes
  // nothing.
  it('adds no new unique keys on a second apply', () => {
    const uniqueKey = (r: {
      organizationId: string
      entityDefinitionId: string
      entityInstanceId?: string | null
      granteeType: string
      granteeId: string
    }) =>
      [
        r.organizationId,
        r.entityDefinitionId,
        r.entityInstanceId ?? '',
        r.granteeType,
        r.granteeId,
      ].join('|')

    const keys = new Set<string>()
    const apply = () => {
      for (const inbox of devSharedInboxes) {
        const row = buildFloorRow({ organizationId: 'org1', ...inbox })
        if (row) keys.add(uniqueKey(row))
      }
    }

    apply()
    const afterFirst = keys.size
    expect(afterFirst).toBe(2)
    apply()
    expect(keys.size).toBe(afterFirst)
  })
})
