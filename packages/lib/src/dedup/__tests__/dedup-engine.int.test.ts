// packages/lib/src/dedup/__tests__/dedup-engine.int.test.ts
//
// DB-backed behavior tests (vitest.integration.config.ts → auxx_test database) for
// the EXACT dedup engine: derive keys → block → score → upsert → rescore.
//
// Why integration and not unit: the two claims this feature rests on are both
// PREDICATE claims, and a fake db is predicate-blind.
//   1. Canonical ordering collapses (A,B) and (B,A) onto ONE row. That is the
//      unique index `DuplicateSuggestion_org_def_pair_key` doing the work — a
//      chainable mock would "pass" whether or not the index exists.
//   2. Multi-value fan-out really matches on a non-primary alias. The lookup core
//      does `DISTINCT ON (entityId)` over every value row; only real SQL over rows
//      shaped like the seeder's shows that the alias arm fires.
//
// The org cache barrel is mocked wholesale (deterministic, no Redis): field
// lookups read straight from the test DB.

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import type { FieldId } from '@auxx/types/field'
import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResourceField } from '../../resources/registry/field-types'
import { blockIdentity, blockOrgKey, blockRecord } from '../blocking'
import { deriveMatchKeys, type MatchKey } from '../match-keys'
import { rescoreOpenPairsForRecord, resolveSuggestionsForMerge, upsertPairs } from '../pairs'
import { scoreBlockGroup, scoreIdentityGroup, scoreRecordMatches } from '../scoring'

const db = () => getTestDb() as unknown as Database

// ── Org-cache mock (wholesale — DB-backed, no Redis, no providers) ───────────

vi.mock('../../cache', () => {
  const tdb = () => getTestDb() as never as Database

  const fieldsForOrg = async (orgId: string) =>
    await tdb()
      .select()
      .from(schema.CustomField)
      .where(eq(schema.CustomField.organizationId, orgId))

  return {
    getCachedFieldMap: async (orgId: string) => {
      const fields = await fieldsForOrg(orgId)
      return new Map(fields.map((f) => [f.id, f]))
    },
    getCachedCustomFields: async (orgId: string) => fieldsForOrg(orgId),
    getAllCachedCustomFields: async (orgId: string) => fieldsForOrg(orgId),
    getCachedResource: async () => null,
    findCachedResource: async () => null,
    getCachedResources: async () => [],
    getCachedResourceFields: async () => [],
    getCachedEntityDefId: async (_orgId: string, slugOrId: string) => slugOrId,
  }
})

// ── Fixtures ────────────────────────────────────────────────────────────────

interface Fixture {
  orgId: string
  defId: string
  emailFieldId: string
  phoneFieldId: string
  accountFieldId: string
  fields: ResourceField[]
}

/** Minimal `ResourceField` in the shape the registry hands `deriveMatchKeys`. */
function resourceField(
  id: string,
  key: string,
  fieldType: NonNullable<ResourceField['fieldType']>,
  extra: Partial<ResourceField> = {}
): ResourceField {
  return {
    id: id as FieldId,
    key,
    label: key,
    type: 'string' as ResourceField['type'],
    fieldType,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: true,
    },
    ...extra,
  }
}

