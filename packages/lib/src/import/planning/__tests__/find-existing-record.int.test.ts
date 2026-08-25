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

/**
 * The composite key that `vendor_part` actually has: `(part, contact)`, TWO
 * RELATION legs and not one scalar among them.
 *
 * This is the shape the declared natural key rests on, and it is the one the
 * composite tests above never covered — they run on a system table where every
 * leg is a plain column. A relation leg is stored in `FieldValue.relatedEntityId`
 * and reaches the lookup core through `createTypedValueInput`, which accepts a
 * relationship value ONLY as a prefixed `defId:instanceId` RecordId. A bare
 * instance id parses to `entityInstanceId: ''`, the candidate is refused, and
 * AND-mode returns an empty result — a silent "no match" that classifies the row
 * `create` and writes the duplicate the natural key exists to prevent.
 *
 * Both accepted spellings are pinned, so the normalization can never quietly
 * regress to accepting only one of them.
 */
describe('createFindExistingRecord, composite RELATION key on an entity-backed resource', () => {
  let organizationId: string
  let vendorPartDefId: string
  let partDefId: string
  let companyDefId: string
  let partFieldId: string
  let contactFieldId: string
  let db: ReturnType<typeof getTestDb>

  const seedDef = async (slug: string): Promise<string> => {
    const id = generateId()
    await db.insert(schema.EntityDefinition).values({
      id,
      organizationId,
      apiSlug: slug,
      singular: slug,
      plural: `${slug}s`,
      updatedAt: new Date(),
    } as typeof schema.EntityDefinition.$inferInsert)
    return id
  }

  const seedRelationField = async (name: string, targetDefId: string): Promise<string> => {
    const id = generateId()
    await db.insert(schema.CustomField).values({
      id,
      organizationId,
      entityDefinitionId: vendorPartDefId,
      name,
      type: 'RELATIONSHIP',
      modelType: 'vendor_part',
      relatedEntityDefinitionId: targetDefId,
      updatedAt: new Date(),
    } as typeof schema.CustomField.$inferInsert)
    return id
  }

  const seedInstance = async (defId: string): Promise<string> => {
    const id = generateId()
    await db.insert(schema.EntityInstance).values({
      id,
      organizationId,
      entityDefinitionId: defId,
      updatedAt: new Date(),
    } as typeof schema.EntityInstance.$inferInsert)
    return id
  }

  /** One vendor_part linked to `partId` and `companyId`. */
  const seedVendorPart = async (partId: string, companyId: string): Promise<string> => {
    const instanceId = await seedInstance(vendorPartDefId)
    for (const [fieldId, relatedId, relatedDefId] of [
      [partFieldId, partId, partDefId],
      [contactFieldId, companyId, companyDefId],
    ] as const) {
      await db.insert(schema.FieldValue).values({
        id: generateId(),
        organizationId,
        fieldId,
        entityId: instanceId,
        entityDefinitionId: vendorPartDefId,
        relatedEntityId: relatedId,
        relatedEntityDefinitionId: relatedDefId,
        updatedAt: new Date(),
      } as typeof schema.FieldValue.$inferInsert)
    }
    return instanceId
  }

  /**
   * `relationship.inverseResourceFieldId` is `targetDefId:inverseFieldId`, and its
   * FIRST half is the only way the identifier lane can learn what a relation leg
   * points at. Omit it and `toLookupValue` throws rather than quietly no-matching.
   */
  const relationField = (id: string, key: string, targetDefId: string): ResourceField =>
    ({
      id,
      key,
      type: BaseType.RELATION,
      relationship: {
        inverseResourceFieldId: `${targetDefId}:${generateId()}`,
        relationshipType: 'has_many',
        isInverse: false,
      },
    }) as unknown as ResourceField

  const findPair = (partValue: string, contactValue: string) =>
    createFindExistingRecord({
      db: db as never,
      organizationId,
      resource: {
        id: 'vendor_part',
        type: 'custom',
        entityDefinitionId: vendorPartDefId,
      } as unknown as Resource,
      identifierFields: [
        relationField(partFieldId, 'part', partDefId),
        relationField(contactFieldId, 'contact', companyDefId),
      ],
    })({ part: partValue, contact: contactValue })

  beforeEach(async () => {
    db = getTestDb()
    const org = await createTestOrganization()
    organizationId = org.id
    vendorPartDefId = await seedDef('vendor-part')
    partDefId = await seedDef('part')
    companyDefId = await seedDef('company')
    partFieldId = await seedRelationField('Part', partDefId)
    contactFieldId = await seedRelationField('Supplier', companyDefId)
  })

  // THE REGRESSION. `resolve-relation-lookups` resolves a supplier cell to a BARE
  // instance id, and that is what the identifier tuple carries. Before the fix
  // this returned `{ kind: 'none' }` for a pair that plainly exists.
  it('matches a (part, supplier) pair given BARE instance ids', async () => {
    const partId = await seedInstance(partDefId)
    const companyId = await seedInstance(companyDefId)
    const vendorPartId = await seedVendorPart(partId, companyId)

    await expect(findPair(partId, companyId)).resolves.toEqual({
      kind: 'one',
      recordId: vendorPartId,
    })
  })

  it('matches the same pair given PREFIXED record ids', async () => {
    const partId = await seedInstance(partDefId)
    const companyId = await seedInstance(companyDefId)
    const vendorPartId = await seedVendorPart(partId, companyId)

    await expect(
      findPair(`${partDefId}:${partId}`, `${companyDefId}:${companyId}`)
    ).resolves.toEqual({ kind: 'one', recordId: vendorPartId })
  })

  // The property that makes it a composite key rather than a widened one. A
  // supplier's whole price list shares one `contact` leg, so matching on that
  // alone would update an arbitrary line of it.
  it('does NOT match a vendor_part that satisfies only one leg', async () => {
    const partId = await seedInstance(partDefId)
    const otherPartId = await seedInstance(partDefId)
    const companyId = await seedInstance(companyDefId)
    const otherCompanyId = await seedInstance(companyDefId)
    await seedVendorPart(partId, companyId)

    await expect(findPair(partId, otherCompanyId)).resolves.toEqual({ kind: 'none' })
    await expect(findPair(otherPartId, companyId)).resolves.toEqual({ kind: 'none' })
  })

  // Two price-list lines for the same part from the same supplier is the state a
  // natural key is supposed to make impossible; if it already exists, the import
  // must say so rather than pick one.
  it('reports ambiguity when two rows share the pair', async () => {
    const partId = await seedInstance(partDefId)
    const companyId = await seedInstance(companyDefId)
    await seedVendorPart(partId, companyId)
    await seedVendorPart(partId, companyId)

    await expect(findPair(partId, companyId)).resolves.toEqual({ kind: 'ambiguous', count: 2 })
  })

  it('never partially matches when a leg is blank', async () => {
    const partId = await seedInstance(partDefId)
    const companyId = await seedInstance(companyDefId)
    await seedVendorPart(partId, companyId)

    await expect(findPair(partId, '')).resolves.toEqual({ kind: 'none' })
  })

  // A relation leg whose target cannot be resolved is a STRUCTURAL failure, and
  // `analyzeRow` turns a throw into a row error. Answering `none` would classify
  // the row `create` and write the duplicate silently — the same fail-open the
  // lookup-core rethrow above exists to prevent.
  it('throws rather than answering "no match" when a leg has no resolvable target', async () => {
    const partId = await seedInstance(partDefId)
    const companyId = await seedInstance(companyDefId)
    await seedVendorPart(partId, companyId)

    const brokenLeg = { id: partFieldId, key: 'part', type: BaseType.RELATION } as ResourceField
    const find = createFindExistingRecord({
      db: db as never,
      organizationId,
      resource: {
        id: 'vendor_part',
        type: 'custom',
        entityDefinitionId: vendorPartDefId,
      } as unknown as Resource,
      identifierFields: [brokenLeg],
    })

    await expect(find({ part: partId })).rejects.toThrow(/no resolvable target/)
  })
})
