// packages/lib/src/jobs/dedup/__tests__/duplicate-scan-job.int.test.ts
//
// DB-backed behavior tests (vitest.integration.config.ts → auxx_test) for the
// ONE scan job and its three scopes.
//
// Why integration and not unit: every claim this job rests on is a PREDICATE
// claim about SQL, and a chainable mock is predicate-blind.
//   1. The dirty predicate is `GREATEST(ei."updatedAt", max(fv."updatedAt")) >
//      "lastDuplicateScanAt"`, resolved through a LATERAL. The whole reason it
//      is not `updatedAt` alone is that a `skipEvents` writer leaves the
//      instance row untouched — only real rows can show that the lateral arm
//      fires.
//   2. Stamping the watermark must not RE-dirty the record. Drizzle's
//      `$onUpdate` on `EntityInstance.updatedAt` would do exactly that, which is
//      why the stamp is raw SQL; a mock would happily "pass" either way.
//
// The org cache barrel is mocked wholesale (deterministic, no Redis): field
// lookups read straight from the test DB. The feature service is mocked so the
// flag is a test input rather than a Redis-backed plan lookup.

import { schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { and, eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = () => getTestDb() as never as import('@auxx/database').Database

// ── Feature flag as a test input ────────────────────────────────────────────

const flags = vi.hoisted(() => ({ enabled: new Set<string>() }))

vi.mock('../../../permissions/feature-permission-service', () => ({
  FeaturePermissionService: class {
    async hasAccess(organizationId: string) {
      return flags.enabled.has(organizationId)
    }
  },
}))

// ── Org-cache mock (wholesale — DB-backed, no Redis, no providers) ──────────

vi.mock('../../../cache', () => {
  const tdb = () => getTestDb() as never as import('@auxx/database').Database

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
    getCachedEntityDefId: async (_orgId: string, slugOrId: string) => slugOrId,
    // Shaped like `ResourceField` — only what `deriveMatchKeys` reads.
    getCachedResourceFields: async (orgId: string, defId: string) => {
      const rows = await tdb()
        .select()
        .from(schema.CustomField)
        .where(
          and(
            eq(schema.CustomField.organizationId, orgId),
            eq(schema.CustomField.entityDefinitionId, defId)
          )
        )
      return rows.map((f) => ({
        id: f.id,
        key: f.name,
        label: f.name,
        type: 'string',
        fieldType: f.type,
        systemAttribute: f.systemAttribute ?? undefined,
        isUnique: f.isUnique,
        options: f.options ?? {},
        capabilities: {},
      }))
    },
  }
})

import { duplicateScanJob } from '../duplicate-scan-job'

// ── Fixtures ───────────────────────────────────────────────────────────────

interface Fixture {
  orgId: string
  defId: string
  emailFieldId: string
  phoneFieldId: string
  firstNameFieldId: string
  lastNameFieldId: string
}

async function seedContactOrg(): Promise<Fixture> {
  const org = await createTestOrganization()
  const orgId = org.id
  flags.enabled.add(orgId)

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
    systemAttribute: string,
    sortOrder: string
  ) => {
    const [row] = await db()
      .insert(schema.CustomField)
      .values({
        organizationId: orgId,
        entityDefinitionId: def?.id as string,
        modelType: 'contact',
        name,
        type,
        systemAttribute,
        sortOrder,
        options: type === 'TEXT' ? {} : { multi: true },
        isCustom: false,
        isUnique: false,
        updatedAt: new Date(),
      })
      .returning()
    return row?.id as string
  }

  return {
    orgId,
    defId: def?.id as string,
    emailFieldId: await makeField('primaryEmail', 'EMAIL', 'primary_email', 'a2'),
    phoneFieldId: await makeField('phone', 'PHONE_INTL', 'phone', 'a3'),
    // Ordinary TEXT `CustomField` rows — `firstName`/`lastName` carry a
    // `dbColumn` in the registry but neither column exists on `EntityInstance`,
    // so they live in `FieldValue` like any other field.
    firstNameFieldId: await makeField('firstName', 'TEXT', 'first_name', 'a4'),
    lastNameFieldId: await makeField('lastName', 'TEXT', 'last_name', 'a5'),
  }
}

