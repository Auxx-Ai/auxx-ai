// packages/lib/src/dedup/__tests__/dedup-fuzzy.int.test.ts
//
// DB-backed behavior tests (vitest.integration.config.ts → auxx_test database)
// for the PHASE 2 path: fuzzy blocking → structured name comparison → surname
// rarity → corroboration → the medium band.
//
// Why integration and not unit: every claim this phase rests on is a PREDICATE
// claim, and a fake db is predicate-blind.
//   1. The fuzzy blocker only works if `pg_trgm`'s `%` arm actually returns
//      `William Klooth` for the query `Bill Klooth` at the shared 0.3 threshold.
//      A chainable mock would "pass" whether or not the arm fires.
//   2. `surnameIdf` is an aggregate with a `FILTER` and a normalization
//      expression; whether `klooth` is rare and `smith` is not is a fact about
//      rows, not about JS.
//   3. The persisted `signals` jsonb is where a leaked similarity value would
//      actually show up.
//
// The org cache barrel is mocked wholesale (deterministic, no Redis).

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import type { FieldId } from '@auxx/types/field'
import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { blockFuzzyRecord } from '../blocking-fuzzy'
import { corroboratePair, deriveCorroborationFields, evaluateFuzzyPair } from '../corroborate'
import { upsertPairs } from '../pairs'
import { scorePair } from '../scoring'
import { readStructuredNames, resolveNameFieldIds, surnameIdf } from '../surname-rarity'
import type { Signal } from '../types'

const db = () => getTestDb() as unknown as Database

// ── Org-cache mock (wholesale — DB-backed, no Redis, no providers) ───────────

vi.mock('../../cache', () => ({
  getCachedFieldMap: async () => new Map(),
  getCachedCustomFields: async () => [],
  getAllCachedCustomFields: async () => [],
  getCachedResource: async () => null,
  findCachedResource: async () => null,
  getCachedResources: async () => [],
  getCachedResourceFields: async () => [],
  getCachedEntityDefId: async (_orgId: string, slugOrId: string) => slugOrId,
}))

// ── Fixtures ────────────────────────────────────────────────────────────────

interface Fixture {
  orgId: string
  defId: string
  companyDefId: string
  firstNameFieldId: string
  lastNameFieldId: string
  emailFieldId: string
  employerFieldId: string
  addressFieldId: string
  domainFieldId: string
}

async function makeDefinition(orgId: string, entityType: string, slug: string) {
  const [def] = await db()
    .insert(schema.EntityDefinition)
    .values({
      organizationId: orgId,
      entityType,
      apiSlug: slug,
      singular: entityType,
      plural: slug,
      updatedAt: new Date(),
    })
    .returning()
  return def?.id as string
}

async function makeField(
  orgId: string,
  defId: string,
  modelType: string,
  name: string,
  type: 'TEXT' | 'EMAIL' | 'ADDRESS' | 'RELATIONSHIP',
  opts: { systemAttribute?: string; multi?: boolean; sortOrder: string }
) {
  const [row] = await db()
    .insert(schema.CustomField)
    .values({
      organizationId: orgId,
      entityDefinitionId: defId,
      modelType,
      name,
      type,
      systemAttribute: opts.systemAttribute,
      sortOrder: opts.sortOrder,
      options: opts.multi ? { multi: true } : {},
      isCustom: !opts.systemAttribute,
      updatedAt: new Date(),
    })
    .returning()
  return row?.id as string
}

/** Mirror of what `EntitySeeder` produces for contact + company name/identity fields. */
async function seedOrg(): Promise<Fixture> {
  const org = await createTestOrganization()
  const orgId = org.id
  const defId = await makeDefinition(orgId, 'contact', 'contacts')
  const companyDefId = await makeDefinition(orgId, 'company', 'companies')

  return {
    orgId,
    defId,
    companyDefId,
    firstNameFieldId: await makeField(orgId, defId, 'contact', 'First Name', 'TEXT', {
      systemAttribute: 'first_name',
      sortOrder: 'a1',
    }),
    lastNameFieldId: await makeField(orgId, defId, 'contact', 'Last Name', 'TEXT', {
      systemAttribute: 'last_name',
      sortOrder: 'a2',
    }),
    emailFieldId: await makeField(orgId, defId, 'contact', 'Email', 'EMAIL', {
      systemAttribute: 'primary_email',
      multi: true,
      sortOrder: 'a3',
    }),
    employerFieldId: await makeField(orgId, defId, 'contact', 'Employer', 'RELATIONSHIP', {
      systemAttribute: 'contact_employer',
      sortOrder: 'a4',
    }),
    addressFieldId: await makeField(orgId, defId, 'contact', 'Address', 'ADDRESS', {
      sortOrder: 'a5',
    }),
    domainFieldId: await makeField(orgId, companyDefId, 'company', 'Domain', 'TEXT', {
      systemAttribute: 'company_domain',
      sortOrder: 'a1',
    }),
  }
}

