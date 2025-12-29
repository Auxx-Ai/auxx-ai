// packages/billing/src/utils/error-codes.ts
/**
 * Error codes and handling for billing operations.
 */

export enum ErrorCode {
  PLAN_NOT_FOUND = 'PLAN_NOT_FOUND',
  SUBSCRIPTION_NOT_FOUND = 'SUBSCRIPTION_NOT_FOUND',
  ALREADY_SUBSCRIBED = 'ALREADY_SUBSCRIBED',
  SUBSCRIPTION_NOT_ACTIVE = 'SUBSCRIPTION_NOT_ACTIVE',
  NOT_SCHEDULED_FOR_CANCELLATION = 'NOT_SCHEDULED_FOR_CANCELLATION',
  NO_CUSTOMER_FOUND = 'NO_CUSTOMER_FOUND',
  PRICE_NOT_CONFIGURED = 'PRICE_NOT_CONFIGURED',
  STRIPE_ERROR = 'STRIPE_ERROR',
}

export const ErrorMessages: Record<ErrorCode, string> = {
  [ErrorCode.PLAN_NOT_FOUND]: 'Subscription plan not found',
  [ErrorCode.SUBSCRIPTION_NOT_FOUND]: 'Subscription not found',
  [ErrorCode.ALREADY_SUBSCRIBED]: 'Already subscribed to this plan',
  [ErrorCode.SUBSCRIPTION_NOT_ACTIVE]: 'Subscription is not active',
  [ErrorCode.NOT_SCHEDULED_FOR_CANCELLATION]:
    'Subscription is not scheduled for cancellation',
  [ErrorCode.NO_CUSTOMER_FOUND]: 'No Stripe customer found for this organization',
  [ErrorCode.PRICE_NOT_CONFIGURED]: 'Price not configured for this plan',
  [ErrorCode.STRIPE_ERROR]: 'Stripe API error',
}

export class BillingError extends Error {
  constructor(
    public code: ErrorCode,
    message?: string
  ) {
    super(message ?? ErrorMessages[code])
    this.name = 'BillingError'
  }
}