interface ContactValues {
  email?: string
  phone?: string
  firstName?: string
  lastName?: string
  /** Both sides on the same SECOND is the `ingest` corroborator. */
  firstInteractionAt?: Date
}

async function seedContact(
  f: Fixture,
  displayName: string,
  values: ContactValues = {}
): Promise<string> {
  const [inst] = await db()
    .insert(schema.EntityInstance)
    .values({
      organizationId: f.orgId,
      entityDefinitionId: f.defId,
      displayName,
      firstInteractionAt: values.firstInteractionAt ?? null,
      updatedAt: new Date(),
    })
    .returning()

  const write = async (fieldId: string, value?: string) => {
    if (!value) return
    await db()
      .insert(schema.FieldValue)
      .values({
        organizationId: f.orgId,
        entityId: inst?.id as string,
        entityDefinitionId: f.defId,
        fieldId,
        valueText: value,
        sortKey: 'a0',
      })
  }

  await write(f.emailFieldId, values.email)
  await write(f.phoneFieldId, values.phone)
  await write(f.firstNameFieldId, values.firstName)
  await write(f.lastNameFieldId, values.lastName)
  return inst?.id as string
}

/** A person, as the name arm needs them: display name AND structured parts. */
const person = (
  first: string,
  last: string,
  extra: ContactValues = {}
): [string, ContactValues] => [`${first} ${last}`, { firstName: first, lastName: last, ...extra }]

/**
 * Short, realistic given names on purpose.
 *
 * The trigram blocker ranks by similarity to the whole anchor string, and a
 * short display name scores HIGHER against `Bob Smith` than a long synthetic one
 * — so a crowd of `Filler12 Smith` would leave Bob's real neighbours at the top
 * of the list and the recall problem would never reproduce.
 */
const CROWD_OF_SMITHS = [
  'Ann',
  'Amy',
  'Ben',
  'Dan',
  'Eve',
  'Gus',
  'Hal',
  'Ida',
  'Jim',
  'Joe',
  'Kim',
  'Lee',
  'Lou',
  'Mae',
  'Ned',
  'Pam',
  'Ray',
  'Ron',
  'Roy',
  'Sam',
  'Sue',
  'Tim',
  'Tom',
  'Zoe',
]

async function seedPerson(
  f: Fixture,
  first: string,
  last: string,
  extra: ContactValues = {}
): Promise<string> {
  const [displayName, values] = person(first, last, extra)
  return seedContact(f, displayName, values)
}

const runJob = (data: Record<string, unknown>) =>
  duplicateScanJob({ job: { data, id: 'job_test' } } as never)

async function pairCount(orgId: string): Promise<number> {
  const rows = await db()
    .select({ id: schema.DuplicateSuggestion.id })
    .from(schema.DuplicateSuggestion)
    .where(eq(schema.DuplicateSuggestion.organizationId, orgId))
  return rows.length
}

/** Every stored pair for one org, with the columns the band tests assert on. */
async function storedPairs(orgId: string) {
  return db()
    .select({
      band: schema.DuplicateSuggestion.band,
      score: schema.DuplicateSuggestion.score,
      signals: schema.DuplicateSuggestion.signals,
      low: schema.DuplicateSuggestion.instanceIdLow,
      high: schema.DuplicateSuggestion.instanceIdHigh,
    })
    .from(schema.DuplicateSuggestion)
    .where(eq(schema.DuplicateSuggestion.organizationId, orgId))
}

/** The stored pair joining two specific records, or `undefined`. */
async function storedPairFor(orgId: string, a: string, b: string) {
  const [low, high] = a < b ? [a, b] : [b, a]
  return (await storedPairs(orgId)).find((row) => row.low === low && row.high === high)
}

async function watermark(instanceId: string): Promise<Date | null> {
  const [row] = await db()
    .select({ at: schema.EntityInstance.lastDuplicateScanAt })
    .from(schema.EntityInstance)
    .where(eq(schema.EntityInstance.id, instanceId))
  return row?.at ?? null
}