interface ContactSeed {
  firstName: string
  lastName: string
  emails?: string[]
  employerId?: string
  address?: string
  firstInteractionAt?: Date
  identitySource?: string
}

async function seedContact(f: Fixture, seed: ContactSeed): Promise<string> {
  const displayName = `${seed.firstName} ${seed.lastName}`.trim()
  const [inst] = await db()
    .insert(schema.EntityInstance)
    .values({
      organizationId: f.orgId,
      entityDefinitionId: f.defId,
      displayName,
      searchText: displayName,
      firstInteractionAt: seed.firstInteractionAt,
      updatedAt: new Date(),
    })
    .returning()
  const id = inst?.id as string

  const write = async (
    fieldId: string,
    values: Array<Partial<typeof schema.FieldValue.$inferInsert>>
  ) => {
    for (const [i, value] of values.entries()) {
      await db()
        .insert(schema.FieldValue)
        .values({
          organizationId: f.orgId,
          entityId: id,
          entityDefinitionId: f.defId,
          fieldId,
          sortKey: `a${i}`,
          ...value,
        } as typeof schema.FieldValue.$inferInsert)
    }
  }

  await write(f.firstNameFieldId, [{ valueText: seed.firstName }])
  await write(f.lastNameFieldId, [{ valueText: seed.lastName }])
  await write(
    f.emailFieldId,
    (seed.emails ?? []).map((valueText) => ({ valueText }))
  )
  if (seed.employerId) await write(f.employerFieldId, [{ relatedEntityId: seed.employerId }])
  if (seed.address) await write(f.addressFieldId, [{ valueText: seed.address }])

  if (seed.identitySource) {
    await db().insert(schema.RecordIdentity).values({
      organizationId: f.orgId,
      entityInstanceId: id,
      entityDefinitionId: f.defId,
      source: seed.identitySource,
      appFieldKey: 'customerId',
      externalId: id,
    })
  }
  return id
}

async function seedCompany(f: Fixture, name: string, domain: string): Promise<string> {
  const [inst] = await db()
    .insert(schema.EntityInstance)
    .values({
      organizationId: f.orgId,
      entityDefinitionId: f.companyDefId,
      displayName: name,
      searchText: name,
      updatedAt: new Date(),
    })
    .returning()
  const id = inst?.id as string
  await db().insert(schema.FieldValue).values({
    organizationId: f.orgId,
    entityId: id,
    entityDefinitionId: f.companyDefId,
    fieldId: f.domainFieldId,
    sortKey: 'a0',
    valueText: domain,
  })
  return id
}

const corroborationFields = (f: Fixture) =>
  deriveCorroborationFields([
    {
      id: f.employerFieldId as FieldId,
      key: 'employer',
      label: '',
      type: 'string',
      fieldType: 'RELATIONSHIP',
      capabilities: {},
    },
    {
      id: f.addressFieldId as FieldId,
      key: 'address',
      label: '',
      type: 'string',
      fieldType: 'ADDRESS',
      capabilities: {},
    },
    {
      id: f.emailFieldId as FieldId,
      key: 'primaryEmail',
      label: '',
      type: 'string',
      fieldType: 'EMAIL',
      capabilities: {},
    },
  ] as never)

/**
 * The full Phase-2 per-record path, exactly as the scan job will compose it:
 * fuzzy block → read names → evaluate → score → upsert.
 */
