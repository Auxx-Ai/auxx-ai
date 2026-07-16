// packages/lib/src/jobs/email/types.ts

import { z } from 'zod'

export const emailTypeSchema = z.enum([
  'verification',
  'email-change-verification',
  'reset-password',
  'password-reset-notify',
  'invite',
  'join-organization',
  'approval-request',
  'approval-reminder',
  'getting-started',
  'mid-trial',
  'trial-conversion',
  'trial-deletion-warning',
  'trial-deletion-final',
  'welcome',
  'billing',
  'system',
  'subscription-welcome',
  'trial-started',
  'trial-ending',
  'trial-expired',
  'subscription-cancelled',
  'payment-failed',
  'developer-invite',
  'visit-dispatched',
  'visit-rescheduled',
  'visit-canceled',
  'visit-reassigned',
  'visit-daily-digest',
  'payment-receipt',
])

export type EmailType = z.infer<typeof emailTypeSchema>

export type EmailRecipient = {
  email: string
  name?: string
}

type WithRecipient<T> = T & { recipient: EmailRecipient }

/**
 * White-label sender identity + brand block for customer-facing, org-branded emails
 * (plans/dispatch/money/15-payment-receipt-emails.md). Composed into any email payload that
 * should read as the business rather than Auxx. The From ADDRESS always stays the verified
 * `SYSTEM_FROM_EMAIL` — only the display name (`fromName`) and `replyTo` carry the business.
 */
export type EmailBrandIdentity = {
  /** From display name (business name, fallback org name). */
  fromName: string
  /** Reply-To (business email, fallback `EMAIL_REPLY_TO`). */
  replyTo?: string
  businessName: string
  businessAddressLines: string[]
  businessPhone?: string
  businessWebsite?: string
  /** Absolute, publicly-fetchable logo URL (org `documents.logo`); omitted → name-only header. */
  logoUrl?: string
  /** Brand accent color (hex) for the CTA button. */
  accentColor?: string
}

