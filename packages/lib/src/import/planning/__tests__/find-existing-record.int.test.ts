// packages/lib/src/import/planning/__tests__/find-existing-record.int.test.ts
//
// DB-backed tests (vitest.integration.config.ts) for the system-table branch of
// `createFindExistingRecord`.
//
// Why integration and not unit: the regression pinned here is pure SQL operator
// semantics. `findInSystemTable` compared emails with `ilike(column, value)`,
// passing the raw CSV cell in as a LIKE **pattern** — where `_` matches any single
// character and `%` any sequence. Underscores are ordinary in email local parts, so
// `john_smith@acme.test` matched a stored `johnXsmith@acme.test`. Because this
// function decides create-vs-update during import planning, a false match would make
// the importer UPDATE an unrelated row rather than create a new one — a wrong write,
// not a missed one — and `.limit(1)` carries no ORDER BY, so which row got clobbered
// was arbitrary. A predicate-blind fake-db test cannot see any of this; only real SQL
// can. Custom entities were never affected: they route through the shared lookup
// core, which does typed column equality.
//
// The fixture drives `participant` with an identifier field mapped to the REAL
// `identifier` column. That is deliberate: the subject under test is the comparison
// operator, and no registry-shipped system resource currently reaches this branch —
// see `find-existing-record.ts`'s note on the two upstream blockers.

import { schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { generateId } from '@auxx/utils'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Resource, ResourceField } from '../../../resources'
import { BaseType } from '../../../workflow-engine/core/types'
import { createFindExistingRecord } from '../find-existing-record'

const PARTICIPANT_RESOURCE = { id: 'participant', type: 'system' } as unknown as Resource

/** Maps to the real `Participant.identifier` column, typed EMAIL to hit the branch. */
const EMAIL_IDENTIFIER_FIELD = {
  key: 'identifier',
  dbColumn: 'identifier',
  type: BaseType.EMAIL,
} as unknown as ResourceField

/** `dbColumn === 'id'` is the discriminator, not `key`, see the branch comment. */
const RECORD_ID_FIELD = {
  key: 'id',
  dbColumn: 'id',
  type: BaseType.STRING,
} as unknown as ResourceField

describe('createFindExistingRecord — system-table email comparison', () => {
  let organizationId: string
  let db: ReturnType<typeof getTestDb>

  beforeEach(async () => {
    db = getTestDb()
    const org = await createTestOrganization()
    organizationId = org.id
  })

  const seed = async (identifier: string, orgId = organizationId): Promise<string> => {
    const id = generateId()
    await db.insert(schema.Participant).values({
      id,
      organizationId: orgId,
      identifier,
      identifierType: 'EMAIL',
      updatedAt: new Date(),
    } as typeof schema.Participant.$inferInsert)
    return id
  }

  const find = (value: string) =>
    createFindExistingRecord({
      db: db as never,
      organizationId,
      resource: PARTICIPANT_RESOURCE,
      identifierFields: [EMAIL_IDENTIFIER_FIELD],
    })({ identifier: value })

  it('matches an exact email', async () => {
    const id = await seed('john.smith@acme.test')
    await expect(find('john.smith@acme.test')).resolves.toEqual({ kind: 'one', recordId: id })
  })

  it('matches case-insensitively', async () => {
    const id = await seed('john.smith@acme.test')
    await expect(find('John.Smith@ACME.test')).resolves.toEqual({ kind: 'one', recordId: id })
  })

  // THE REGRESSION. Under `ilike(column, rawValue)` this resolved to the seeded row,
  // and the import would have overwritten that unrelated participant.
  it('does NOT treat `_` in the CSV cell as a single-character wildcard', async () => {
    await seed('johnXsmith@acme.test')
    await expect(find('john_smith@acme.test')).resolves.toEqual({ kind: 'none' })
  })

  it('does NOT treat `%` in the CSV cell as a wildcard', async () => {
    await seed('anything-at-all@acme.test')
    await expect(find('%@acme.test')).resolves.toEqual({ kind: 'none' })
  })

  it('still finds a literal underscore address that genuinely exists', async () => {
    const id = await seed('john_smith@acme.test')
    await expect(find('john_smith@acme.test')).resolves.toEqual({ kind: 'one', recordId: id })
  })

  it('is organization-scoped', async () => {
    const other = await createTestOrganization()
    await seed('shared@acme.test', other.id)
    await expect(find('shared@acme.test')).resolves.toEqual({ kind: 'none' })
  })
})