async function scanFuzzy(f: Fixture, instanceId: string) {
  const nameFields = (await resolveNameFieldIds(db(), f.orgId, f.defId))._unsafeUnwrap()
  const candidates = (
    await blockFuzzyRecord(db(), {
      organizationId: f.orgId,
      entityDefinitionId: f.defId,
      instanceId,
    })
  )._unsafeUnwrap()

  const names = (
    await readStructuredNames(
      db(),
      f.orgId,
      [instanceId, ...candidates.map((c) => c.instanceId)],
      nameFields
    )
  )._unsafeUnwrap()

  const scored = []
  for (const candidate of candidates) {
    const [low, high] = [instanceId, candidate.instanceId].sort() as [string, string]
    const signals = (
      await evaluateFuzzyPair(db(), {
        organizationId: f.orgId,
        entityDefinitionId: f.defId,
        instanceIdLow: low,
        instanceIdHigh: high,
        nameLow: names.get(low) ?? {},
        nameHigh: names.get(high) ?? {},
        fields: corroborationFields(f),
        surnameFieldId: nameFields.surnameFieldId,
        ownDomains: new Set<string>(),
      })
    )._unsafeUnwrap()
    if (signals.length === 0) continue

    const pair = scorePair({
      organizationId: f.orgId,
      entityDefinitionId: f.defId,
      instanceIdLow: low,
      instanceIdHigh: high,
      signals,
    })
    if (pair) scored.push(pair)
  }

  const written = await upsertPairs(db(), scored)
  expect(written.isOk()).toBe(true)
  return scored
}

const storedPairs = async (f: Fixture) =>
  await db()
    .select()
    .from(schema.DuplicateSuggestion)
    .where(eq(schema.DuplicateSuggestion.organizationId, f.orgId))

// ── Tests ───────────────────────────────────────────────────────────────────

describe('fuzzy blocking — candidate generation only', () => {
  it('finds a nickname neighbour through the shared trigram predicate', async () => {
    const f = await seedOrg()
    const bill = await seedContact(f, { firstName: 'Bill', lastName: 'Klooth' })
    const william = await seedContact(f, { firstName: 'William', lastName: 'Klooth' })

    const candidates = (
      await blockFuzzyRecord(db(), {
        organizationId: f.orgId,
        entityDefinitionId: f.defId,
        instanceId: bill,
      })
    )._unsafeUnwrap()

    expect(candidates.map((c) => c.instanceId)).toEqual([william])
  })

  it('returns NO similarity value — the number cannot leak by construction', async () => {
    const f = await seedOrg()
    const bill = await seedContact(f, { firstName: 'Bill', lastName: 'Klooth' })
    await seedContact(f, { firstName: 'William', lastName: 'Klooth' })

    const candidates = (
      await blockFuzzyRecord(db(), {
        organizationId: f.orgId,
        entityDefinitionId: f.defId,
        instanceId: bill,
      })
    )._unsafeUnwrap()

    // Full-name trigram ranks `john smith`/`jane smith` (0.4666667) above
    // `william klooth`/`bill klooth` (0.4210526). If it ever reached the score,
    // the queue would lead with siblings and spouses.
    expect(Object.keys(candidates[0] ?? {}).sort()).toEqual([
      'displayName',
      'instanceId',
      'secondaryDisplayValue',
    ])
  })

  it('never returns itself, another definition, or an archived record', async () => {
    const f = await seedOrg()
    const bill = await seedContact(f, { firstName: 'Bill', lastName: 'Klooth' })
    const ghost = await seedContact(f, { firstName: 'William', lastName: 'Klooth' })
    await seedCompany(f, 'Bill Klooth Holdings', 'klooth.example')
    await db()
      .update(schema.EntityInstance)
      .set({ archivedAt: new Date() })
      .where(eq(schema.EntityInstance.id, ghost))

    const candidates = (
      await blockFuzzyRecord(db(), {
        organizationId: f.orgId,
        entityDefinitionId: f.defId,
        instanceId: bill,
      })
    )._unsafeUnwrap()
    expect(candidates).toEqual([])
  })

  it('accepts a surname anchor, which recovers a pair the full name misses', async () => {
    // Measured: similarity('peggy lee','margaret lee') = 0.2105263, BELOW the
    // shared 0.3 threshold — a short surname cannot carry a nickname pair. The
    // surname-only query puts the score on the part that actually agrees.
    const f = await seedOrg()
    const peggy = await seedContact(f, { firstName: 'Peggy', lastName: 'Lee' })
    const margaret = await seedContact(f, { firstName: 'Margaret', lastName: 'Lee' })

    const withoutAnchor = (
      await blockFuzzyRecord(db(), {
        organizationId: f.orgId,
        entityDefinitionId: f.defId,
        instanceId: peggy,
      })
    )._unsafeUnwrap()
    expect(withoutAnchor).toEqual([])

    const withAnchor = (
      await blockFuzzyRecord(db(), {
        organizationId: f.orgId,
        entityDefinitionId: f.defId,
        instanceId: peggy,
        anchors: { displayName: 'Peggy Lee', surname: 'Lee' },
      })
    )._unsafeUnwrap()
    expect(withAnchor.map((c) => c.instanceId)).toEqual([margaret])
  })
})