export type EmailPayloadByType = {
  verification: WithRecipient<{ verificationLink: string }>
  'email-change-verification': WithRecipient<{
    newEmail: string
    verificationLink: string
    supportEmail?: string
  }>
  'reset-password': WithRecipient<{ resetLink: string }>
  // biome-ignore lint/complexity/noBannedTypes: no additional fields needed
  'password-reset-notify': WithRecipient<{}>
  invite: WithRecipient<{
    inviterName: string
    organizationName: string
    acceptLink: string
    role: string
  }>
  'join-organization': WithRecipient<{
    inviterName: string
    organizationName: string
    acceptLink: string
    role: string
    invitedUserName?: string
  }>
  'approval-request': WithRecipient<{
    workflowName: string
    message?: string
    approvalUrl: string
    expiresAt: Date
  }>
  'approval-reminder': WithRecipient<{
    workflowName: string
    message?: string
    approvalUrl: string
    reminderNumber: number
    timeRemaining: string
    expiresAt: Date
  }>
  'getting-started': WithRecipient<{
    organizationName: string
    dashboardUrl: string
    integrationsUrl: string
    knowledgeBaseUrl: string
    shopifyUrl: string
  }>
  'mid-trial': WithRecipient<{
    organizationName: string
    daysRemaining: number
    dashboardUrl: string
    integrationsUrl: string
    upgradeUrl: string
    supportUrl: string
  }>
  'trial-conversion': WithRecipient<{
    trialEndDate: string
    totalTicketsResolved?: number
    totalTimeSaved?: number
    recommendedPlan?: string
    monthlyPrice?: number
    billingUrl: string
    daysBeforeEnd: number
  }>
  'trial-deletion-warning': WithRecipient<{
    organizationName: string
    daysUntilDeletion: number
    reactivationLink: string
  }>
  'trial-deletion-final': WithRecipient<{
    organizationName: string
    hoursUntilDeletion: number
    reactivationLink: string
  }>
  welcome: WithRecipient<{ loginLink?: string }>
  billing: WithRecipient<{
    invoiceNumber: string
    amount: string
    dueDate: string
    invoiceUrl?: string
  }>
  system: WithRecipient<{ subject: string; message: string }>
  'subscription-welcome': WithRecipient<{
    planName: string
    billingCycle: 'monthly' | 'annual'
    dashboardUrl?: string
  }>
  'trial-started': WithRecipient<{ planName: string; trialDays: number; dashboardUrl?: string }>
  'trial-ending': WithRecipient<{ planName: string; daysRemaining: number; upgradeUrl?: string }>
  'trial-expired': WithRecipient<{ planName: string; upgradeUrl?: string }>
  'subscription-cancelled': WithRecipient<{
    planName: string
    endDate: string
    reactivateUrl?: string
  }>
  'payment-failed': WithRecipient<{
    planName: string
    amount: string
    nextRetryDate?: string
    billingPortalUrl?: string
  }>
  'developer-invite': WithRecipient<{
    inviterName: string
    accountName: string
    acceptLink: string
    role: string
  }>
  /** Dispatch (notify) action — 07-m2-build.md §B.5. Separate rail from the in-app notification. */
  'visit-dispatched': WithRecipient<{
    workOrderNumber: string
    workOrderTitle: string
    startTime: string
    endTime: string
    timezone: string
    workOrderUrl: string
  }>
  /** Worker-facing reschedule notice (plans/dispatch/19-client-notifications.md §4.9) — system
   * SES rail, internal only (never customer mail). */
  'visit-rescheduled': WithRecipient<{
    workOrderNumber: string
    workOrderTitle: string
    oldStartTime: string
    oldEndTime: string
    newStartTime: string
    newEndTime: string
    timezone: string
    workOrderUrl: string
    address?: string
  }>
  /** Worker-facing cancel notice (plans/dispatch/19-client-notifications.md §4.9). */
  'visit-canceled': WithRecipient<{
    workOrderNumber: string
    workOrderTitle: string
    startTime: string
    endTime: string
    timezone: string
  }>
  /** Worker-facing reassignment notice (plans/dispatch/19-client-notifications.md §4.9) — one
   * job type, `variant` picks 'removed' (old assignee) vs 'assigned' (new assignee). */
  'visit-reassigned': WithRecipient<{
    variant: 'removed' | 'assigned'
    workOrderNumber: string
    workOrderTitle: string
    startTime: string
    endTime: string
    timezone: string
    workOrderUrl: string
  }>
  /** Opt-in daily schedule digest (plans/dispatch/19-client-notifications.md §4.9). */
  'visit-daily-digest': WithRecipient<{
    dateLabel: string
    timezone: string
    visits: Array<{
      workOrderNumber: string
      workOrderTitle: string
      startTime: string
      endTime: string
      address?: string
    }>
    scheduleUrl: string
  }>
  /**
   * Customer-facing, org-branded payment receipt (plans/dispatch/money/15-payment-receipt-emails.md)
   * — fired on Stripe settlement for a quote deposit (`context: 'deposit'`) or an invoice payment
   * (`context: 'invoice'`). White-label: the identity/brand block below makes it read as the
   * business (From display name + Reply-To + logo/footer), while the From address stays the
   * Auxx-verified SES domain. All amounts are integer cents.
   */
  'payment-receipt': WithRecipient<
    EmailBrandIdentity & {
      context: 'deposit' | 'invoice'
      documentNumber: string
      amountPaid: number
      currency: string
      remainingBalance: number
      /** ISO timestamp or `yyyy-mm-dd`. */
      paymentDate: string
      method?: string
      /** Absolute public link back to the quote-view / pay page. */
      viewUrl: string
    }
  >
}

export type SendEmailJobData<T extends EmailType = EmailType> = {
  emailType: T
  payload: EmailPayloadByType[T]
  meta?: {
    organizationId?: string
    actorUserId?: string
    source?: string
    requestId?: string
    idempotencyKey?: string
  }
}
