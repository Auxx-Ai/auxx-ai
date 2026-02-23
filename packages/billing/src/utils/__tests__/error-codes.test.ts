// packages/billing/src/utils/__tests__/error-codes.test.ts

import { describe, expect, it } from 'vitest'
import { BillingError, ErrorCode, ErrorMessages } from '../error-codes'

describe('BillingError', () => {
  it('constructs with correct code and default message from ErrorMessages', () => {
    const error = new BillingError(ErrorCode.PLAN_NOT_FOUND)
    expect(error.code).toBe(ErrorCode.PLAN_NOT_FOUND)
    expect(error.message).toBe(ErrorMessages[ErrorCode.PLAN_NOT_FOUND])
  })

  it('constructs with custom message override', () => {
    const error = new BillingError(ErrorCode.STRIPE_ERROR, 'Custom stripe failure')
    expect(error.code).toBe(ErrorCode.STRIPE_ERROR)
    expect(error.message).toBe('Custom stripe failure')
  })

  it('has name set to BillingError', () => {
    const error = new BillingError(ErrorCode.NO_CUSTOMER_FOUND)
    expect(error.name).toBe('BillingError')
  })

  it('is an instance of Error', () => {
    const error = new BillingError(ErrorCode.SUBSCRIPTION_NOT_FOUND)
    expect(error).toBeInstanceOf(Error)
  })
})

describe('ErrorCode / ErrorMessages', () => {
  it('all ErrorCode values have corresponding ErrorMessages entry', () => {
    for (const code of Object.values(ErrorCode)) {
      expect(ErrorMessages[code]).toBeDefined()
      expect(typeof ErrorMessages[code]).toBe('string')
    }
  })
})
