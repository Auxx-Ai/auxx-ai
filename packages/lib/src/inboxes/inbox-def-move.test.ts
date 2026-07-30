// packages/lib/src/inboxes/inbox-def-move.test.ts

import { schema } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import {
  buildDefFieldIdMap,
  type GrantRow,
  moveInboxInstance,
  planFieldValueMoves,
  planGrantRekey,
  rekeyInboxGrants,
} from './inbox-def-move'

/**
 * 40a §3 — the CLAIM round-trip, i.e. the `personal_inbox` → `inbox` direction
 * of the shared def-move mechanism.
 *
 * Migration 060 owns the other direction and has its own suite; what is only
 * exercised here is that the mechanism is genuinely direction-agnostic, because
 * that is the whole reason `claimPersonalInbox` shares it instead of carrying a
 * second copy. The property that matters: after the move, **no old-def
 * `CustomField` id is referenced anywhere** — a FieldValue left pointing at the
 * source def's field row reads back as ABSENT, so the claimed inbox would
 * silently lose its name and colour with nothing thrown.
 */

const PERSONAL_DEF = 'edf_personal'
const SHARED_DEF = 'edf_shared'
const INSTANCE = 'ibx_1'
const ORG = 'org_1'

/** `ExistingState.fields` as `loadExistingState` shapes it, for BOTH defs. */
const FIELDS = new Map([
  [
    `${PERSONAL_DEF}:inbox_name`,
    { id: 'cf_p_name', systemAttribute: 'inbox_name', entityDefinitionId: PERSONAL_DEF },
  ],
  [
    `${PERSONAL_DEF}:inbox_color`,
    { id: 'cf_p_color', systemAttribute: 'inbox_color', entityDefinitionId: PERSONAL_DEF },
  ],
  [
    `${PERSONAL_DEF}:inbox_owner_user_id`,
    { id: 'cf_p_owner', systemAttribute: 'inbox_owner_user_id', entityDefinitionId: PERSONAL_DEF },
  ],
  [
    `${SHARED_DEF}:inbox_name`,
    { id: 'cf_s_name', systemAttribute: 'inbox_name', entityDefinitionId: SHARED_DEF },
  ],
  [
    `${SHARED_DEF}:inbox_color`,
    { id: 'cf_s_color', systemAttribute: 'inbox_color', entityDefinitionId: SHARED_DEF },
  ],
  [
    `${SHARED_DEF}:inbox_owner_user_id`,
    { id: 'cf_s_owner', systemAttribute: 'inbox_owner_user_id', entityDefinitionId: SHARED_DEF },
  ],
  // Shared-only attributes — the reverse move's target set is a SUPERSET.
  [
    `${SHARED_DEF}:inbox_default_lens`,
    { id: 'cf_s_lens', systemAttribute: 'inbox_default_lens', entityDefinitionId: SHARED_DEF },
  ],
  [
    `${SHARED_DEF}:inbox_is_personal`,
    { id: 'cf_s_personal', systemAttribute: 'inbox_is_personal', entityDefinitionId: SHARED_DEF },
  ],
])

interface Recorded {
  updates: Array<{ table: unknown; set: Record<string, unknown> }>
  deletes: unknown[]
}

/**
 * Drizzle query-builder fake: `select()` chains resolve the next queued result
 * (in call order), `update()`/`delete()` are recorded. Enough for the two IO
 * helpers, which issue no transactions and read no relations.
 */