/**
 * `Participant.name` is deliberately NOT unique, which is what makes it usable
 * for the ambiguity and case-folding cases: `identifier` carries a unique index,
 * so two rows can never share one.
 */
const NAME_IDENTIFIER_FIELD = {
  key: 'name',
  dbColumn: 'name',
  type: BaseType.STRING,
} as unknown as ResourceField

describe('createFindExistingRecord, ambiguity and case folding on a system table', () => {
  let organizationId: string
  let db: ReturnType<typeof getTestDb>

  beforeEach(async () => {
    db = getTestDb()
    const org = await createTestOrganization()
    organizationId = org.id
  })

  const seedNamed = async (name: string, identifier: string): Promise<string> => {
    const id = generateId()
    await db.insert(schema.Participant).values({
      id,
      organizationId,
      identifier,
      identifierType: 'EMAIL',
      name,
      updatedAt: new Date(),
    } as typeof schema.Participant.$inferInsert)
    return id
  }

  const byName = (name: string) =>
    createFindExistingRecord({
      db: db as never,
      organizationId,
      resource: PARTICIPANT_RESOURCE,
      identifierFields: [NAME_IDENTIFIER_FIELD],
    })({ name })

  // `limit(1)` used to make two records sharing an identifier update an
  // ARBITRARY one of them, and with no ORDER BY, WHICH one was undefined.
  it('reports AMBIGUITY rather than picking one of two records sharing the value', async () => {
    await seedNamed('M400L', 'a@acme.test')
    await seedNamed('M400L', 'b@acme.test')
    await expect(byName('M400L')).resolves.toEqual({ kind: 'ambiguous', count: 2 })
  })

  // The direction is pinned BOTH ways so the identifier path can never drift
  // away from the relation path, which has always been case-insensitive.
  it('matches a LOWER-CASE cell against an UPPER-CASE stored value', async () => {
    const id = await seedNamed('M400L', 'a@acme.test')
    await expect(byName('m400l')).resolves.toEqual({ kind: 'one', recordId: id })
  })

  it('matches an UPPER-CASE cell against a LOWER-CASE stored value', async () => {
    const id = await seedNamed('m400l', 'a@acme.test')
    await expect(byName('M400L')).resolves.toEqual({ kind: 'one', recordId: id })
  })

  // `lower(col) = lower(val)`, never ILIKE: `_` and `%` are ordinary in SKUs.
  it('does not treat `_` or `%` in the cell as wildcards', async () => {
    await seedNamed('AX100', 'a@acme.test')
    await expect(byName('A_100')).resolves.toEqual({ kind: 'none' })
    await expect(byName('%100')).resolves.toEqual({ kind: 'none' })
  })
})

describe('createFindExistingRecord, composite key on a system table', () => {
  let organizationId: string
  let db: ReturnType<typeof getTestDb>

  beforeEach(async () => {
    db = getTestDb()
    const org = await createTestOrganization()
    organizationId = org.id
  })

  const seedNamed = async (name: string, identifier: string): Promise<string> => {
    const id = generateId()
    await db.insert(schema.Participant).values({
      id,
      organizationId,
      identifier,
      identifierType: 'EMAIL',
      name,
      updatedAt: new Date(),
    } as typeof schema.Participant.$inferInsert)
    return id
  }

  const findBoth = (name: string, identifier: string) =>
    createFindExistingRecord({
      db: db as never,
      organizationId,
      resource: PARTICIPANT_RESOURCE,
      identifierFields: [NAME_IDENTIFIER_FIELD, EMAIL_IDENTIFIER_FIELD],
    })({ name, identifier })

  it('ANDs the two components', async () => {
    const id = await seedNamed('M400L', 'acme@x.test')
    await seedNamed('M400L', 'globex@x.test')
    await expect(findBoth('M400L', 'acme@x.test')).resolves.toEqual({ kind: 'one', recordId: id })
  })

  // A record matching ONE component must not match the tuple, that is the
  // difference between a composite key and a widened one.
  it('does NOT match a record that satisfies only one component', async () => {
    await seedNamed('M400L', 'acme@x.test')
    await expect(findBoth('M400L', 'someone-else@x.test')).resolves.toEqual({ kind: 'none' })
    await expect(findBoth('OTHER', 'acme@x.test')).resolves.toEqual({ kind: 'none' })
  })

  it('never partially matches when a component is blank', async () => {
    await seedNamed('M400L', 'acme@x.test')
    await expect(findBoth('M400L', '')).resolves.toEqual({ kind: 'none' })
  })
})

