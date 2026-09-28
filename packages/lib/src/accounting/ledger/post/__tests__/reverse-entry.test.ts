// packages/lib/src/accounting/ledger/post/__tests__/reverse-entry.test.ts

import type { Database } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import { UnprocessableEntityError } from '../../../../errors'
import { reverseEntry } from '../reverse-entry'

function throwingDb(error: unknown): Database {
  return {
    transaction: async () => {
      throw error
    },
  } as unknown as Database
}

describe('reverseEntry failure class', () => {
  const options = { organizationId: 'org-1', glPostingId: 'posting-1' } as never

  it('classifies an AuxxError as data', async () => {
    const result = await reverseEntry(
      throwingDb(new UnprocessableEntityError('Account is inactive')),
      options
    )
    expect(result).toMatchObject({ status: 'error', failureClass: 'data' })
  })

  it('classifies any other throw as transport', async () => {
    const result = await reverseEntry(throwingDb(new Error('connection reset')), options)
    expect(result).toMatchObject({ status: 'error', failureClass: 'transport' })
  })
})