/** Mirror of what `EntitySeeder` produces for the contact def + its identity fields. */
async function seedContactOrg(): Promise<Fixture> {
  const org = await createTestOrganization()
  const orgId = org.id

  const [def] = await db()
    .insert(schema.EntityDefinition)
    .values({
      organizationId: orgId,
      entityType: 'contact',
      apiSlug: 'contacts',
      singular: 'contact',
      plural: 'contacts',
      updatedAt: new Date(),
    })
    .returning()

  const makeField = async (
    name: string,
    type: 'EMAIL' | 'PHONE_INTL' | 'TEXT',
    opts: { systemAttribute?: string; isUnique?: boolean; multi?: boolean; sortOrder: string }
  ) => {
    const [row] = await db()
      .insert(schema.CustomField)
      .values({
        organizationId: orgId,
        entityDefinitionId: def?.id as string,
        // Load-bearing: the seeder writes the ENTITY TYPE here, not 'entity'.
        modelType: 'contact',
        name,
        type,
        systemAttribute: opts.systemAttribute,
        sortOrder: opts.sortOrder,
        options: opts.multi ? { multi: true } : {},
        isCustom: !opts.systemAttribute,
        isUnique: opts.isUnique ?? false,
        updatedAt: new Date(),
      })
      .returning()
    return row?.id as string
  }

  const emailFieldId = await makeField('Email', 'EMAIL', {
    systemAttribute: 'primary_email',
    isUnique: true,
    multi: true,
    sortOrder: 'a2',
  })
  const phoneFieldId = await makeField('Phone', 'PHONE_INTL', {
    systemAttribute: 'phone',
    multi: true,
    sortOrder: 'a3',
  })
  const accountFieldId = await makeField('Account Number', 'TEXT', {
    isUnique: true,
    sortOrder: 'a4',
  })

  return {
    orgId,
    defId: def?.id as string,
    emailFieldId,
    phoneFieldId,
    accountFieldId,
    fields: [
      resourceField(emailFieldId, 'primaryEmail', 'EMAIL', {
        systemAttribute: 'primary_email',
        isUnique: true,
        options: { multi: true },
      }),
      resourceField(phoneFieldId, 'phone', 'PHONE_INTL', {
        systemAttribute: 'phone',
        options: { multi: true },
      }),
      resourceField(accountFieldId, 'accountNumber', 'TEXT', { isUnique: true }),
    ],
  }
}