beforeEach(() => {
  flags.enabled.clear()
})

// ═══════════════════════════════════════════════════════════════════════════

describe('duplicateScanJob — org+def scope (the coalesced mutation seam)', () => {
  it('pairs two contacts sharing a phone and stamps both watermarks', async () => {
    const f = await seedContactOrg()
    const a = await seedContact(f, 'A', { phone: '+12133734253' })
    const b = await seedContact(f, 'B', { phone: '+12133734253' })

    const stats = await runJob({ organizationId: f.orgId, entityDefinitionId: f.defId })

    expect(stats.scanned).toBe(2)
    expect(await pairCount(f.orgId)).toBe(1)
    expect(await watermark(a)).not.toBeNull()
    expect(await watermark(b)).not.toBeNull()
  })

  it('finds NOTHING dirty on an immediate second run', async () => {
    // The stamp must not re-dirty the record. `EntityInstance.updatedAt` carries
    // `$onUpdate`, so a Drizzle `.update()` here would bump `updatedAt` in the
    // same statement and loop the scanner forever.
    const f = await seedContactOrg()
    await seedContact(f, 'A', { phone: '+12133734253' })
    await seedContact(f, 'B', { phone: '+12133734253' })

    await runJob({ organizationId: f.orgId, entityDefinitionId: f.defId })
    const second = await runJob({ organizationId: f.orgId, entityDefinitionId: f.defId })

    expect(second.scanned).toBe(0)
  })

  it('picks a record up again once it is dirtied after the stamp', async () => {
    const f = await seedContactOrg()
    const a = await seedContact(f, 'A', { phone: '+12133734253' })
    await seedContact(f, 'B', { phone: '+12133734253' })
    await runJob({ organizationId: f.orgId, entityDefinitionId: f.defId })

    await db().execute(
      sql`UPDATE "EntityInstance" SET "updatedAt" = now() + interval '1 second' WHERE "id" = ${a}`
    )

    const again = await runJob({ organizationId: f.orgId, entityDefinitionId: f.defId })
    expect(again.scanned).toBe(1)
  })

  it('finds a `skipEvents` write through the FieldValue lateral', async () => {
    // THE reason the predicate is not `updatedAt` alone: a connector sync or CSV
    // import leaves BOTH `EntityInstance.updatedAt` and `lastActivityAt`
    // untouched. `FieldValue.updatedAt` is the only timestamp that always moves.
    const f = await seedContactOrg()
    const a = await seedContact(f, 'A', { email: 'a@example.com' })
    const b = await seedContact(f, 'B', { email: 'other@example.com' })
    await runJob({ organizationId: f.orgId, entityDefinitionId: f.defId })
    expect(await pairCount(f.orgId)).toBe(0)

    // Exactly what a `skipEvents` writer does: the value row moves, the instance
    // row does not.
    await db().execute(sql`
      UPDATE "FieldValue"
      SET "valueText" = 'a@example.com', "updatedAt" = now() + interval '1 second'
      WHERE "entityId" = ${b} AND "fieldId" = ${f.emailFieldId}
    `)
    const beforeInstanceUpdatedAt = (
      await db()
        .select({ at: schema.EntityInstance.updatedAt })
        .from(schema.EntityInstance)
        .where(eq(schema.EntityInstance.id, b))
    )[0]?.at

    const again = await runJob({ organizationId: f.orgId, entityDefinitionId: f.defId })

    expect(again.scanned).toBe(1)
    expect(await pairCount(f.orgId)).toBe(1)
    // Sanity: the instance row really was untouched, so `updatedAt` alone could
    // never have found this record.
    const afterInstanceUpdatedAt = (
      await db()
        .select({ at: schema.EntityInstance.updatedAt })
        .from(schema.EntityInstance)
        .where(eq(schema.EntityInstance.id, b))
    )[0]?.at
    expect(afterInstanceUpdatedAt?.getTime()).toBe(beforeInstanceUpdatedAt?.getTime())
    expect(a).toBeTruthy()
  })

  it('closes a pair whose evidence is gone (rescore-on-change)', async () => {
    const f = await seedContactOrg()
    await seedContact(f, 'A', { email: 'same@example.com' })
    const b = await seedContact(f, 'B', { email: 'same@example.com' })
    await runJob({ organizationId: f.orgId, entityDefinitionId: f.defId })
    expect(await pairCount(f.orgId)).toBe(1)

    await db().execute(sql`
      UPDATE "FieldValue"
      SET "valueText" = 'corrected@example.com', "updatedAt" = now() + interval '1 second'
      WHERE "entityId" = ${b} AND "fieldId" = ${f.emailFieldId}
    `)

    const again = await runJob({ organizationId: f.orgId, entityDefinitionId: f.defId })
    expect(again.closed).toBe(1)
    expect(await pairCount(f.orgId)).toBe(0)
  })

  it('skips an org without the feature flag', async () => {
    const f = await seedContactOrg()
    flags.enabled.delete(f.orgId)
    await seedContact(f, 'A', { phone: '+12133734253' })
    await seedContact(f, 'B', { phone: '+12133734253' })

    const stats = await runJob({ organizationId: f.orgId, entityDefinitionId: f.defId })

    expect(stats.scanned).toBe(0)
    expect(await pairCount(f.orgId)).toBe(0)
  })

  it('never scans an archived record as a subject', async () => {
    // `EntityInstance_org_def_dup_scan_idx` is PARTIAL on `archivedAt IS NULL`,
    // so the predicate has to carry it — and it is correct on its own terms.
    const f = await seedContactOrg()
    const a = await seedContact(f, 'A', { phone: '+12133734253' })
    await seedContact(f, 'B', { phone: '+12133734253' })
    await db()
      .update(schema.EntityInstance)
      .set({ archivedAt: new Date() })
      .where(eq(schema.EntityInstance.id, a))

    const stats = await runJob({ organizationId: f.orgId, entityDefinitionId: f.defId })

    expect(stats.scanned).toBe(1)
    expect(await pairCount(f.orgId)).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// THE PHASE-2 SEAM
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 🔴 **The regression guard for the integration seam itself.**
 *
 * Phase 2 shipped merged, unit-tested and CORRECT — and with zero production
 * callers. `scanRecord` called `blockRecord` and nothing else, so every stored
 * row was `band: 'high'` and no `medium` row existed or could. Every unit test
 * on both sides passed, and the module-level integration tests
 * (`dedup/__tests__/dedup-fuzzy.int.test.ts`) passed too, because they compose
 * the pipeline BY HAND — which is exactly what production was not doing.
 *
 * So these tests run the JOB HANDLER and assert on rows in
 * `DuplicateSuggestion`. Nothing between the job data and the stored band is
 * stubbed. Delete the fuzzy arm from `scanRecord` and every case here fails;
 * that is the only property that matters about this block.
 */
describe('duplicateScanJob — the name arm (Phase 2 must actually run)', () => {
  it('stores a MEDIUM pair for a nickname on a rare surname, with no other evidence', async () => {
    // No shared email, no shared phone, no corroboration — the genesis-map G1
    // shape (email↔phone twin), where the name is the only evidence there is.
    const f = await seedContactOrg()
    const bill = await seedPerson(f, 'Bill', 'Quillfeather')
    const william = await seedPerson(f, 'William', 'Quillfeather')

    await runJob({ organizationId: f.orgId, entityDefinitionId: f.defId })

    const pair = await storedPairFor(f.orgId, bill, william)
    expect(pair).toBeDefined()
    expect(pair?.band).toBe('medium')
    const signals = (pair?.signals ?? []) as Array<Record<string, unknown>>
    expect(signals.some((s) => s.type === 'name')).toBe(true)
    // The blocker's similarity number must never reach storage: full-name
    // trigram ranks `john smith`/`jane smith` ABOVE every true nickname pair.
    expect(signals.every((s) => s.similarity === undefined)).toBe(true)
  })

  it('recovers peggy / margaret, which only the nickname dictionary can do', async () => {
    // Zero shared trigrams — no string metric reaches this pair, ever.
    const f = await seedContactOrg()
    const peggy = await seedPerson(f, 'Peggy', 'Quillfeather')
    const margaret = await seedPerson(f, 'Margaret', 'Quillfeather')

    await runJob({ organizationId: f.orgId, entityDefinitionId: f.defId })

    expect((await storedPairFor(f.orgId, peggy, margaret))?.band).toBe('medium')
  })

  it('does NOT pair john smith with jane smith', async () => {
    // The regression test for the whole name rule. Raw `displayName` trigram
    // scores this pair 0.4666667 — higher than bill/william (0.4210526) — so a
    // scorer that ranked on similarity would lead the queue with siblings and
    // spouses. It fails given-name equivalence AND surname rarity.
    const f = await seedContactOrg()
    await seedPerson(f, 'John', 'Smith')
    await seedPerson(f, 'Jane', 'Smith')
    for (let i = 0; i < 4; i++) await seedPerson(f, `Filler${i}`, 'Smith')

    await runJob({ organizationId: f.orgId, entityDefinitionId: f.defId })

    expect(await pairCount(f.orgId)).toBe(0)
  })

  it('does NOT pair john / jane even when the surname is rare', async () => {
    // Rarity alone must never suggest: with a rare surname, the GIVEN-NAME
    // condition is the only thing left that can reject this pair, so this is
    // where a loosened name rule would show up first.
    const f = await seedContactOrg()
    await seedPerson(f, 'John', 'Quillfeather')
    await seedPerson(f, 'Jane', 'Quillfeather')

    await runJob({ organizationId: f.orgId, entityDefinitionId: f.defId })

    expect(await pairCount(f.orgId)).toBe(0)
  })

  it('reaches bob smith / robert smith through corroboration, past a crowd of Smiths', async () => {
    // Two fixes meet here. (1) The nickname is a dictionary hit but `smith` is
    // common, so the pair only reaches `medium` with a corroborating signal —
    // here a shared `firstInteractionAt` second. (2) The blocker has to GENERATE
    // the pair at all: the trigram pass is per-anchor capped and truncates
    // against a crowd of Smiths, which is why the exact-surname anchor pass
    // exists. Corroboration cannot rescue a pair that was never generated.
    const f = await seedContactOrg()
    const sameSecond = new Date('2026-03-01T10:00:00.000Z')
    for (const given of CROWD_OF_SMITHS) await seedPerson(f, given, 'Smith')
    const bob = await seedPerson(f, 'Bob', 'Smith', { firstInteractionAt: sameSecond })
    const robert = await seedPerson(f, 'Robert', 'Smith', { firstInteractionAt: sameSecond })

    await runJob({ organizationId: f.orgId, entityDefinitionId: f.defId })

    const pair = await storedPairFor(f.orgId, bob, robert)
    expect(pair).toBeDefined()
    expect(pair?.band).toBe('medium')
    const types = ((pair?.signals ?? []) as Array<Record<string, unknown>>).map((s) => s.type)
    expect(types).toContain('name')
    expect(types).toContain('ingest')
  })

  it('drops bob / robert on a common surname when nothing corroborates', async () => {
    const f = await seedContactOrg()
    for (const given of CROWD_OF_SMITHS) await seedPerson(f, given, 'Smith')
    const bob = await seedPerson(f, 'Bob', 'Smith')
    const robert = await seedPerson(f, 'Robert', 'Smith')

    await runJob({ organizationId: f.orgId, entityDefinitionId: f.defId })

    expect(await storedPairFor(f.orgId, bob, robert)).toBeUndefined()
  })

  it('keeps a pair HIGH when the exact and name arms both fire on it', async () => {
    // The merge step in `scanRecord`. Both arms produce the same canonical pair,
    // and `upsertPairs` keeps the last writer — so without merging, a `high`
    // exact pair is silently rewritten as `medium` by the name arm.
    const f = await seedContactOrg()
    const a = await seedPerson(f, 'Bill', 'Quillfeather', { phone: '+12133734253' })
    const b = await seedPerson(f, 'William', 'Quillfeather', { phone: '+12133734253' })

    await runJob({ organizationId: f.orgId, entityDefinitionId: f.defId })

    const pair = await storedPairFor(f.orgId, a, b)
    expect(pair?.band).toBe('high')
    const types = ((pair?.signals ?? []) as Array<Record<string, unknown>>).map((s) => s.type)
    expect(types).toContain('phone')
    expect(types).toContain('name')
  })

  it('runs no name arm for a definition with no surname field', async () => {
    // Companies have no `firstName`/`lastName`, so the whole arm is skipped
    // rather than half-run — and the exact keys keep working untouched.
    const f = await seedContactOrg()
    await db()
      .delete(schema.CustomField)
      .where(eq(schema.CustomField.id, f.lastNameFieldId as string))
    const a = await seedContact(f, 'Bill Quillfeather', { firstName: 'Bill' })
    const b = await seedContact(f, 'William Quillfeather', { firstName: 'William' })

    const stats = await runJob({ organizationId: f.orgId, entityDefinitionId: f.defId })

    expect(stats.scanned).toBe(2)
    expect(await storedPairFor(f.orgId, a, b)).toBeUndefined()
  })
})

describe('duplicateScanJob — recordIds scope (the sync-manifest door)', () => {
  it('scans exactly the manifest ids', async () => {
    const f = await seedContactOrg()
    const a = await seedContact(f, 'A', { phone: '+12133734253' })
    const b = await seedContact(f, 'B', { phone: '+12133734253' })
    await seedContact(f, 'C', { phone: '+12125551234' })

    const stats = await runJob({
      organizationId: f.orgId,
      recordIds: [`${f.defId}:${a}`, `${f.defId}:${b}`],
    })

    expect(stats.scanned).toBe(2)
    expect(await pairCount(f.orgId)).toBe(1)
  })

  it('refuses ids from another organization', async () => {
    const f = await seedContactOrg()
    const other = await seedContactOrg()
    const foreign = await seedContact(other, 'X', { phone: '+12133734253' })

    const stats = await runJob({
      organizationId: f.orgId,
      recordIds: [`${other.defId}:${foreign}`],
    })

    expect(stats.scanned).toBe(0)
  })

  it('is idempotent — re-running the same manifest writes one pair', async () => {
    const f = await seedContactOrg()
    const a = await seedContact(f, 'A', { phone: '+12133734253' })
    const b = await seedContact(f, 'B', { phone: '+12133734253' })
    const ids = [`${f.defId}:${a}`, `${f.defId}:${b}`]

    await runJob({ organizationId: f.orgId, recordIds: ids })
    await runJob({ organizationId: f.orgId, recordIds: ids })

    expect(await pairCount(f.orgId)).toBe(1)
  })
})

describe('duplicateScanJob — no scope (the 6h sweep)', () => {
  it('walks feature-enabled orgs × allowlisted definitions', async () => {
    const f = await seedContactOrg()
    await seedContact(f, 'A', { email: 'sweep@example.com' })
    await seedContact(f, 'B', { email: 'sweep@example.com' })

    const stats = await runJob({ dryRun: false })

    expect(stats.definitions).toBeGreaterThanOrEqual(1)
    expect(await pairCount(f.orgId)).toBe(1)
  })

  it('skips a definition whose entityType is not allowlisted', async () => {
    const f = await seedContactOrg()
    await db()
      .update(schema.EntityDefinition)
      .set({ entityType: 'ticket' })
      .where(eq(schema.EntityDefinition.id, f.defId))
    await seedContact(f, 'A', { email: 'sweep@example.com' })
    await seedContact(f, 'B', { email: 'sweep@example.com' })

    const stats = await runJob({ dryRun: false })

    expect(stats.definitions).toBe(0)
    expect(await pairCount(f.orgId)).toBe(0)
  })

  it('dryRun writes no pairs and stamps no watermark', async () => {
    const f = await seedContactOrg()
    const a = await seedContact(f, 'A', { email: 'dry@example.com' })
    await seedContact(f, 'B', { email: 'dry@example.com' })

    await runJob({ organizationId: f.orgId, entityDefinitionId: f.defId, dryRun: true })

    expect(await pairCount(f.orgId)).toBe(0)
    expect(await watermark(a)).toBeNull()
  })
})
