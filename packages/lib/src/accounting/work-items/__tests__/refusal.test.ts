// packages/lib/src/accounting/work-items/__tests__/refusal.test.ts

import { describe, expect, it } from 'vitest'
import { NotFoundError, UnprocessableEntityError } from '../../../errors'
import { refusalFromError, refusalFromPost, withWorkItemCode } from '../refusal'

describe('refusalFromError', () => {
  it("reads the thrower's own code first", () => {
    const error = new UnprocessableEntityError(
      'Shipment totals are not stamped yet',
      withWorkItemCode('TOTALS_NOT_STAMPED')
    )
    expect(refusalFromError(error)).toEqual({ reasonCode: 'TOTALS_NOT_STAMPED' })
  })

  it("carries the thrower's wake keys and message beside its code", () => {
    const error = new UnprocessableEntityError(
      'Receipt gateway handle "paypal" is not mapped',
      withWorkItemCode('GATEWAY_UNMAPPED', { externalRef: 'paypal', railId: null })
    )
    expect(refusalFromError(error)).toEqual({
      reasonCode: 'GATEWAY_UNMAPPED',
      externalRef: 'paypal',
    })
    const keyed = new UnprocessableEntityError(
      'x',
      withWorkItemCode('ROLE_UNMAPPED', { role: 'clearing', railId: 'pg_1', message: 'why' })
    )
    expect(refusalFromError(keyed)).toEqual({
      reasonCode: 'ROLE_UNMAPPED',
      role: 'clearing',
      railId: 'pg_1',
      detail: { message: 'why' },
    })
  })

  it("carries the thrower's structured detail beside its message", () => {
    const error = new UnprocessableEntityError(
      'x',
      withWorkItemCode('MEMO_INPUT_INCOMPLETE', {
        message: 'why',
        detail: { moneyPending: true, pendingRelations: [{ recordId: 'cm_1' }] },
      })
    )
    expect(refusalFromError(error)).toEqual({
      reasonCode: 'MEMO_INPUT_INCOMPLETE',
      detail: { moneyPending: true, pendingRelations: [{ recordId: 'cm_1' }], message: 'why' },
    })
  })

  it("takes the resolver's unresolved roles as the wake key", () => {
    const error = new UnprocessableEntityError('Cannot post: 2 posting role(s) ...', {
      unresolvedRoles: ['clearing', 'bank'],
      unresolvedReasons: ['a', 'b'],
    })
    expect(refusalFromError(error, { railId: 'pg_1' })).toEqual({
      reasonCode: 'ROLE_UNMAPPED',
      role: 'clearing',
      railId: 'pg_1',
      detail: { roles: ['clearing', 'bank'] },
    })
  })

  it('maps a missing record to SOURCE_NOT_FOUND and anything else to REFUSED with its words', () => {
    expect(refusalFromError(new NotFoundError('gone')).reasonCode).toBe('SOURCE_NOT_FOUND')
    expect(refusalFromError(new UnprocessableEntityError('no applications'))).toEqual({
      reasonCode: 'REFUSED',
      detail: { message: 'no applications' },
    })
  })
})

describe('refusalFromPost', () => {
  it('turns every ledger refusal into its code with the entry keys', () => {
    expect(refusalFromPost({ status: 'unbalanced' }).reasonCode).toBe('UNBALANCED')
    expect(refusalFromPost({ status: 'error', error: 'db down' })).toEqual({
      reasonCode: 'TRANSIENT_ERROR',
      detail: { message: 'db down' },
    })
    expect(
      refusalFromPost(
        {
          status: 'account_unmapped',
          items: [
            { key: 'unmapped_role', label: 'clearing', remedy: 'x', ref: 'clearing' },
            { key: 'unmapped_role', label: 'bank', remedy: 'y', ref: 'bank' },
          ],
        },
        { railId: 'pg_1' }
      )
    ).toEqual({
      reasonCode: 'ROLE_UNMAPPED',
      role: 'clearing',
      railId: 'pg_1',
      detail: { roles: ['clearing', 'bank'] },
    })
  })
})
