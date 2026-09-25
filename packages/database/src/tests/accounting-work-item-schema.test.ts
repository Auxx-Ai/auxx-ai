// packages/database/src/tests/accounting-work-item-schema.test.ts
//
// Structural guard: the stage CHECK and `ACCOUNTING_WORK_STAGES` are two copies of one
// list, and only the CHECK is enforced. A stage added to the array but not the CHECK
// throws on the first insert in production (111 Q21 added `price`).

import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { ACCOUNTING_WORK_STAGES, AccountingWorkItem } from '../db/schema/accounting-work-item'

describe('AccountingWorkItem', () => {
  it('pins the stage list, price included', () => {
    expect([...ACCOUNTING_WORK_STAGES]).toEqual([
      'evidence',
      'money',
      'post',
      'issue',
      'relieve',
      'price',
    ])
  })

  it('names every stage in the CHECK, and no other', () => {
    const check = getTableConfig(AccountingWorkItem).checks.find(
      (c) => c.name === 'AccountingWorkItem_stage_check'
    )
    expect(check).toBeDefined()
    const rendered = new PgDialect().sqlToQuery(check!.value).sql
    const listed = /"stage" IN \(([^)]*)\)/.exec(rendered)?.[1]
    expect(listed).toBeTruthy()
    const stages = listed!.split(',').map((s) => s.trim().replace(/^'|'$/g, ''))
    expect(stages).toEqual([...ACCOUNTING_WORK_STAGES])
  })
})
