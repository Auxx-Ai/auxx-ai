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
])

export type EmailType = z.infer<typeof emailTypeSchema>

export type EmailRecipient = {
  email: string
  name?: string
}

type WithRecipient<T> = T & { recipient: EmailRecipient }

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
