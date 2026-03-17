// packages/types/billing/status.ts

/** Subscription statuses the app considers unusable — user is blocked from the app. */
export const BLOCKED_SUBSCRIPTION_STATUSES = [
  'canceled',
  'unpaid',
  'past_due',
  'incomplete_expired',
] as const
export type BlockedSubscriptionStatus = (typeof BLOCKED_SUBSCRIPTION_STATUSES)[number]

export function isUsableSubscriptionStatus(status: string): boolean {
  return !BLOCKED_SUBSCRIPTION_STATUSES.includes(status.toLowerCase() as BlockedSubscriptionStatus)
}
