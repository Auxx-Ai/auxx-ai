// packages/lib/src/import/__tests__/execute-batch.test.ts

import { describe, expect, it, vi } from 'vitest'
import { UniqueValueConflictError } from '../../errors'
import {
  type BatchRecord,
  type BatchRecordData,
  type ExecuteBatchContext,
  executeBatch,
} from '../execution/execute-batch'
import { stripBlankMultiValues } from '../execution/execute-strategy'

function ctx(overrides: Partial<ExecuteBatchContext>): ExecuteBatchContext {
  return {
    organizationId: 'org-1',
    userId: 'user-1',
    entityDefinitionId: 'def-1',
    strategy: 'update',
    createRecord: vi.fn(async () => ({ id: 'new-1' })),
    updateRecord: vi.fn(async (id: string) => ({ id })),
    ...overrides,
  }
}

function record(overrides: Partial<BatchRecord>): BatchRecord {
  return {
    rowIndex: 0,
    planRowId: 'row-1',
    data: { standardFields: {}, customFields: {} },
    ...overrides,
  }
}

const conflict = (value: string, existingEntityId?: string) =>
  new UniqueValueConflictError({
    message: `Email already exists: ${value}`,
    conflictingValue: value,
    existingEntityId,
  })

describe('executeBatch — uniqueness conflict recovery', () => {
  it('drops the conflicting value on an update row, retries, and imports with a warning', async () => {
    const updateRecord = vi
      .fn()
      .mockRejectedValueOnce(conflict('taken@x.com'))
      .mockResolvedValue({ id: 'rec-1' })

    const result = await executeBatch(
      [
        record({
          existingRecordId: 'rec-1',
          data: {
            standardFields: { primary_email: ['new@x.com', 'taken@x.com'] },
            customFields: {},
            modes: { primary_email: 'add' },
          },
        }),
      ],
      ctx({ strategy: 'update', updateRecord })
    )

    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.results[0]?.warning).toContain('taken@x.com')
    // Retry carried only the surviving value
    const retryData = updateRecord.mock.calls[1]?.[1]
    expect(retryData.standardFields.primary_email).toEqual(['new@x.com'])
  })

  it('degrades a create to update-by-append when the IDENTIFIER value is already owned', async () => {
    const createRecord = vi.fn().mockRejectedValue(conflict('dup@x.com', 'existing-7'))
    const updateRecord = vi.fn(async (id: string) => ({ id }))

    const result = await executeBatch(
      [
        record({
          data: {
            standardFields: { primary_email: ['dup@x.com'], first_name: 'Ada' },
            customFields: {},
            modes: { primary_email: 'add' },
          },
        }),
      ],
      ctx({
        strategy: 'create',
        identifierKeys: ['primary_email'],
        createRecord,
        updateRecord,
      })
    )

    expect(result.succeeded).toBe(1)
    expect(updateRecord).toHaveBeenCalledWith('existing-7', expect.anything())
    expect(result.results[0]?.instanceId).toBe('existing-7')
    expect(result.results[0]?.warning).toContain('dup@x.com')
  })

  it('handles the same NEW email on two rows in one file: row 1 creates, row 2 appends', async () => {
    const owned = new Map<string, string>()
    const createRecord = vi.fn(async (data: BatchRecordData) => {
      const emails = data.standardFields.primary_email as string[]
      for (const email of emails) {
        const owner = owned.get(email.toLowerCase())
        if (owner) throw conflict(email, owner)
      }
      const id = `rec-${createRecord.mock.calls.length}`
      for (const email of emails) owned.set(email.toLowerCase(), id)
      return { id }
    })
    const updateRecord = vi.fn(async (id: string) => ({ id }))

    const result = await executeBatch(
      [
        record({
          rowIndex: 0,
          data: {
            standardFields: { primary_email: ['same@x.com'] },
            customFields: {},
            modes: { primary_email: 'add' },
          },
        }),
        record({
          rowIndex: 1,
          planRowId: 'row-2',
          data: {
            standardFields: { primary_email: ['same@x.com'] },
            customFields: {},
            modes: { primary_email: 'add' },
          },
        }),
      ],
      ctx({ strategy: 'create', identifierKeys: ['primary_email'], createRecord, updateRecord })
    )

    expect(result.succeeded).toBe(2)
    expect(result.failed).toBe(0)
    // Row 2 degraded to an append on row 1's record
    expect(updateRecord).toHaveBeenCalledTimes(1)
    expect(result.results[1]?.instanceId).toBe(result.results[0]?.instanceId)
    expect(result.results[1]?.warning).toBeDefined()
  })

  it('drops a NON-identifier conflicting value on a create instead of degrading', async () => {
    const createRecord = vi
      .fn()
      .mockRejectedValueOnce(conflict('taken@x.com', 'someone-else'))
      .mockResolvedValue({ id: 'new-1' })

    const result = await executeBatch(
      [
        record({
          data: {
            standardFields: { primary_email: ['taken@x.com'], external_id: 'E-1' },
            customFields: {},
            modes: { primary_email: 'add' },
          },
        }),
      ],
      // identifier is external_id, not the email field
      ctx({ strategy: 'create', identifierKeys: ['external_id'], createRecord })
    )

    expect(result.succeeded).toBe(1)
    expect(createRecord).toHaveBeenCalledTimes(2)
    const retryData = createRecord.mock.calls[1]?.[0]
    expect(retryData.standardFields.primary_email).toBeUndefined()
    expect(result.results[0]?.warning).toContain('taken@x.com')
  })

  it('fails the row when the conflicting value is not in the payload (no infinite retry)', async () => {
    const updateRecord = vi.fn().mockRejectedValue(conflict('phantom@x.com'))

    const result = await executeBatch(
      [
        record({
          existingRecordId: 'rec-1',
          data: { standardFields: { primary_email: ['real@x.com'] }, customFields: {} },
        }),
      ],
      ctx({ strategy: 'update', updateRecord })
    )

    expect(result.failed).toBe(1)
    expect(updateRecord).toHaveBeenCalledTimes(1)
  })
})

describe('stripBlankMultiValues — blank cell on update is a NO-WRITE for multi fields', () => {
  const modes = { primary_email: 'add' } as const

  it('removes null / empty-string / empty-array values on add-mode keys', () => {
    expect(stripBlankMultiValues({ primary_email: null, first_name: 'Ada' }, modes)).toEqual({
      first_name: 'Ada',
    })
    expect(stripBlankMultiValues({ primary_email: '' }, modes)).toEqual({})
    expect(stripBlankMultiValues({ primary_email: [] }, modes)).toEqual({})
  })

  it('keeps real values on add-mode keys and blanks on set-mode keys', () => {
    expect(stripBlankMultiValues({ primary_email: ['a@x.com'] }, modes)).toEqual({
      primary_email: ['a@x.com'],
    })
    // single-value fields keep today's semantics (null clears)
    expect(stripBlankMultiValues({ first_name: null }, modes)).toEqual({ first_name: null })
  })
})
