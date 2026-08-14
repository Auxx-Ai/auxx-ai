// packages/lib/src/resources/registry/output-shape.test.ts
// §10b step 4: pins `toOutputShape`'s merged-shape contract in isolation —
// see `../../workflow-engine/parity/find.resolvability.test.ts` for the
// end-to-end proof against a real FindProcessor run.

import { describe, expect, it } from 'vitest'
import { BaseType } from '../types'
import type { ResourceField } from './field-types'
import { toOutputShape } from './output-shape'

const capabilities = {
  filterable: true,
  sortable: true,
  creatable: false,
  updatable: false,
  configurable: false,
}

function field(overrides: Partial<ResourceField>): ResourceField {
  return {
    id: 'f' as ResourceField['id'],
    key: 'f',
    label: 'F',
    type: BaseType.STRING,
    capabilities,
    ...overrides,
  }
}

describe('toOutputShape', () => {
  it('aliases a field whose output key differs from its dbColumn', () => {
    const statusField = field({
      key: 'status',
      systemAttribute: 'thread_status' as ResourceField['systemAttribute'],
      dbColumn: 'status',
    })
    const row = { id: 't1', status: 'OPEN' }

    expect(toOutputShape(row, [statusField])).toEqual({
      id: 't1',
      status: 'OPEN',
      thread_status: 'OPEN',
    })
  })

  it('preserves the raw camelCase key alongside the alias (merged, not replaced)', () => {
    const assigneeField = field({
      key: 'assignee',
      systemAttribute: 'assignee_id' as ResourceField['systemAttribute'],
      dbColumn: 'assigneeId',
    })
    const row = { assigneeId: 'usr_1' }

    const shaped = toOutputShape(row, [assigneeField])
    // Raw column keeps working (back-compat for hand-typed `{{…}}` refs)...
    expect(shaped.assigneeId).toBe('usr_1')
    // ...and the declared systemAttribute path starts working too.
    expect(shaped.assignee_id).toBe('usr_1')
  })

  it('skips RELATION-type fields even when they have a dbColumn', () => {
    const inboxField = field({
      key: 'inbox',
      type: BaseType.RELATION,
      systemAttribute: 'inbox_id' as ResourceField['systemAttribute'],
      dbColumn: 'inboxId',
    })
    const row = { inboxId: 'inbox_1' }

    const shaped = toOutputShape(row, [inboxField])
    expect(shaped).toEqual({ inboxId: 'inbox_1' })
    expect(shaped).not.toHaveProperty('inbox_id')
  })

  it('skips fields with no dbColumn (FieldValue-backed / virtual query fields)', () => {
    const virtualField = field({
      key: 'from',
      systemAttribute: 'from' as ResourceField['systemAttribute'],
      dbColumn: undefined,
    })
    const row = { subject: 'hello' }

    expect(toOutputShape(row, [virtualField])).toEqual({ subject: 'hello' })
  })

  it('does not clobber the row when the output key already equals the column name', () => {
    const idField = field({
      key: 'id',
      systemAttribute: 'id' as ResourceField['systemAttribute'],
      dbColumn: 'id',
    })
    const row = { id: 't1' }

    // A spy-free way to prove no clobber: the merged object is deep-equal to
    // the original, i.e. no `aliases.id` overwrite occurred (harmless here
    // since the values are identical, but the point is the alias is never
    // even computed for an identity mapping).
    expect(toOutputShape(row, [idField])).toEqual({ id: 't1' })
  })

  it('skips a field whose dbColumn is absent from the row entirely', () => {
    const missingColumnField = field({
      key: 'closedAt',
      systemAttribute: 'closed_at' as ResourceField['systemAttribute'],
      dbColumn: 'closedAt',
    })
    const row = { id: 't1' } // no `closedAt` key selected on this row

    const shaped = toOutputShape(row, [missingColumnField])
    expect(shaped).toEqual({ id: 't1' })
    expect(shaped).not.toHaveProperty('closed_at')
  })

  it('merges multiple field aliases at once and returns a NEW object (non-mutating)', () => {
    const fields = [
      field({
        key: 'status',
        systemAttribute: 'thread_status' as ResourceField['systemAttribute'],
        dbColumn: 'status',
      }),
      field({
        key: 'messageCount',
        systemAttribute: 'message_count' as ResourceField['systemAttribute'],
        dbColumn: 'messageCount',
      }),
    ]
    const row = { id: 't1', status: 'OPEN', messageCount: 3 }

    const shaped = toOutputShape(row, fields)
    expect(shaped).toEqual({
      id: 't1',
      status: 'OPEN',
      messageCount: 3,
      thread_status: 'OPEN',
      message_count: 3,
    })
    expect(shaped).not.toBe(row)
  })

  it('returns the row untouched (still a merge) when fields is empty', () => {
    const row = { id: 't1', status: 'OPEN' }
    expect(toOutputShape(row, [])).toEqual(row)
  })
})