/** Strictly ascending fractional-ish sortKeys under the C collation (0…9 < A…Z). */
const SORT_KEYS = ['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'aA', 'aB']

async function seedContact(
  f: Fixture,
  displayName: string,
  values: { emails?: string[]; phones?: string[]; accountNumber?: string } = {}
): Promise<string> {
  const [inst] = await db()
    .insert(schema.EntityInstance)
    .values({
      organizationId: f.orgId,
      entityDefinitionId: f.defId,
      displayName,
      updatedAt: new Date(),
    })
    .returning()

  const write = async (fieldId: string, list: string[]) => {
    for (const [i, value] of list.entries()) {
      await db()
        .insert(schema.FieldValue)
        .values({
          organizationId: f.orgId,
          entityId: inst?.id as string,
          entityDefinitionId: f.defId,
          fieldId,
          valueText: value,
          sortKey: SORT_KEYS[i] as string,
        })
    }
  }

  await write(f.emailFieldId, values.emails ?? [])
  await write(f.phoneFieldId, values.phones ?? [])
  await write(f.accountFieldId, values.accountNumber ? [values.accountNumber] : [])
  return inst?.id as string
}

const keysOf = (f: Fixture): MatchKey[] => deriveMatchKeys(f.fields)

const keyFor = (f: Fixture, fieldKey: string): MatchKey =>
  keysOf(f).find((k) => k.fieldKey === fieldKey) as MatchKey

async function block(f: Fixture, instanceId: string, blockCap?: number) {
  const result = await blockRecord(db(), {
    organizationId: f.orgId,
    entityDefinitionId: f.defId,
    instanceId,
    keys: keysOf(f),
    blockCap,
  })
  return result._unsafeUnwrap()
}

/** Full per-record scan path: block → score → upsert. */
async function scanRecord(f: Fixture, instanceId: string, blockCap?: number) {
  const matches = await block(f, instanceId, blockCap)
  const scored = scoreRecordMatches({
    organizationId: f.orgId,
    entityDefinitionId: f.defId,
    instanceId,
    matches,
  })
  const written = await upsertPairs(db(), scored)
  expect(written.isOk()).toBe(true)
  const closed = await rescoreOpenPairsForRecord(db(), {
    organizationId: f.orgId,
    entityDefinitionId: f.defId,
    instanceId,
    pairs: scored,
  })
  expect(closed.isOk()).toBe(true)
  return scored
}

async function storedPairs(f: Fixture) {
  return await db()
    .select()
    .from(schema.DuplicateSuggestion)
    .where(eq(schema.DuplicateSuggestion.organizationId, f.orgId))
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('exact engine — the strong keys', () => {
  let f: Fixture
  beforeEach(async () => {
    f = await seedContactOrg()
  })

  it('pairs two contacts on a shared email, at the high band, exactly once', async () => {
    const anna = await seedContact(f, 'Anna', { emails: ['anna@example.com'] })
    await seedContact(f, 'Anna Dup', { emails: ['anna@example.com'] })

    await scanRecord(f, anna)

    const rows = await storedPairs(f)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.band).toBe('high')
    expect(rows[0]?.status).toBe('open')
    // The Signal names the matched ADDRESS, not just the field — "matched on:
    // email" cannot say which address on a multi-value field.
    expect(rows[0]?.signals).toMatchObject([
      { type: 'email', value: 'anna@example.com', fieldKey: 'primaryEmail' },
    ])
  })

  it('collapses (A,B) and (B,A) onto ONE row — the canonical-pair invariant', async () => {
    const anna = await seedContact(f, 'Anna', { emails: ['anna@example.com'] })
    const dup = await seedContact(f, 'Anna Dup', { emails: ['anna@example.com'] })

    // Scanning from BOTH sides is the realistic case: each record is dirty and
    // each scan finds the other. Without canonical ordering this writes two rows
    // and the queue shows every duplicate twice.
    await scanRecord(f, anna)
    await scanRecord(f, dup)

    const rows = await storedPairs(f)
    expect(rows).toHaveLength(1)
    const row = rows[0] as (typeof rows)[number]
    expect(row.instanceIdLow < row.instanceIdHigh).toBe(true)
  })

  it('pairs two contacts sharing a PHONE — deliberately non-unique, so the common real case', async () => {
    const a = await seedContact(f, 'Household A', { phones: ['+14155550100'] })
    await seedContact(f, 'Household B', { phones: ['+14155550100'] })

    const matches = await block(f, a)
    expect(matches).toHaveLength(1)
    expect(matches[0]?.signals[0]).toMatchObject({
      type: 'phone',
      value: '+14155550100',
      fieldKey: 'phone',
    })
  })

  it('pairs on a custom isUnique key — the generic, entity-agnostic path', async () => {
    const a = await seedContact(f, 'Acme', { accountNumber: 'ACC-9001' })
    await seedContact(f, 'Acme again', { accountNumber: 'ACC-9001' })

    const matches = await block(f, a)
    expect(matches).toHaveLength(1)
    expect(matches[0]?.signals[0]).toMatchObject({
      type: 'unique',
      value: 'ACC-9001',
      fieldKey: 'accountNumber',
    })
  })
})

describe('exact engine — multi-value fan-out (one candidate per VALUE)', () => {
  let f: Fixture
  beforeEach(async () => {
    f = await seedContactOrg()
  })

  // A pair matching on a non-primary alias is a duplicate exactly like a primary
  // match. Blocking only the primary value silently misses this whole class.
  it('pairs when the SECOND email of one contact is the FIRST of another, and names the alias', async () => {
    const anna = await seedContact(f, 'Anna', {
      emails: ['anna@home.example', 'anna@work.example'],
    })
    await seedContact(f, 'Anna at work', { emails: ['anna@work.example'] })

    const matches = await block(f, anna)
    expect(matches).toHaveLength(1)
    expect(matches[0]?.signals).toHaveLength(1)
    expect(matches[0]?.signals[0]).toMatchObject({ type: 'email', value: 'anna@work.example' })
  })

  it('carries BOTH signals when two contacts share an email AND a phone', async () => {
    const a = await seedContact(f, 'A', {
      emails: ['dup@example.com'],
      phones: ['+14155550111'],
    })
    await seedContact(f, 'B', { emails: ['dup@example.com'], phones: ['+14155550111'] })

    const matches = await block(f, a)
    expect(matches).toHaveLength(1)
    expect(matches[0]?.signals.map((s) => s.type).sort()).toEqual(['email', 'phone'])
  })

  it('reads at most MAX_MULTI_VALUES values — a 10-value record yields 10 candidates, no more', async () => {
    const emails = Array.from({ length: 11 }, (_, i) => `alias${i}@example.com`)
    const anna = await seedContact(f, 'Anna', { emails })
    for (const email of emails) await seedContact(f, `Match ${email}`, { emails: [email] })

    const matches = await block(f, anna)
    expect(matches).toHaveLength(10)
  })
})

describe('exact engine — the guards', () => {
  let f: Fixture
  beforeEach(async () => {
    f = await seedContactOrg()
  })

  it('suppresses a role address as the ONLY evidence', async () => {
    // Two contacts on info@acme.com are two humans behind one mailbox.
    const a = await seedContact(f, 'Acme reception', { emails: ['info@acme.com'] })
    await seedContact(f, 'Acme other', { emails: ['info@acme.com'] })

    expect(await block(f, a)).toEqual([])
  })

  it('lets a second signal rescue a role-address match', async () => {
    const a = await seedContact(f, 'Acme reception', {
      emails: ['info@acme.com'],
      phones: ['+14155550122'],
    })
    await seedContact(f, 'Acme other', {
      emails: ['info@acme.com'],
      phones: ['+14155550122'],
    })

    const matches = await block(f, a)
    expect(matches).toHaveLength(1)
    expect(matches[0]?.signals.map((s) => s.type).sort()).toEqual(['email', 'phone'])
  })

  it('discards a value held by more records than the block cap', async () => {
    const a = await seedContact(f, 'A', { phones: ['+14155550133'] })
    await seedContact(f, 'B', { phones: ['+14155550133'] })
    await seedContact(f, 'C', { phones: ['+14155550133'] })

    // A shared reception line on hundreds of records would be O(n²) rows of noise.
    expect(await block(f, a, 1)).toEqual([])
    expect(await block(f, a, 5)).toHaveLength(2)
  })

  it('skips empty values rather than pairing every blank cell in the org', async () => {
    const a = await seedContact(f, 'A', { emails: [''], accountNumber: '   ' })
    await seedContact(f, 'B', { emails: [''], accountNumber: '   ' })

    expect(await block(f, a)).toEqual([])
  })

  it('never blocks against an archived record', async () => {
    const a = await seedContact(f, 'A', { emails: ['ghost@example.com'] })
    const ghost = await seedContact(f, 'Ghost', { emails: ['ghost@example.com'] })
    await db()
      .update(schema.EntityInstance)
      .set({ archivedAt: new Date() })
      .where(eq(schema.EntityInstance.id, ghost))

    expect(await block(f, a)).toEqual([])
  })

  it('matches a Gmail alias against its canonical form without rewriting it', async () => {
    const a = await seedContact(f, 'John dotted', { emails: ['j.ohn+shop@googlemail.com'] })
    await seedContact(f, 'John plain', { emails: ['john@gmail.com'] })

    const matches = await block(f, a)
    expect(matches).toHaveLength(1)
    expect(matches[0]?.signals[0]).toMatchObject({
      value: 'j.ohn+shop@googlemail.com',
      otherValue: 'john@gmail.com',
    })

    // Compare-time only: the stored address is untouched.
    const [row] = await db()
      .select()
      .from(schema.FieldValue)
      .where(and(eq(schema.FieldValue.entityId, a), eq(schema.FieldValue.fieldId, f.emailFieldId)))
    expect(row?.valueText).toBe('j.ohn+shop@googlemail.com')
  })
})

describe('exact engine — org-wide sweeps', () => {
  let f: Fixture
  beforeEach(async () => {
    f = await seedContactOrg()
  })

  it('groups an org-wide key by value and expands it into pairs', async () => {
    await seedContact(f, 'A', { emails: ['shared@example.com'] })
    await seedContact(f, 'B', { emails: ['shared@example.com'] })
    await seedContact(f, 'C', { emails: ['unique@example.com'] })

    const groups = (
      await blockOrgKey(db(), {
        organizationId: f.orgId,
        entityDefinitionId: f.defId,
        key: keyFor(f, 'primaryEmail'),
      })
    )._unsafeUnwrap()

    expect(groups).toHaveLength(1)
    expect(groups[0]?.value).toBe('shared@example.com')
    const scored = scoreBlockGroup({
      organizationId: f.orgId,
      entityDefinitionId: f.defId,
      group: groups[0] as never,
    })
    expect(scored).toHaveLength(1)
    expect(scored[0]?.band).toBe('high')
  })

  it('drops a role-address group outright — it can never earn a second signal', async () => {
    await seedContact(f, 'A', { emails: ['support@acme.com'] })
    await seedContact(f, 'B', { emails: ['support@acme.com'] })

    const groups = (
      await blockOrgKey(db(), {
        organizationId: f.orgId,
        entityDefinitionId: f.defId,
        key: keyFor(f, 'primaryEmail'),
      })
    )._unsafeUnwrap()
    expect(groups).toEqual([])
  })

  it('honours the cap in HAVING so an over-common value never leaves the database', async () => {
    for (const name of ['A', 'B', 'C']) {
      await seedContact(f, name, { phones: ['+14155550144'] })
    }
    const groups = (
      await blockOrgKey(db(), {
        organizationId: f.orgId,
        entityDefinitionId: f.defId,
        key: keyFor(f, 'phone'),
        blockCap: 2,
      })
    )._unsafeUnwrap()
    expect(groups).toEqual([])
  })

  it('finds the same external id under two records — the cross-connection duplicate', async () => {
    const a = await seedContact(f, 'A')
    const b = await seedContact(f, 'B')

    // TWO connections — that is the whole point. `RecordIdentity_identity_key`
    // COALESCEs `connectionId`, so the same customer synced under two connected
    // stores is legitimately two identity rows and therefore two records. With
    // one connection the second insert would (correctly) violate the index.
    const connectionIds: string[] = []
    for (const label of ['store-one', 'store-two']) {
      const [cred] = await db()
        .insert(schema.Credential)
        .values({
          organizationId: f.orgId,
          name: label,
          encryptedSecrets: 'x',
          updatedAt: new Date(),
        })
        .returning()
      connectionIds.push(cred?.id as string)
    }

    for (const [instanceId, connectionId] of [
      [a, connectionIds[0]],
      [b, connectionIds[1]],
    ] as const) {
      await db().insert(schema.RecordIdentity).values({
        organizationId: f.orgId,
        entityInstanceId: instanceId,
        entityDefinitionId: f.defId,
        source: 'shopify',
        appFieldKey: 'customerId',
        externalId: '99',
        connectionId,
      })
    }

    const groups = (
      await blockIdentity(db(), { organizationId: f.orgId, entityDefinitionId: f.defId })
    )._unsafeUnwrap()
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      source: 'shopify',
      appFieldKey: 'customerId',
      externalId: '99',
    })

    const scored = scoreIdentityGroup({
      organizationId: f.orgId,
      entityDefinitionId: f.defId,
      group: groups[0] as never,
    })
    expect(scored[0]?.signals[0]).toMatchObject({ type: 'identity', value: 'shopify:99' })
  })
})

