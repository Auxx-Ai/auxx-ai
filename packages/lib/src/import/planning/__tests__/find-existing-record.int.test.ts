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
      identifierField: EMAIL_IDENTIFIER_FIELD,
    })(value)

  it('matches an exact email', async () => {
    const id = await seed('john.smith@acme.test')
    await expect(find('john.smith@acme.test')).resolves.toBe(id)
  })

  it('matches case-insensitively', async () => {
    const id = await seed('john.smith@acme.test')
    await expect(find('John.Smith@ACME.test')).resolves.toBe(id)
  })

  // THE REGRESSION. Under `ilike(column, rawValue)` this resolved to the seeded row,
  // and the import would have overwritten that unrelated participant.
  it('does NOT treat `_` in the CSV cell as a single-character wildcard', async () => {
    await seed('johnXsmith@acme.test')
    await expect(find('john_smith@acme.test')).resolves.toBeNull()
  })

  it('does NOT treat `%` in the CSV cell as a wildcard', async () => {
    await seed('anything-at-all@acme.test')
    await expect(find('%@acme.test')).resolves.toBeNull()
  })

  it('still finds a literal underscore address that genuinely exists', async () => {
    const id = await seed('john_smith@acme.test')
    await expect(find('john_smith@acme.test')).resolves.toBe(id)
  })

  it('is organization-scoped', async () => {
    const other = await createTestOrganization()
    await seed('shared@acme.test', other.id)
    await expect(find('shared@acme.test')).resolves.toBeNull()
  })
})
