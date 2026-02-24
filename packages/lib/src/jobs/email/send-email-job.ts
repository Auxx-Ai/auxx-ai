// packages/lib/src/jobs/email/send-email-job.ts

import {
  sendApprovalReminderEmail,
  sendApprovalRequestEmail,
  sendBillingEmail,
  sendEmailChangeVerificationEmail,
  sendGettingStartedEmail,
  sendInviteEmail,
  sendJoinOrganizationEmail,
  sendMidTrialEmail,
  sendPasswordResetNotifyEmail,
  sendPaymentFailedEmail,
  sendResetPasswordEmail,
  sendSubscriptionCancelledEmail,
  sendSubscriptionWelcomeEmail,
  sendSystemEmail,
  sendTrialConversionEmail,
  sendTrialDeletionFinalEmail,
  sendTrialDeletionWarningEmail,
  sendTrialEndingEmail,
  sendTrialExpiredEmail,
  sendTrialStartedEmail,
  sendVerificationEmail,
  sendWelcomeEmail,
} from '@auxx/email'
import { createScopedLogger } from '@auxx/logger'
import type { JobContext } from '../types/job-context'
import type { EmailType, SendEmailJobData } from './types'

const logger = createScopedLogger('job:send-email')

const handlers: {
  [K in EmailType]: (payload: SendEmailJobData<K>['payload']) => Promise<boolean>
} = {
  verification: (p) =>
    sendVerificationEmail({
      email: p.recipient.email,
      name: p.recipient.name || 'User',
      verificationLink: p.verificationLink,
    }),
  'email-change-verification': (p) =>
    sendEmailChangeVerificationEmail({
      email: p.recipient.email,
      name: p.recipient.name || 'User',
      newEmail: p.newEmail,
      verificationLink: p.verificationLink,
      supportEmail: p.supportEmail,
    }),
  'reset-password': (p) =>
    sendResetPasswordEmail({
      email: p.recipient.email,
      name: p.recipient.name || 'User',
      resetLink: p.resetLink,
    }),
  'password-reset-notify': (p) =>
    sendPasswordResetNotifyEmail({
      email: p.recipient.email,
      name: p.recipient.name,
    }),
  invite: (p) =>
    sendInviteEmail({
      email: p.recipient.email,
      inviterName: p.inviterName,
      organizationName: p.organizationName,
      acceptLink: p.acceptLink,
      role: p.role,
    }),
  'join-organization': (p) =>
    sendJoinOrganizationEmail({
      email: p.recipient.email,
      inviterName: p.inviterName,
      organizationName: p.organizationName,
      acceptLink: p.acceptLink,
      role: p.role,
      invitedUserName: p.invitedUserName,
    }),
  'approval-request': (p) =>
    sendApprovalRequestEmail({
      email: p.recipient.email,
      toName: p.recipient.name || 'User',
      workflowName: p.workflowName,
      message: p.message,
      approvalUrl: p.approvalUrl,
      expiresAt: p.expiresAt,
    }),
  'approval-reminder': (p) =>
    sendApprovalReminderEmail({
      email: p.recipient.email,
      toName: p.recipient.name || 'User',
      workflowName: p.workflowName,
      message: p.message,
      approvalUrl: p.approvalUrl,
      reminderNumber: p.reminderNumber,
      timeRemaining: p.timeRemaining,
      expiresAt: p.expiresAt,
    }),
  'getting-started': (p) =>
    sendGettingStartedEmail({
      email: p.recipient.email,
      name: p.recipient.name || 'there',
      organizationName: p.organizationName,
      dashboardUrl: p.dashboardUrl,
      integrationsUrl: p.integrationsUrl,
      knowledgeBaseUrl: p.knowledgeBaseUrl,
      shopifyUrl: p.shopifyUrl,
    }),
  'mid-trial': (p) =>
    sendMidTrialEmail({
      email: p.recipient.email,
      name: p.recipient.name || 'there',
      organizationName: p.organizationName,
      daysRemaining: p.daysRemaining,
      dashboardUrl: p.dashboardUrl,
      integrationsUrl: p.integrationsUrl,
      upgradeUrl: p.upgradeUrl,
      supportUrl: p.supportUrl,
    }),
  'trial-conversion': (p) =>
    sendTrialConversionEmail({
      email: p.recipient.email,
      name: p.recipient.name || 'there',
      trialEndDate: p.trialEndDate,
      totalTicketsResolved: p.totalTicketsResolved,
      totalTimeSaved: p.totalTimeSaved,
      recommendedPlan: p.recommendedPlan,
      monthlyPrice: p.monthlyPrice,
      billingUrl: p.billingUrl,
      daysBeforeEnd: p.daysBeforeEnd,
    }),
  'trial-deletion-warning': (p) =>
    sendTrialDeletionWarningEmail({
      email: p.recipient.email,
      organizationName: p.organizationName,
      daysUntilDeletion: p.daysUntilDeletion,
      reactivationLink: p.reactivationLink,
    }),
  'trial-deletion-final': (p) =>
    sendTrialDeletionFinalEmail({
      email: p.recipient.email,
      organizationName: p.organizationName,
      hoursUntilDeletion: p.hoursUntilDeletion,
      reactivationLink: p.reactivationLink,
    }),
  welcome: (p) =>
    sendWelcomeEmail({
      email: p.recipient.email,
      name: p.recipient.name || 'User',
      loginLink: p.loginLink,
    }),
  billing: (p) =>
    sendBillingEmail({
      email: p.recipient.email,
      name: p.recipient.name || 'User',
      invoiceNumber: p.invoiceNumber,
      amount: p.amount,
      dueDate: p.dueDate,
      invoiceUrl: p.invoiceUrl,
    }),
  system: (p) =>
    sendSystemEmail({
      email: p.recipient.email,
      name: p.recipient.name || 'User',
      subject: p.subject,
      message: p.message,
    }),
  'subscription-welcome': (p) =>
    sendSubscriptionWelcomeEmail({
      email: p.recipient.email,
      name: p.recipient.name || 'User',
      planName: p.planName,
      billingCycle: p.billingCycle,
      dashboardUrl: p.dashboardUrl,
    }),
  'trial-started': (p) =>
    sendTrialStartedEmail({
      email: p.recipient.email,
      name: p.recipient.name || 'User',
      planName: p.planName,
      trialDays: p.trialDays,
      dashboardUrl: p.dashboardUrl,
    }),
  'trial-ending': (p) =>
    sendTrialEndingEmail({
      email: p.recipient.email,
      name: p.recipient.name || 'User',
      planName: p.planName,
      daysRemaining: p.daysRemaining,
      upgradeUrl: p.upgradeUrl,
    }),
  'trial-expired': (p) =>
    sendTrialExpiredEmail({
      email: p.recipient.email,
      name: p.recipient.name || 'User',
      planName: p.planName,
      upgradeUrl: p.upgradeUrl,
    }),
  'subscription-cancelled': (p) =>
    sendSubscriptionCancelledEmail({
      email: p.recipient.email,
      name: p.recipient.name || 'User',
      planName: p.planName,
      endDate: p.endDate,
      reactivateUrl: p.reactivateUrl,
    }),
  'payment-failed': (p) =>
    sendPaymentFailedEmail({
      email: p.recipient.email,
      name: p.recipient.name || 'User',
      planName: p.planName,
      amount: p.amount,
      nextRetryDate: p.nextRetryDate,
      billingPortalUrl: p.billingPortalUrl,
    }),
}

export async function sendEmailJob(ctx: JobContext<SendEmailJobData>) {
  const { emailType, payload, meta } = ctx.data

  logger.info('Processing email job', {
    emailType,
    recipient: payload.recipient.email,
    source: meta?.source,
    jobId: ctx.jobId,
  })

  const handler = handlers[emailType]
  if (!handler) {
    throw new Error(`Unknown email type: ${emailType}`)
  }

  await handler(payload as never)

  return { success: true, emailType, recipient: payload.recipient.email }
}