describe('surnameIdf — condition (c) of the name-alone rule', () => {
  it('calls a two-record surname rare and a six-record one common', async () => {
    const f = await seedOrg()
    await seedContact(f, { firstName: 'Bill', lastName: 'Klooth' })
    await seedContact(f, { firstName: 'William', lastName: 'Klooth' })
    for (const first of ['Bob', 'Robert', 'Alice', 'Carl', 'Dana', 'Erin']) {
      await seedContact(f, { firstName: first, lastName: 'Smith' })
    }

    const klooth = (await surnameIdf(db(), f.orgId, f.defId, 'Klooth'))._unsafeUnwrap()
    const smith = (await surnameIdf(db(), f.orgId, f.defId, 'Smith'))._unsafeUnwrap()

    expect(klooth).toMatchObject({ surname: 'klooth', count: 2, total: 8, rare: true })
    expect(smith).toMatchObject({ surname: 'smith', count: 6, rare: false })
    expect(klooth.idf).toBeGreaterThan(smith.idf)
  })

  it('normalizes punctuation the same way the comparator does', async () => {
    const f = await seedOrg()
    await seedContact(f, { firstName: 'Sean', lastName: "O'Brien" })

    const rarity = (await surnameIdf(db(), f.orgId, f.defId, "o'brien"))._unsafeUnwrap()
    expect(rarity).toMatchObject({ surname: 'o brien', count: 1, rare: true })
  })

  it('does not report a surname nobody holds as maximally rare', async () => {
    const f = await seedOrg()
    await seedContact(f, { firstName: 'Bill', lastName: 'Klooth' })

    const rarity = (await surnameIdf(db(), f.orgId, f.defId, 'Nobody'))._unsafeUnwrap()
    expect(rarity).toMatchObject({ count: 0, rare: false })
  })

  it('excludes archived records from the corpus', async () => {
    const f = await seedOrg()
    await seedContact(f, { firstName: 'Bill', lastName: 'Klooth' })
    const ghost = await seedContact(f, { firstName: 'William', lastName: 'Klooth' })
    await db()
      .update(schema.EntityInstance)
      .set({ archivedAt: new Date() })
      .where(eq(schema.EntityInstance.id, ghost))

    const rarity = (await surnameIdf(db(), f.orgId, f.defId, 'Klooth'))._unsafeUnwrap()
    expect(rarity.count).toBe(1)
  })
})