/**
 * The `id` branch on an ENTITY-BACKED resource (Defect C). Real SQL, because
 * the two scope predicates ARE the safety property: a cuid is unique across the
 * whole EntityInstance table, so `eq(id, value)` alone would let a `part`
 * import update a `contact`, or a row in another tenant.
 */
describe('createFindExistingRecord, Record ID on an entity-backed resource', () => {
  let organizationId: string
  let otherOrganizationId: string
  let partDefId: string
  let contactDefId: string
  let db: ReturnType<typeof getTestDb>

  const seedDef = async (orgId: string, slug: string): Promise<string> => {
    const id = generateId()
    await db.insert(schema.EntityDefinition).values({
      id,
      organizationId: orgId,
      apiSlug: slug,
      singular: slug,
      plural: `${slug}s`,
      updatedAt: new Date(),
    } as typeof schema.EntityDefinition.$inferInsert)
    return id
  }

  const seedInstance = async (
    orgId: string,
    defId: string,
    options?: { archived?: boolean }
  ): Promise<string> => {
    const id = generateId()
    await db.insert(schema.EntityInstance).values({
      id,
      organizationId: orgId,
      entityDefinitionId: defId,
      archivedAt: options?.archived ? new Date() : null,
      updatedAt: new Date(),
    } as typeof schema.EntityInstance.$inferInsert)
    return id
  }

  const findById = (value: string) =>
    createFindExistingRecord({
      db: db as never,
      organizationId,
      resource: {
        id: 'part',
        type: 'custom',
        entityDefinitionId: partDefId,
      } as unknown as Resource,
      identifierFields: [RECORD_ID_FIELD],
    })({ id: value })

  beforeEach(async () => {
    db = getTestDb()
    const org = await createTestOrganization()
    organizationId = org.id
    const other = await createTestOrganization()
    otherOrganizationId = other.id
    partDefId = await seedDef(organizationId, 'part')
    contactDefId = await seedDef(organizationId, 'contact')
  })

  // Before the fix this returned null for EVERY value: `resolveField` keys
  // the field map by CustomField.id and the seeder excludes `id`, so no
  // FieldValue query was ever issued.
  it('matches an EntityInstance by its id', async () => {
    const id = await seedInstance(organizationId, partDefId)
    await expect(findById(id)).resolves.toEqual({ kind: 'one', recordId: id })
  })

  it('tolerates a prefixed record id', async () => {
    const id = await seedInstance(organizationId, partDefId)
    await expect(findById(`part:${id}`)).resolves.toEqual({ kind: 'one', recordId: id })
  })

  // SAFETY PROPERTY 1: another entity definition in the SAME org.
  it('does NOT match an instance of another entity definition', async () => {
    const id = await seedInstance(organizationId, contactDefId)
    await expect(findById(id)).resolves.toEqual({ kind: 'none' })
  })

  // SAFETY PROPERTY 2: the same def slug in ANOTHER tenant.
  it('does NOT match an instance in another organization', async () => {
    const otherDefId = await seedDef(otherOrganizationId, 'part')
    const id = await seedInstance(otherOrganizationId, otherDefId)
    await expect(findById(id)).resolves.toEqual({ kind: 'none' })
  })

  // Mirrors `excludeArchived: true` on the FieldValue lane: an import must never
  // resolve to a merged-away record.
  it('never resolves an archived instance', async () => {
    const id = await seedInstance(organizationId, partDefId, { archived: true })
    await expect(findById(id)).resolves.toEqual({ kind: 'none' })
  })
})