describe('exact engine — the pair lifecycle', () => {
  let f: Fixture
  beforeEach(async () => {
    f = await seedContactOrg()
  })

  it('closes the pair when the duplicate email is corrected', async () => {
    const anna = await seedContact(f, 'Anna', { emails: ['anna@example.com'] })
    const typo = await seedContact(f, 'Anna typo', { emails: ['anna@example.com'] })
    await scanRecord(f, anna)
    expect(await storedPairs(f)).toHaveLength(1)

    // The correction. Rescore-on-change is mandatory: upsert-only would leave the
    // suggestion standing forever.
    await db()
      .update(schema.FieldValue)
      .set({ valueText: 'anna.other@example.com' })
      .where(
        and(eq(schema.FieldValue.entityId, typo), eq(schema.FieldValue.fieldId, f.emailFieldId))
      )

    await scanRecord(f, typo)
    expect(await storedPairs(f)).toEqual([])
  })

  it('reopens a dismissed MEDIUM pair when it later earns HIGH', async () => {
    const a = await seedContact(f, 'A')
    const b = await seedContact(f, 'B')
    const [low, high] = [a, b].sort() as [string, string]

    await db()
      .insert(schema.DuplicateSuggestion)
      .values({
        organizationId: f.orgId,
        entityDefinitionId: f.defId,
        instanceIdLow: low,
        instanceIdHigh: high,
        score: 0.5,
        band: 'medium',
        signals: [],
        status: 'dismissed',
        dismissedBand: 'medium',
        dismissedAt: new Date(),
        snoozeUntil: new Date(Date.now() + 86_400_000),
      })

    const result = await upsertPairs(db(), [
      {
        organizationId: f.orgId,
        entityDefinitionId: f.defId,
        instanceIdLow: low,
        instanceIdHigh: high,
        score: 0.9,
        band: 'high',
        signals: [{ type: 'email', strength: 'strong', value: 'a@x.com' }],
      },
    ])
    expect(result.isOk()).toBe(true)

    const rows = await storedPairs(f)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe('open')
    expect(rows[0]?.band).toBe('high')
    // The snooze does not survive an upgrade either.
    expect(rows[0]?.snoozeUntil).toBeNull()
  })

  it('leaves a dismissed pair dismissed when the rescan produces the SAME band', async () => {
    const a = await seedContact(f, 'A')
    const b = await seedContact(f, 'B')
    const [low, high] = [a, b].sort() as [string, string]

    await db().insert(schema.DuplicateSuggestion).values({
      organizationId: f.orgId,
      entityDefinitionId: f.defId,
      instanceIdLow: low,
      instanceIdHigh: high,
      score: 0.9,
      band: 'high',
      signals: [],
      status: 'dismissed',
      dismissedBand: 'high',
      dismissedAt: new Date(),
    })

    await upsertPairs(db(), [
      {
        organizationId: f.orgId,
        entityDefinitionId: f.defId,
        instanceIdLow: low,
        instanceIdHigh: high,
        score: 0.9,
        band: 'high',
        signals: [{ type: 'email', strength: 'strong', value: 'a@x.com' }],
      },
    ])

    const rows = await storedPairs(f)
    expect(rows[0]?.status).toBe('dismissed')
  })

  it('never touches a merged row', async () => {
    const a = await seedContact(f, 'A')
    const b = await seedContact(f, 'B')
    const [low, high] = [a, b].sort() as [string, string]

    await db()
      .insert(schema.DuplicateSuggestion)
      .values({
        organizationId: f.orgId,
        entityDefinitionId: f.defId,
        instanceIdLow: low,
        instanceIdHigh: high,
        score: 0.9,
        band: 'high',
        signals: [{ type: 'email', strength: 'strong', value: 'old@x.com' }],
        status: 'merged',
      })

    const written = await upsertPairs(db(), [
      {
        organizationId: f.orgId,
        entityDefinitionId: f.defId,
        instanceIdLow: low,
        instanceIdHigh: high,
        score: 0.95,
        band: 'high',
        signals: [{ type: 'phone', strength: 'strong', value: '+1' }],
      },
    ])

    expect(written._unsafeUnwrap()).toBe(0)
    const rows = await storedPairs(f)
    expect(rows[0]?.status).toBe('merged')
    expect(rows[0]?.signals).toMatchObject([{ value: 'old@x.com' }])
  })

  it('resolves a merge inside the transaction: the acted-on pair merged, siblings closed', async () => {
    const target = await seedContact(f, 'Target')
    const source = await seedContact(f, 'Source')
    const bystander = await seedContact(f, 'Bystander')

    const insertPair = async (x: string, y: string) => {
      const [low, high] = [x, y].sort() as [string, string]
      await db().insert(schema.DuplicateSuggestion).values({
        organizationId: f.orgId,
        entityDefinitionId: f.defId,
        instanceIdLow: low,
        instanceIdHigh: high,
        score: 0.9,
        band: 'high',
        signals: [],
        status: 'open',
      })
    }
    await insertPair(target, source)
    await insertPair(source, bystander)

    await db().transaction(async (tx) => {
      const result = await resolveSuggestionsForMerge(tx as never, f.orgId, target, [source])
      expect(result._unsafeUnwrap()).toEqual({ merged: 1, closed: 1 })
    })

    const rows = await storedPairs(f)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe('merged')
  })
})
