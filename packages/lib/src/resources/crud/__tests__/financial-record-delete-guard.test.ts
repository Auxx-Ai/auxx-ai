// packages/lib/src/resources/crud/__tests__/financial-record-delete-guard.test.ts
//
// `assertFinancialRecordCanDelete` resolves its subject's entity type from a
// `RecordId`, and a RecordId carries whichever form its caller held: the def
// CUID (`<cuid>:<instanceId>`) or the slug (`payout:<instanceId>`). The guard
// used to look the definition up by `id` ONLY, so the slug form missed, the type
// came back null, and the function RETURNED CLEAN — financial history deleted
// with no `ConflictError`.
//
// Every case below asserts the THROW, never merely "did not crash": the bug was
// a silent early return, so a test that only checks the call completes passes on
// the bug.
//
// @auxx/database is globally mocked in src/test/setup.ts, so `schema.X` is an
// empty object and the `where` clauses are unassertable. The fake db therefore
// ignores its arguments and is driven by what each test hands it.

import { describe, expect, it, vi } from 'vitest'
import { ConflictError } from '../../../errors'
import { assertFinancialRecordCanDelete } from '../financial-record-binding'

const ORG = 'org_1'
const DEF_CUID = 'cm4payoutdefcuid000000'
const INSTANCE = 'inst_payout_1'

/**
 * A db that answers the two reads the guard makes.
 *
 * @param definition - what `EntityDefinition.findFirst` resolves to. `undefined`
 *   is the interesting case: the slug-form lookup that used to miss.
 * @param observations - rows `FinancialSourceObservation` returns. Non-empty
 *   means this record has durable history and the delete must be refused.
 */
function fakeDb(definition: { entityType: string } | undefined, observations: { id: string }[]) {
  const findFirst = vi.fn(async () => definition)
  const limit = vi.fn(async () => observations)
  return {
    db: {
      query: { EntityDefinition: { findFirst } },
      select: () => ({ from: () => ({ where: () => ({ limit }) }) }),
    } as never,
    findFirst,
    limit,
  }
}

describe('assertFinancialRecordCanDelete', () => {
  it('refuses a slug-form RecordId whose definition row does not resolve', async () => {
    // The regression. `payout:<instanceId>` against an `id`-only lookup found no
    // def, so `financialRecordType(undefined)` was null and the guard fell open.
    const { db, limit } = fakeDb(undefined, [{ id: 'obs_1' }])

    await expect(assertFinancialRecordCanDelete(db, ORG, `payout:${INSTANCE}`)).rejects.toThrow(
      ConflictError
    )
    // The observation query must actually have run — a guard that throws for the
    // wrong reason is no better than one that does not throw.
    expect(limit).toHaveBeenCalled()
  })

  it('refuses a slug-form processor_balance_entry the same way', async () => {
    const { db } = fakeDb(undefined, [{ id: 'obs_2' }])

    await expect(
      assertFinancialRecordCanDelete(db, ORG, `processor_balance_entry:${INSTANCE}`)
    ).rejects.toThrow(
      'Financial history cannot be archived or deleted; record a correction instead'
    )
  })

  it('still refuses the def-CUID form, which resolves through the definition row', async () => {
    const { db, findFirst } = fakeDb({ entityType: 'payout' }, [{ id: 'obs_3' }])

    await expect(
      assertFinancialRecordCanDelete(db, ORG, `${DEF_CUID}:${INSTANCE}`)
    ).rejects.toThrow(ConflictError)
    expect(findFirst).toHaveBeenCalled()
  })

  it('permits a financial record that carries no observations yet', async () => {
    // Nothing has ever been reported against it, so there is no history to hide.
    const { db } = fakeDb({ entityType: 'payout' }, [])

    await expect(
      assertFinancialRecordCanDelete(db, ORG, `${DEF_CUID}:${INSTANCE}`)
    ).resolves.toBeUndefined()
  })

  it('permits a non-financial record without reaching the observation query', async () => {
    const { db, limit } = fakeDb({ entityType: 'contact' }, [{ id: 'obs_4' }])

    await expect(
      assertFinancialRecordCanDelete(db, ORG, `${DEF_CUID}:inst_contact_1`)
    ).resolves.toBeUndefined()
    expect(limit).not.toHaveBeenCalled()
  })

  it('permits an unrecognised slug rather than refusing every delete', async () => {
    // The fallback classifies the parsed prefix directly, so it must stay as
    // narrow as `financialRecordType`: only `payout` and
    // `processor_balance_entry`, never "any slug we could not resolve".
    const { db, limit } = fakeDb(undefined, [{ id: 'obs_5' }])

    await expect(
      assertFinancialRecordCanDelete(db, ORG, `some_custom_entity:${INSTANCE}`)
    ).resolves.toBeUndefined()
    expect(limit).not.toHaveBeenCalled()
  })
})