describe('corroboratePair — the five corroborators', () => {
  it('finds a shared employer and names the company', async () => {
    const f = await seedOrg()
    const acme = await seedCompany(f, 'Acme Supply', 'acme-supply.example')
    const a = await seedContact(f, { firstName: 'Ada', lastName: 'Rowe', employerId: acme })
    const b = await seedContact(f, { firstName: 'A', lastName: 'Rowe', employerId: acme })

    const [low, high] = [a, b].sort() as [string, string]
    const signals = (
      await corroboratePair(db(), {
        organizationId: f.orgId,
        instanceIdLow: low,
        instanceIdHigh: high,
        fields: corroborationFields(f),
        ownDomains: new Set(),
      })
    )._unsafeUnwrap()

    expect(signals).toContainEqual({
      type: 'company',
      strength: 'corroborating',
      value: 'Acme Supply',
    })
  })

  it('finds a shared address across punctuation differences', async () => {
    const f = await seedOrg()
    const a = await seedContact(f, { firstName: 'Ada', lastName: 'Rowe', address: '12 Main St.' })
    const b = await seedContact(f, { firstName: 'A', lastName: 'Rowe', address: '12 main st' })

    const [low, high] = [a, b].sort() as [string, string]
    const signals = (
      await corroboratePair(db(), {
        organizationId: f.orgId,
        instanceIdLow: low,
        instanceIdHigh: high,
        fields: corroborationFields(f),
        ownDomains: new Set(),
      })
    )._unsafeUnwrap()

    expect(signals).toContainEqual({
      type: 'address',
      strength: 'corroborating',
      value: '12 main st',
    })
  })

  it('finds complementary identity sources, and ignores an identical one', async () => {
    const f = await seedOrg()
    const complementary = async (sourceA: string, sourceB: string) => {
      const a = await seedContact(f, {
        firstName: 'Ada',
        lastName: 'Rowe',
        identitySource: sourceA,
      })
      const b = await seedContact(f, { firstName: 'A', lastName: 'Rowe', identitySource: sourceB })
      const [low, high] = [a, b].sort() as [string, string]
      const signals = (
        await corroboratePair(db(), {
          organizationId: f.orgId,
          instanceIdLow: low,
          instanceIdHigh: high,
          fields: corroborationFields(f),
          ownDomains: new Set(),
        })
      )._unsafeUnwrap()
      return signals.some((s) => s.type === 'identity')
    }

    expect(await complementary('shopify', 'quickbooks')).toBe(true)
    expect(await complementary('shopify', 'shopify')).toBe(false)
  })

  it("matches one record's email domain against the other's employer domain", async () => {
    const f = await seedOrg()
    const acme = await seedCompany(f, 'Acme Supply', 'acme-supply.example')
    const employed = await seedContact(f, {
      firstName: 'Ada',
      lastName: 'Rowe',
      employerId: acme,
    })
    const mailer = await seedContact(f, {
      firstName: 'A',
      lastName: 'Rowe',
      emails: ['ada@acme-supply.example'],
    })

    const [low, high] = [employed, mailer].sort() as [string, string]
    const signals = (
      await corroboratePair(db(), {
        organizationId: f.orgId,
        instanceIdLow: low,
        instanceIdHigh: high,
        fields: corroborationFields(f),
        ownDomains: new Set(),
      })
    )._unsafeUnwrap()

    expect(signals).toContainEqual({
      type: 'company',
      strength: 'corroborating',
      value: 'acme-supply.example',
    })
  })

  it('ignores a free-provider email domain, which says nothing about an employer', async () => {
    const f = await seedOrg()
    const gmail = await seedCompany(f, 'Gmail', 'gmail.com')
    const employed = await seedContact(f, {
      firstName: 'Ada',
      lastName: 'Rowe',
      employerId: gmail,
    })
    const mailer = await seedContact(f, {
      firstName: 'A',
      lastName: 'Rowe',
      emails: ['ada@gmail.com'],
    })

    const [low, high] = [employed, mailer].sort() as [string, string]
    const signals = (
      await corroboratePair(db(), {
        organizationId: f.orgId,
        instanceIdLow: low,
        instanceIdHigh: high,
        fields: corroborationFields(f),
        ownDomains: new Set(),
      })
    )._unsafeUnwrap()

    expect(signals.filter((s) => s.type === 'company')).toEqual([])
  })

  it('flags two records whose first interaction lands on the same second', async () => {
    const f = await seedOrg()
    const at = new Date('2026-08-14T10:00:00.000Z')
    const a = await seedContact(f, { firstName: 'Ada', lastName: 'Rowe', firstInteractionAt: at })
    const b = await seedContact(f, {
      firstName: 'A',
      lastName: 'Rowe',
      firstInteractionAt: new Date('2026-08-14T10:00:00.400Z'),
    })
    const c = await seedContact(f, {
      firstName: 'A',
      lastName: 'Rowe',
      firstInteractionAt: new Date('2026-08-14T10:00:02.000Z'),
    })

    const ingestSignals = async (x: string, y: string) => {
      const [low, high] = [x, y].sort() as [string, string]
      const signals = (
        await corroboratePair(db(), {
          organizationId: f.orgId,
          instanceIdLow: low,
          instanceIdHigh: high,
          fields: corroborationFields(f),
          ownDomains: new Set(),
        })
      )._unsafeUnwrap()
      return signals.filter((s) => s.type === 'ingest')
    }

    expect(await ingestSignals(a, b)).toHaveLength(1)
    expect(await ingestSignals(a, c)).toHaveLength(0)
  })
})