function makeDb(queued: unknown[][]) {
  const recorded: Recorded = { updates: [], deletes: [] }
  const queue = [...queued]
  const shift = () => queue.shift() ?? []

  const selectChain = (): Record<string, unknown> => {
    const node: Record<string, unknown> = {}
    node.from = () => node
    node.innerJoin = () => node
    node.where = () => {
      // A real promise with `.limit` attached — the two shapes drizzle's builder
      // offers here — so the fake stays awaitable without a hand-rolled thenable.
      const value = shift()
      const pending = Promise.resolve(value) as Promise<unknown> & {
        limit?: () => Promise<unknown>
      }
      pending.limit = () => Promise.resolve(value)
      return pending
    }
    return node
  }

  const db = {
    select: () => selectChain(),
    update: (table: unknown) => ({
      set: (set: Record<string, unknown>) => ({
        where: async () => {
          recorded.updates.push({ table, set })
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: async () => {
        recorded.deletes.push(table)
      },
    }),
  }
  return { db: db as never, recorded }
}

describe('buildDefFieldIdMap', () => {
  it('yields exactly ONE def’s materialized fields from the shared state map', () => {
    expect(Object.fromEntries(buildDefFieldIdMap(FIELDS, PERSONAL_DEF))).toEqual({
      inbox_name: 'cf_p_name',
      inbox_color: 'cf_p_color',
      inbox_owner_user_id: 'cf_p_owner',
    })
  })

  it('one `loadExistingState` call serves BOTH ends of a move', () => {
    // The point of the helper: never hand-query `CustomField` twice.
    expect(buildDefFieldIdMap(FIELDS, SHARED_DEF).get('inbox_name')).toBe('cf_s_name')
    expect(buildDefFieldIdMap(FIELDS, PERSONAL_DEF).get('inbox_name')).toBe('cf_p_name')
  })
})

describe('planFieldValueMoves — the CLAIM direction drops nothing', () => {
  const values = [
    { id: 'fv_name', fieldId: 'cf_p_name', systemAttribute: 'inbox_name' },
    { id: 'fv_color', fieldId: 'cf_p_color', systemAttribute: 'inbox_color' },
    { id: 'fv_owner', fieldId: 'cf_p_owner', systemAttribute: 'inbox_owner_user_id' },
  ]

  it('remaps every value onto the shared def and deletes none', () => {
    const plan = planFieldValueMoves({
      values,
      newFieldIdByAttr: buildDefFieldIdMap(FIELDS, SHARED_DEF),
    })
    expect(plan.deletes).toEqual([])
    expect(plan.unmapped).toEqual([])
    expect(plan.updates).toEqual([
      { id: 'fv_name', fieldId: 'cf_s_name' },
      { id: 'fv_color', fieldId: 'cf_s_color' },
      { id: 'fv_owner', fieldId: 'cf_s_owner' },
    ])
  })

  it('NO old-def CustomField id survives the plan', () => {
    const plan = planFieldValueMoves({
      values,
      newFieldIdByAttr: buildDefFieldIdMap(FIELDS, SHARED_DEF),
    })
    const personalIds = new Set([...buildDefFieldIdMap(FIELDS, PERSONAL_DEF).values()])
    for (const update of plan.updates) expect(personalIds.has(update.fieldId)).toBe(false)
  })

  it('is idempotent — a second pass over already-moved values is a no-op', () => {
    const moved = values.map((v) => ({
      ...v,
      fieldId: buildDefFieldIdMap(FIELDS, SHARED_DEF).get(v.systemAttribute) as string,
    }))
    const plan = planFieldValueMoves({
      values: moved,
      newFieldIdByAttr: buildDefFieldIdMap(FIELDS, SHARED_DEF),
    })
    expect(plan).toEqual({ updates: [], deletes: [], unmapped: [] })
  })
})

describe('moveInboxInstance — the claim’s IO', () => {
  it('flips the instance def and rewrites every FieldValue’s fieldId AND owner def', async () => {
    const { db, recorded } = makeDb([
      [{ entityDefinitionId: PERSONAL_DEF }], // the instance lookup
      [
        { id: 'fv_name', fieldId: 'cf_p_name', systemAttribute: 'inbox_name' },
        { id: 'fv_owner', fieldId: 'cf_p_owner', systemAttribute: 'inbox_owner_user_id' },
      ],
    ])

    const result = await moveInboxInstance(db, {
      instanceId: INSTANCE,
      fromDefId: PERSONAL_DEF,
      toDefId: SHARED_DEF,
      newFieldIdByAttr: buildDefFieldIdMap(FIELDS, SHARED_DEF),
    })

    expect(result).toMatchObject({ instanceMoved: true, valuesRemapped: 2, valuesDeleted: 0 })
    expect(recorded.updates[0]).toEqual({
      table: schema.EntityInstance,
      set: { entityDefinitionId: SHARED_DEF },
    })
    // BOTH columns move together — `fieldId` alone leaves the value owned by a
    // def that no longer holds the instance.
    expect(recorded.updates.slice(1).map((u) => u.set)).toEqual([
      { fieldId: 'cf_s_name', entityDefinitionId: SHARED_DEF },
      { fieldId: 'cf_s_owner', entityDefinitionId: SHARED_DEF },
    ])
    expect(recorded.deletes).toEqual([])
  })

  it('skips the instance update when it is already on the target def', async () => {
    const { db, recorded } = makeDb([[{ entityDefinitionId: SHARED_DEF }], []])
    const result = await moveInboxInstance(db, {
      instanceId: INSTANCE,
      fromDefId: PERSONAL_DEF,
      toDefId: SHARED_DEF,
      newFieldIdByAttr: buildDefFieldIdMap(FIELDS, SHARED_DEF),
    })
    expect(result.instanceMoved).toBe(false)
    // Only the catch-all owner-column repair, never an EntityInstance write.
    expect(recorded.updates.map((u) => u.table)).not.toContain(schema.EntityInstance)
  })

  it('deletes exactly the attributes the caller names as dropped', async () => {
    const { db, recorded } = makeDb([
      [{ entityDefinitionId: SHARED_DEF }],
      [
        { id: 'fv_name', fieldId: 'cf_s_name', systemAttribute: 'inbox_name' },
        { id: 'fv_lens', fieldId: 'cf_s_lens', systemAttribute: 'inbox_default_lens' },
      ],
    ])
    const result = await moveInboxInstance(db, {
      instanceId: INSTANCE,
      fromDefId: SHARED_DEF,
      toDefId: PERSONAL_DEF,
      newFieldIdByAttr: buildDefFieldIdMap(FIELDS, PERSONAL_DEF),
      droppedAttrs: ['inbox_default_lens'],
    })
    expect(result.valuesDeleted).toBe(1)
    expect(recorded.deletes).toEqual([schema.FieldValue])
  })
})

describe('rekeyInboxGrants — the claim re-keys personal_inbox → inbox', () => {
  const row = (over: Partial<GrantRow> & { entityDefinitionId: string }) => ({
    id: 'ra_1',
    granteeType: 'user',
    granteeId: 'u_owner',
    rung: 'admin',
    ...over,
  })

  it('recodes a source-keyspace row in place when nothing collides', async () => {
    const { db, recorded } = makeDb([[row({ entityDefinitionId: 'personal_inbox' })]])
    const result = await rekeyInboxGrants(db, {
      organizationId: ORG,
      instanceId: INSTANCE,
      fromKey: 'personal_inbox',
      toKey: 'inbox',
    })
    expect(result).toEqual({ recoded: 1, raised: 0, dropped: 0 })
    expect(recorded.updates).toEqual([
      { table: schema.ResourceAccess, set: { entityDefinitionId: 'inbox' } },
    ])
  })

  it('RAISES the surviving row before dropping the stronger legacy one', () => {
    // The collision rule is explicit, never the unique arbiter's: letting
    // ON CONFLICT pick downgraded a creator-Manager from `admin` to `view`.
    const plan = planGrantRekey({
      legacy: [row({ id: 'legacy', entityDefinitionId: 'personal_inbox', rung: 'admin' })],
      existing: [
        row({
          id: 'existing',
          entityDefinitionId: 'inbox',
          rung: 'identity',
        }),
      ],
    })
    expect(plan).toEqual({
      recode: [],
      raise: [{ id: 'existing', rung: 'admin' }],
      drop: ['legacy'],
    })
  })

  it('leaves a STRONGER counterpart alone and drops the weaker legacy row', () => {
    const plan = planGrantRekey({
      legacy: [
        row({
          id: 'legacy',
          entityDefinitionId: 'personal_inbox',
          rung: 'metadata',
        }),
      ],
      existing: [row({ id: 'existing', entityDefinitionId: 'inbox', rung: 'admin' })],
    })
    expect(plan).toEqual({ recode: [], raise: [], drop: ['legacy'] })
  })

  it('is a no-op once every row is already in the target keyspace', async () => {
    const { db, recorded } = makeDb([[row({ entityDefinitionId: 'inbox' })]])
    const result = await rekeyInboxGrants(db, {
      organizationId: ORG,
      instanceId: INSTANCE,
      fromKey: 'personal_inbox',
      toKey: 'inbox',
    })
    expect(result).toEqual({ recoded: 0, raised: 0, dropped: 0 })
    expect(recorded.updates).toEqual([])
    expect(recorded.deletes).toEqual([])
  })
})
