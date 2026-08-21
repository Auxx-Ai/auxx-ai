// packages/lib/src/resources/hooks/__tests__/contact-hooks.test.ts

import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BadRequestError, UniqueValueConflictError } from '../../../errors'
import { CONTACT_HOOKS } from '../contact-hooks'
import type { SystemHookContext } from '../types'

vi.mock('../../../custom-fields', () => ({
  checkUniqueValue: vi.fn(),
}))

const { checkUniqueValue } = await import('../../../custom-fields')
const checkUniqueValueMock = vi.mocked(checkUniqueValue)

const FIELD_ID = 'field-email-1'

function buildContext(
  value: unknown,
  overrides: Partial<SystemHookContext> = {}
): SystemHookContext {
  return {
    operation: 'update',
    entityDef: { id: 'def-contact', entityType: 'contact' },
    field: { id: FIELD_ID, type: 'EMAIL', systemAttribute: 'primary_email' },
    values: { [FIELD_ID]: value },
    existingInstance: undefined,
    organizationId: 'org-1',
    userId: 'user-1',
    allFields: [],
    ...overrides,
  } as unknown as SystemHookContext
}

/** Run the three primary_email hooks in registration order, chaining values. */
async function runEmailHooks(ctx: SystemHookContext): Promise<Record<string, unknown>> {
  let values = ctx.values
  for (const hook of CONTACT_HOOKS.primary_email!) {
    values = await hook({ ...ctx, values })
  }
  return values
}

beforeEach(() => {
  checkUniqueValueMock.mockReset()
  checkUniqueValueMock.mockResolvedValue(ok(null))
})

describe('primary_email hooks — array writes', () => {
  it('validates and lowercases every value of an array write', async () => {
    const result = await runEmailHooks(buildContext(['  Alice@Example.COM ', 'BOB@x.io']))
    expect(result[FIELD_ID]).toEqual(['alice@example.com', 'bob@x.io'])
  })

  it('rejects an array containing one invalid email', async () => {
    await expect(
      runEmailHooks(buildContext(['valid@example.com', 'not-an-email']))
    ).rejects.toThrow(BadRequestError)
  })

  it('collapses in-record case-variant duplicates (first occurrence wins)', async () => {
    const result = await runEmailHooks(buildContext(['A@x.com', 'a@X.COM', 'b@x.com', 'B@X.com ']))
    expect(result[FIELD_ID]).toEqual(['a@x.com', 'b@x.com'])
  })

  it('checks uniqueness once per surviving value with excludeEntityId = self', async () => {
    await runEmailHooks(
      buildContext(['a@x.com', 'b@x.com'], {
        existingInstance: { id: 'inst-self' } as never,
      })
    )
    expect(checkUniqueValueMock).toHaveBeenCalledTimes(2)
    expect(checkUniqueValueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fieldId: FIELD_ID,
        value: 'a@x.com',
        organizationId: 'org-1',
        excludeEntityId: 'inst-self',
      })
    )
    expect(checkUniqueValueMock).toHaveBeenCalledWith(
      expect.objectContaining({ value: 'b@x.com', excludeEntityId: 'inst-self' })
    )
  })

  it('throws UniqueValueConflictError carrying the offending value and existing record', async () => {
    checkUniqueValueMock.mockImplementation(async (input) =>
      input.value === 'claimed@x.com'
        ? err({
            code: 'UNIQUE_VIOLATION',
            message: 'A record with this value already exists',
            fieldId: FIELD_ID,
            existingEntityId: 'inst-other',
            existingDisplayName: 'Jane Roe',
          })
        : ok(null)
    )

    const promise = runEmailHooks(buildContext(['fresh@x.com', 'Claimed@X.com']))
    await expect(promise).rejects.toThrow(UniqueValueConflictError)
    await promise.catch((e: UniqueValueConflictError) => {
      expect(e.conflictingValue).toBe('claimed@x.com')
      expect(e.fieldId).toBe(FIELD_ID)
      expect(e.existingEntityId).toBe('inst-other')
      expect(e.message).toContain('Jane Roe')
      expect(e.message).toContain('claimed@x.com')
    })
  })
})

describe('primary_email hooks — scalar writes (existing behavior)', () => {
  it('lowercases and trims a scalar value', async () => {
    const result = await runEmailHooks(buildContext(' Carol@Example.com '))
    expect(result[FIELD_ID]).toBe('carol@example.com')
  })

  it('rejects an invalid scalar email', async () => {
    await expect(runEmailHooks(buildContext('nope'))).rejects.toThrow(BadRequestError)
  })

  it('passes through null / undefined without querying uniqueness', async () => {
    const result = await runEmailHooks(buildContext(null))
    expect(result[FIELD_ID]).toBeNull()
    expect(checkUniqueValueMock).not.toHaveBeenCalled()
  })

  it('rejects a scalar email claimed by another contact', async () => {
    checkUniqueValueMock.mockResolvedValue(
      err({
        code: 'UNIQUE_VIOLATION',
        message: 'A record with this value already exists',
        fieldId: FIELD_ID,
        existingEntityId: 'inst-other',
        existingDisplayName: null,
      })
    )
    await expect(runEmailHooks(buildContext('claimed@x.com'))).rejects.toThrow(
      UniqueValueConflictError
    )
  })
})