describe('the medium band, end to end (the required suite)', () => {
  const bandsOf = (pairs: Array<{ band: string }>) => pairs.map((p) => p.band)

  it('bill klooth / william klooth — rare surname, no corroboration → MEDIUM', async () => {
    const f = await seedOrg()
    const bill = await seedContact(f, { firstName: 'Bill', lastName: 'Klooth' })
    await seedContact(f, { firstName: 'William', lastName: 'Klooth' })

    expect(bandsOf(await scanFuzzy(f, bill))).toEqual(['medium'])

    const rows = await storedPairs(f)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.band).toBe('medium')
    // The stored evidence is the NAME signal and nothing else — in particular,
    // no similarity number came along for the ride.
    expect(rows[0]?.signals).toEqual([{ type: 'name', strength: 'fuzzy', value: 'klooth' }])
  })

  it('peggy / margaret on a rare surname → medium, which only the dictionary can do', async () => {
    const f = await seedOrg()
    const peggy = await seedContact(f, { firstName: 'Peggy', lastName: 'Klooth' })
    await seedContact(f, { firstName: 'Margaret', lastName: 'Klooth' })

    expect(bandsOf(await scanFuzzy(f, peggy))).toEqual(['medium'])
  })

  it('john smith / jane smith → DROPPED (the regression test for the whole rule)', async () => {
    const f = await seedOrg()
    const john = await seedContact(f, { firstName: 'John', lastName: 'Smith' })
    const jane = await seedContact(f, { firstName: 'Jane', lastName: 'Smith' })

    // The blocker DOES find them — full-name similarity is 0.4666667, its
    // highest score of the whole suite. The comparator is what refuses them.
    const candidates = (
      await blockFuzzyRecord(db(), {
        organizationId: f.orgId,
        entityDefinitionId: f.defId,
        instanceId: john,
      })
    )._unsafeUnwrap()
    expect(candidates.map((c) => c.instanceId)).toEqual([jane])

    expect(await scanFuzzy(f, john)).toEqual([])
    expect(await storedPairs(f)).toEqual([])
  })

  it('bob smith / robert smith — common surname → nothing until corroborated', async () => {
    const f = await seedOrg()
    const acme = await seedCompany(f, 'Acme Supply', 'acme-supply.example')
    for (const first of ['Alice', 'Carl', 'Dana', 'Erin']) {
      await seedContact(f, { firstName: first, lastName: 'Smith' })
    }
    const bob = await seedContact(f, { firstName: 'Bob', lastName: 'Smith' })
    const robert = await seedContact(f, { firstName: 'Robert', lastName: 'Smith' })

    expect(await scanFuzzy(f, bob)).toEqual([])

    // Same employer — now the name match has something to be promoted by.
    for (const id of [bob, robert]) {
      await db().insert(schema.FieldValue).values({
        organizationId: f.orgId,
        entityId: id,
        entityDefinitionId: f.defId,
        fieldId: f.employerFieldId,
        sortKey: 'a0',
        relatedEntityId: acme,
      })
    }

    const scored = await scanFuzzy(f, bob)
    expect(bandsOf(scored)).toEqual(['medium'])
    expect(scored[0]?.signals.map((s: Signal) => s.type).sort()).toEqual(['company', 'name'])
  })

  it('jon / jonathan at the same company → medium via corroboration', async () => {
    const f = await seedOrg()
    const acme = await seedCompany(f, 'Acme Supply', 'acme-supply.example')
    for (const first of ['Alice', 'Carl', 'Dana', 'Erin']) {
      await seedContact(f, { firstName: first, lastName: 'Smith' })
    }
    const jon = await seedContact(f, {
      firstName: 'Jon',
      lastName: 'Smith',
      employerId: acme,
    })
    await seedContact(f, { firstName: 'Jonathan', lastName: 'Smith', employerId: acme })

    expect(bandsOf(await scanFuzzy(f, jon))).toEqual(['medium'])
  })

  it('never stores a similarity value in the persisted signals', async () => {
    const f = await seedOrg()
    const bill = await seedContact(f, {
      firstName: 'Bill',
      lastName: 'Klooth',
      address: '12 Main St',
    })
    await seedContact(f, { firstName: 'William', lastName: 'Klooth', address: '12 main st' })
    await scanFuzzy(f, bill)

    const rows = await storedPairs(f)
    expect(rows).toHaveLength(1)
    const signals = rows[0]?.signals as Signal[]
    expect(signals.length).toBeGreaterThan(1)
    for (const signal of signals) {
      expect(Object.keys(signal).sort()).toEqual(
        expect.not.arrayContaining(['similarity', 'score'])
      )
    }
    // …and the pair is still MEDIUM, not high: corroboration is capped so that
    // `high` stays reserved for an exact key match.
    expect(rows[0]?.band).toBe('medium')
  })
})
