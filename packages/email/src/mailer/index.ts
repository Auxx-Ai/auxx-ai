import { configService } from '@auxx/credentials'
import { createScopedLogger } from '@auxx/logger'
import { render } from '@react-email/components'
import {
  ApprovalReminderEmail,
  ApprovalReminderText,
  ApprovalRequestEmail,
  ApprovalRequestText,
  BillingEmail,
  BillingText,
  DeveloperInviteEmail,
  DeveloperInviteText,
  EmailChangeVerificationEmail,
  EmailChangeVerificationText,
  GettingStartedEmail,
  GettingStartedText,
  InviteEmail,
  InviteText,
  JoinOrganizationEmail,
  JoinOrganizationText,
  MidTrialEmail,
  MidTrialText,
  PasswordResetNotifyEmail,
  PasswordResetNotifyText,
  PaymentFailedEmail,
  PaymentFailedText,
  PaymentReceiptEmail,
  type PaymentReceiptEmailProps,
  PaymentReceiptText,
  ResetPasswordEmail,
  ResetPasswordText,
  SubscriptionCancelledEmail,
  SubscriptionCancelledText,
  SubscriptionWelcomeEmail,
  SubscriptionWelcomeText,
  SystemEmail,
  SystemText,
  TrialConversionEmail,
  TrialConversionText,
  TrialDeletionFinalEmail,
  TrialDeletionFinalText,
  TrialDeletionWarningEmail,
  TrialDeletionWarningText,
  TrialEndingEmail,
  TrialEndingText,
  TrialExpiredEmail,
  TrialExpiredText,
  TrialStartedEmail,
  TrialStartedText,
  TwoFactorOtpEmail,
  TwoFactorOtpText,
  VerificationEmail,
  VerificationText,
  VisitCanceledEmail,
  VisitCanceledText,
  VisitDailyDigestEmail,
  type VisitDailyDigestItem,
  VisitDailyDigestText,
  VisitDispatchedEmail,
  VisitDispatchedText,
  VisitReassignedEmail,
  VisitReassignedText,
  type VisitReassignedVariant,
  VisitRescheduledEmail,
  VisitRescheduledText,
  WelcomeEmail,
  WelcomeText,
} from '../templates'
import type { EmailOptions, UserEmail } from '../types'
import { NodemailerService } from './nodemailer-service'

export { NodemailerService } from './nodemailer-service'

const logger = createScopedLogger('system-mail')

function formatSubject(subject: string) {
  return `Auxx.ai - ${subject}`
}

interface SendEmailDataProps {
  to: string
  /** From display name override (e.g. the business name for white-label receipts). The From
   * ADDRESS always stays the verified `SYSTEM_FROM_EMAIL` — only the friendly name changes. */
  fromName?: string
  /** Reply-To override (e.g. the business's own email). Falls back to `EMAIL_REPLY_TO`. */
  replyTo?: string
  subject: string
  text?: string
  html: string
  attachments?: Array<{ filename: string; data: Buffer; contentType: string }>
}

export const sendEmail = async (options: SendEmailDataProps): Promise<boolean> => {
  const emailService = NodemailerService.getInstance()

  // Get configuration from environment variables

  const fromEmail = configService.get<string>('SYSTEM_FROM_EMAIL') || 'noreply@example.com'
  const domain = fromEmail.split('@')[1] || 'example.com'

  const replyToEmail =
    options.replyTo ||
    configService.get<string>('EMAIL_REPLY_TO') ||
    configService.get<string>('SUPPORT_EMAIL')
  const supportName = configService.get<string>('SUPPORT_NAME') || 'Support Team'

  try {
    // Set up the from address with a friendly name
    const from = `${options.fromName || supportName} <${fromEmail}>`

    // Convert attachments to provider format if needed
    const attachments = options.attachments?.map((att) => ({
      filename: att.filename,
      content: att.data,
      contentType: att.contentType,
    }))

    // Build email options for provider
    const emailOptions: Omit<EmailOptions, 'from'> & { from?: string } = {
      from,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
      attachments,
      replyTo: replyToEmail,
      trackingEnabled: false,
    }

    logger.info('Attempting to send email via NodemailerService', {
      to: options.to,
      subject: options.subject,
      hasText: !!options.text,
      hasHtml: !!options.html,
      from: emailOptions.from,
    })

    const result = await emailService.sendEmail(emailOptions)

    if (!result.success) {
      logger.error('Failed to send system email:', {
        error: result.error,
        subject: options.subject,
      })
      throw new Error(result.error || 'Failed to send email')
    }

    // Unreachable unless `success` — the guard above throws — so this is always
    // `true`. Returned as the boolean the signature (and all 29 wrappers) declare,
    // rather than leaking the `EmailResult` object callers cannot see through it.
    return result.success
  } catch (error) {
    logger.error('Error sending system email:', { error })
    throw error
  }
}

export const sendVerificationEmail = async ({
  email,
  name,
  verificationLink,
}: {
  name: string
  email: UserEmail
  verificationLink: string
}): Promise<boolean> => {
  try {
    const html = await render(await VerificationEmail({ name, verificationLink }))
    const text = VerificationText({ name, verificationLink })

    return await sendEmail({
      to: email,
      subject: formatSubject('Please verify your email address'),
      html,
      text,
    })
  } catch (error) {
    logger.error('Error in sendVerificationEmail', { error })
    throw error
  }
}

export const sendEmailChangeVerificationEmail = async ({
  email,
  name,
  newEmail,
  verificationLink,
  supportEmail,
}: {
  email: UserEmail
  name: string
  newEmail: string
  verificationLink: string
  supportEmail?: string
}): Promise<boolean> => {
  try {
    const html = await render(
      await EmailChangeVerificationEmail({ name, newEmail, verificationLink, supportEmail })
    )
    const text = EmailChangeVerificationText({ name, newEmail, verificationLink, supportEmail })

    return await sendEmail({
      to: email,
      subject: formatSubject('Confirm your email address change'),
      html,
      text,
    })
  } catch (error) {
    logger.error('Error in sendEmailChangeVerificationEmail', { error })
    throw error
  }
}

export const sendResetPasswordEmail = async ({
  email,
  name,
  resetLink,
}: {
  email: UserEmail
  name: string
  resetLink: string
}): Promise<boolean> => {
  try {
    const html = await render(await ResetPasswordEmail({ name, resetLink }))
    const text = ResetPasswordText({ name, resetLink })

    return await sendEmail({
      to: email,
      subject: formatSubject('Password Reset Request'),
      html,
      text,
    })
  } catch (error) {
    logger.error('Error in sendResetPasswordEmail', { error })
    throw error
  }
}

export const sendPasswordResetNotifyEmail = async ({
  email,
  name,
}: {
  email: UserEmail
  name?: string
}): Promise<boolean> => {
  try {
    const html = await render(await PasswordResetNotifyEmail({ name }))
    const text = PasswordResetNotifyText({ name })

    return await sendEmail({
      to: email,
      subject: formatSubject('Password Changed Successfully'),
      html,
      text,
    })
  } catch (error) {
    logger.error('Error in sendPasswordResetNotifyEmail', { error })
    throw error
  }
}

export const sendTwoFactorOtpEmail = async ({
  email,
  name,
  otp,
}: {
  email: UserEmail
  name?: string
  otp: string
}): Promise<boolean> => {
  try {
    const html = await render(await TwoFactorOtpEmail({ name, otp }))
    const text = TwoFactorOtpText({ name, otp })

    return await sendEmail({
      to: email,
      subject: formatSubject('Your verification code'),
      html,
      text,
    })
  } catch (error) {
    logger.error('Error in sendTwoFactorOtpEmail', { error })
    throw error
  }
}

export const sendWelcomeEmail = async ({
  email,
  name,
  loginLink,
}: {
  email: UserEmail
  name: string
  loginLink?: string
}): Promise<boolean> => {
  try {
    const html = await render(await WelcomeEmail({ name, loginLink }))
    const text = WelcomeText({ name, loginLink })

    return await sendEmail({
      to: email,
      subject: formatSubject('Welcome to Auxx.ai!'),
      html,
      text,
    })
  } catch (error) {
    logger.error('Error in sendWelcomeEmail', { error })
    throw error
  }
}

export const sendBillingEmail = async ({
  email,
  name,
  invoiceNumber,
  amount,
  dueDate,
  invoiceUrl,
}: {
  email: UserEmail
  name: string
  invoiceNumber: string
  amount: string
  dueDate: string
  invoiceUrl?: string
}): Promise<boolean> => {
  try {
    const html = await render(
      await BillingEmail({ name, invoiceNumber, amount, dueDate, invoiceUrl })
    )
    const text = BillingText({ name, invoiceNumber, amount, dueDate, invoiceUrl })

    return await sendEmail({
      to: email,
      subject: formatSubject(`Invoice #${invoiceNumber} - Payment Due`),
      html,
      text,
    })
  } catch (error) {
    logger.error('Error in sendBillingEmail', { error })
    throw error
  }
}

export const sendSystemEmail = async ({
  email,
  name,
  subject,
  message,
}: {
  email: UserEmail
  name: string
  subject: string
  message: string
}): Promise<boolean> => {
  try {
    const html = await render(await SystemEmail({ name, subject, message }))
    const text = SystemText({ name, subject, message })

    return await sendEmail({
      to: email,
      subject: formatSubject(subject),
      html,
      text,
    })
  } catch (error) {
    logger.error('Error in sendSystemEmail', { error })
    throw error
  }
}

export const sendDeveloperInviteEmail = async ({
  email,
  inviterName,
  accountName,
  acceptLink,
  role,
}: {
  email: UserEmail
  inviterName: string
  accountName: string
  acceptLink: string
  role: string
}): Promise<boolean> => {
  try {
    const html = await render(
      await DeveloperInviteEmail({ inviterName, accountName, acceptLink, role })
    )
    const text = DeveloperInviteText({ inviterName, accountName, acceptLink, role })

    return await sendEmail({
      to: email,
      subject: formatSubject(`You've been invited to join ${accountName}`),
      html,
      text,
    })
  } catch (error) {
    logger.error('Error in sendDeveloperInviteEmail', { error })
    throw error
  }
}

/** Dispatch (notify) action email — 07-m2-build.md §B.5, the `sendBillingEmail` shape. */
export const sendVisitDispatchedEmail = async ({
  email,
  name,
  workOrderNumber,
  workOrderTitle,
  startTime,
  endTime,
  timezone,
  workOrderUrl,
}: {
  email: UserEmail
  name: string
  workOrderNumber: string
  workOrderTitle: string
  startTime: string
  endTime: string
  timezone: string
  workOrderUrl: string
}): Promise<boolean> => {
  try {
    const html = await render(
      await VisitDispatchedEmail({
        name,
        workOrderNumber,
        workOrderTitle,
        startTime,
        endTime,
        timezone,
        workOrderUrl,
      })
    )
    const text = VisitDispatchedText({
      name,
      workOrderNumber,
      workOrderTitle,
      startTime,
      endTime,
      timezone,
      workOrderUrl,
    })

    return await sendEmail({
      to: email,
      subject: formatSubject(
        `You've been dispatched${workOrderNumber ? ` — ${workOrderNumber}` : ''}`
      ),
      html,
      text,
    })
  } catch (error) {
    logger.error('Error in sendVisitDispatchedEmail', { error })
    throw error
  }
}

/** Worker-facing reschedule notice (plans/dispatch/19-client-notifications.md §4.9) — the
 * `sendVisitDispatchedEmail` shape, old→new time. */
export const sendVisitRescheduledEmail = async ({
  email,
  name,
  workOrderNumber,
  workOrderTitle,
  oldStartTime,
  oldEndTime,
  newStartTime,
  newEndTime,
  timezone,
  workOrderUrl,
  address,
}: {
  email: UserEmail
  name: string
  workOrderNumber: string
  workOrderTitle: string
  oldStartTime: string
  oldEndTime: string
  newStartTime: string
  newEndTime: string
  timezone: string
  workOrderUrl: string
  address?: string
}): Promise<boolean> => {
  try {
    const html = await render(
      await VisitRescheduledEmail({
        name,
        workOrderNumber,
        workOrderTitle,
        oldStartTime,
        oldEndTime,
        newStartTime,
        newEndTime,
        timezone,
        workOrderUrl,
        address,
      })
    )
    const text = VisitRescheduledText({
      name,
      workOrderNumber,
      workOrderTitle,
      oldStartTime,
      oldEndTime,
      newStartTime,
      newEndTime,
      timezone,
      workOrderUrl,
      address,
    })

    return await sendEmail({
      to: email,
      subject: formatSubject(
        `Your visit was rescheduled${workOrderNumber ? ` — ${workOrderNumber}` : ''}`
      ),
      html,
      text,
    })
  } catch (error) {
    logger.error('Error in sendVisitRescheduledEmail', { error })
    throw error
  }
}

/** Worker-facing cancel notice (plans/dispatch/19-client-notifications.md §4.9). */
export const sendVisitCanceledEmail = async ({
  email,
  name,
  workOrderNumber,
  workOrderTitle,
  startTime,
  endTime,
  timezone,
}: {
  email: UserEmail
  name: string
  workOrderNumber: string
  workOrderTitle: string
  startTime: string
  endTime: string
  timezone: string
}): Promise<boolean> => {
  try {
    const html = await render(
      await VisitCanceledEmail({
        name,
        workOrderNumber,
        workOrderTitle,
        startTime,
        endTime,
        timezone,
      })
    )
    const text = VisitCanceledText({
      name,
      workOrderNumber,
      workOrderTitle,
      startTime,
      endTime,
      timezone,
    })

    return await sendEmail({
      to: email,
      subject: formatSubject(
        `Your visit was canceled${workOrderNumber ? ` — ${workOrderNumber}` : ''}`
      ),
      html,
      text,
    })
  } catch (error) {
    logger.error('Error in sendVisitCanceledEmail', { error })
    throw error
  }
}

/** Worker-facing reassignment notice (plans/dispatch/19-client-notifications.md §4.9) — one
 * template, two variants: 'removed' to the old assignee, 'assigned' to the new one. */
export const sendVisitReassignedEmail = async ({
  email,
  name,
  variant,
  workOrderNumber,
  workOrderTitle,
  startTime,
  endTime,
  timezone,
  workOrderUrl,
}: {
  email: UserEmail
  name: string
  variant: VisitReassignedVariant
  workOrderNumber: string
  workOrderTitle: string
  startTime: string
  endTime: string
  timezone: string
  workOrderUrl: string
}): Promise<boolean> => {
  try {
    const html = await render(
      await VisitReassignedEmail({
        name,
        variant,
        workOrderNumber,
        workOrderTitle,
        startTime,
        endTime,
        timezone,
        workOrderUrl,
      })
    )
    const text = VisitReassignedText({
      name,
      variant,
      workOrderNumber,
      workOrderTitle,
      startTime,
      endTime,
      timezone,
      workOrderUrl,
    })

    const subject =
      variant === 'removed'
        ? `You've been removed from a visit${workOrderNumber ? ` — ${workOrderNumber}` : ''}`
        : `You've been assigned a visit${workOrderNumber ? ` — ${workOrderNumber}` : ''}`

    return await sendEmail({ to: email, subject: formatSubject(subject), html, text })
  } catch (error) {
    logger.error('Error in sendVisitReassignedEmail', { error })
    throw error
  }
}

/** Opt-in daily schedule digest (plans/dispatch/19-client-notifications.md §4.9). */
export const sendVisitDailyDigestEmail = async ({
  email,
  name,
  dateLabel,
  timezone,
  visits,
  scheduleUrl,
}: {
  email: UserEmail
  name: string
  dateLabel: string
  timezone: string
  visits: VisitDailyDigestItem[]
  scheduleUrl: string
}): Promise<boolean> => {
  try {
    const html = await render(
      await VisitDailyDigestEmail({ name, dateLabel, timezone, visits, scheduleUrl })
    )
    const text = VisitDailyDigestText({ name, dateLabel, timezone, visits, scheduleUrl })

    return await sendEmail({
      to: email,
      subject: formatSubject(`Your schedule for ${dateLabel}`),
      html,
      text,
    })
  } catch (error) {
    logger.error('Error in sendVisitDailyDigestEmail', { error })
    throw error
  }
}

export const sendInviteEmail = async ({
  email,
  inviterName,
  organizationName,
  acceptLink,
  role,
}: {
  email: UserEmail
  inviterName: string
  organizationName: string
  acceptLink: string
  role: string
}): Promise<boolean> => {
  try {
    const html = await render(
      await InviteEmail({ inviterName, organizationName, acceptLink, role })
    )
    const text = InviteText({ inviterName, organizationName, acceptLink, role })

    return await sendEmail({
      to: email,
      subject: formatSubject(`You have been invited to join ${organizationName}`),
      html,
      text,
    })
  } catch (error) {
    logger.error('Error in sendInviteEmail', { error })
    throw error
  }
}

export const sendJoinOrganizationEmail = async ({
  email,
  inviterName,
  organizationName,
  acceptLink,
  role,
  invitedUserName,
}: {
  email: UserEmail
  inviterName: string
  organizationName: string
  acceptLink: string
  role: string
  invitedUserName?: string
}): Promise<boolean> => {
  try {
    const html = await render(
      await JoinOrganizationEmail({
        inviterName,
        organizationName,
        acceptLink,
        role,
        invitedUserName,
      })
    )
    const text = JoinOrganizationText({
      inviterName,
      organizationName,
      acceptLink,
      role,
      invitedUserName,
    })

    return await sendEmail({
      to: email,
      subject: formatSubject(`You have been invited to join ${organizationName}`),
      html,
      text,
    })
  } catch (error) {
    logger.error('Error in sendJoinOrganizationEmail', { error })
    throw error
  }
}

export const sendApprovalRequestEmail = async ({
  email,
  toName,
  workflowName,
  message,
  approvalUrl,
  expiresAt,
}: {
  email: UserEmail
  toName: string
  workflowName: string
  message?: string
  approvalUrl: string
  expiresAt: string
}): Promise<boolean> => {
  try {
    const html = await render(
      await ApprovalRequestEmail({ toName, workflowName, message, approvalUrl, expiresAt })
    )
    const text = ApprovalRequestText({ toName, workflowName, message, approvalUrl, expiresAt })

    return await sendEmail({
      to: email,
      subject: formatSubject(`Approval Required: ${workflowName}`),
      html,
      text,
    })
  } catch (error) {
    logger.error('Error in sendApprovalRequestEmail', { error })
    throw error
  }
}

export const sendApprovalReminderEmail = async ({
  email,
  toName,
  workflowName,
  message,
  approvalUrl,
  reminderNumber,
  timeRemaining,
  expiresAt,
}: {
  email: UserEmail
  toName: string
  workflowName: string
  message?: string
  approvalUrl: string
  reminderNumber: number
  timeRemaining: string
  expiresAt: string
}): Promise<boolean> => {
  try {
    const html = await render(
      await ApprovalReminderEmail({
        toName,
        workflowName,
        message,
        approvalUrl,
        reminderNumber,
        timeRemaining,
        expiresAt,
      })
    )
    const text = ApprovalReminderText({
      toName,
      workflowName,
      message,
      approvalUrl,
      reminderNumber,
      timeRemaining,
      expiresAt,
    })

    return await sendEmail({
      to: email,
      subject: formatSubject(`Reminder #${reminderNumber}: Approval Required - ${workflowName}`),
      html,
      text,
    })
  } catch (error) {
    logger.error('Error in sendApprovalReminderEmail', { error })
    throw error
  }
}

/** Send subscription welcome email after successful subscription */
export const sendSubscriptionWelcomeEmail = async ({
  email,
  name,
  planName,
  billingCycle,
  dashboardUrl,
}: {
  email: UserEmail
  name: string
  planName: string
  billingCycle: 'monthly' | 'annual'
  dashboardUrl?: string
}): Promise<boolean> => {
  try {
    // The templates key off `'ANNUAL'`, this signature (and the job payload) use
    // lowercase — so passing it through made `billingCycle === 'ANNUAL'` false for
    // every caller and told annual subscribers "Billing Cycle: Monthly", in both
    // the HTML and text versions. Latent today: nothing enqueues this email.
    const cycle = billingCycle === 'annual' ? 'ANNUAL' : 'MONTHLY'

    const html = await render(
      await SubscriptionWelcomeEmail({ name, planName, billingCycle: cycle, dashboardUrl })
    )
    const text = SubscriptionWelcomeText({ name, planName, billingCycle: cycle, dashboardUrl })

    return await sendEmail({
      to: email,
      subject: formatSubject(`Welcome to ${planName}!`),
      html,
      text,
    })
  } catch (error) {
    logger.error('Error in sendSubscriptionWelcomeEmail', { error })
    throw error
  }
}

/** Send trial started confirmation email */
export const sendTrialStartedEmail = async ({
  email,
  name,
  planName,
  trialDays,
  dashboardUrl,
}: {
  email: UserEmail
  name: string
  planName: string
  trialDays: number
  dashboardUrl?: string
}): Promise<boolean> => {
  try {
    const html = await render(await TrialStartedEmail({ name, planName, trialDays, dashboardUrl }))
    const text = TrialStartedText({ name, planName, trialDays, dashboardUrl })

    return await sendEmail({
      to: email,
      subject: formatSubject(`Your ${planName} Trial Has Started`),
      html,
      text,
    })
  } catch (error) {
    logger.error('Error in sendTrialStartedEmail', { error })
    throw error
  }
}

/** Send trial ending reminder email */
export const sendTrialEndingEmail = async ({
  email,
  name,
  planName,
  daysRemaining,
  upgradeUrl,
}: {
  email: UserEmail
  name: string
  planName: string
  daysRemaining: number
  upgradeUrl?: string
}): Promise<boolean> => {
  try {
    const html = await render(await TrialEndingEmail({ name, planName, daysRemaining, upgradeUrl }))
    const text = TrialEndingText({ name, planName, daysRemaining, upgradeUrl })

    return await sendEmail({
      to: email,
      subject: formatSubject(`Your ${planName} Trial Ends in ${daysRemaining} Days`),
      html,
      text,
    })
  } catch (error) {
    logger.error('Error in sendTrialEndingEmail', { error })
    throw error
  }
}

/** Send trial expired notification */
export const sendTrialExpiredEmail = async ({
  email,
  name,
  planName,
  upgradeUrl,
}: {
  email: UserEmail
  name: string
  planName: string
  upgradeUrl?: string
}): Promise<boolean> => {
  try {
    const html = await render(await TrialExpiredEmail({ name, planName, upgradeUrl }))
    const text = TrialExpiredText({ name, planName, upgradeUrl })

    return await sendEmail({
      to: email,
      subject: formatSubject(`Your ${planName} Trial Has Ended`),
      html,
      text,
    })
  } catch (error) {
    logger.error('Error in sendTrialExpiredEmail', { error })
    throw error
  }
}

/** Send subscription cancellation confirmation */
export const sendSubscriptionCancelledEmail = async ({
  email,
  name,
  planName,
  endDate,
  reactivateUrl,
}: {
  email: UserEmail
  name: string
  planName: string
  endDate: string
  reactivateUrl?: string
}): Promise<boolean> => {
  try {
    const html = await render(
      await SubscriptionCancelledEmail({ name, planName, endDate, reactivateUrl })
    )
    const text = SubscriptionCancelledText({ name, planName, endDate, reactivateUrl })

    return await sendEmail({
      to: email,
      subject: formatSubject(`Your ${planName} Subscription Has Been Cancelled`),
      html,
      text,
    })
  } catch (error) {
    logger.error('Error in sendSubscriptionCancelledEmail', { error })
    throw error
  }
}

/** Send payment failed notification */
export const sendPaymentFailedEmail = async ({
  email,
  name,
  planName,
  amount,
  nextRetryDate,
  billingPortalUrl,
}: {
  email: UserEmail
  name: string
  planName: string
  amount: string
  nextRetryDate?: string
  billingPortalUrl?: string
}): Promise<boolean> => {
  try {
    const html = await render(
      await PaymentFailedEmail({ name, planName, amount, nextRetryDate, billingPortalUrl })
    )
    const text = PaymentFailedText({ name, planName, amount, nextRetryDate, billingPortalUrl })

    return await sendEmail({
      to: email,
      subject: formatSubject(`Payment Failed for Your ${planName} Subscription`),
      html,
      text,
    })
  } catch (error) {
    logger.error('Error in sendPaymentFailedEmail', { error })
    throw error
  }
}

/** Send trial deletion warning email (7 days before deletion) */
export const sendTrialDeletionWarningEmail = async ({
  email,
  organizationName,
  daysUntilDeletion,
  reactivationLink,
}: {
  email: UserEmail
  organizationName: string
  daysUntilDeletion: number
  reactivationLink: string
}): Promise<boolean> => {
  try {
    const html = await render(
      await TrialDeletionWarningEmail({ organizationName, daysUntilDeletion, reactivationLink })
    )
    const text = TrialDeletionWarningText({ organizationName, daysUntilDeletion, reactivationLink })

    return await sendEmail({
      to: email,
      subject: formatSubject('Your trial has ended - Account scheduled for deletion'),
      html,
      text,
    })
  } catch (error) {
    logger.error('Error in sendTrialDeletionWarningEmail', { error })
    throw error
  }
}

/** Send final trial deletion notice (24 hours before deletion) */
export const sendTrialDeletionFinalEmail = async ({
  email,
  organizationName,
  hoursUntilDeletion,
  reactivationLink,
}: {
  email: UserEmail
  organizationName: string
  hoursUntilDeletion: number
  reactivationLink: string
}): Promise<boolean> => {
  try {
    const html = await render(
      await TrialDeletionFinalEmail({ organizationName, hoursUntilDeletion, reactivationLink })
    )
    const text = TrialDeletionFinalText({ organizationName, hoursUntilDeletion, reactivationLink })

    return await sendEmail({
      to: email,
      subject: formatSubject('URGENT: Your account will be deleted in 24 hours'),
      html,
      text,
    })
  } catch (error) {
    logger.error('Error in sendTrialDeletionFinalEmail', { error })
    throw error
  }
}

/** Send getting started email to new trial users */
export const sendGettingStartedEmail = async ({
  email,
  name,
  organizationName,
  dashboardUrl,
  integrationsUrl,
  knowledgeBaseUrl,
  shopifyUrl,
}: {
  email: UserEmail
  name: string
  organizationName: string
  dashboardUrl: string
  integrationsUrl: string
  knowledgeBaseUrl: string
  shopifyUrl: string
}): Promise<boolean> => {
  try {
    const html = await render(
      await GettingStartedEmail({
        name,
        organizationName,
        dashboardUrl,
        integrationsUrl,
        knowledgeBaseUrl,
        shopifyUrl,
      })
    )
    const text = GettingStartedText({
      name,
      organizationName,
      dashboardUrl,
      integrationsUrl,
      knowledgeBaseUrl,
      shopifyUrl,
    })

    return await sendEmail({
      to: email,
      subject: formatSubject("Welcome! Let's get you started"),
      html,
      text,
    })
  } catch (error) {
    logger.error('Error in sendGettingStartedEmail', { error })
    throw error
  }
}

/** Send mid-trial engagement email */
export const sendMidTrialEmail = async ({
  email,
  name,
  organizationName,
  daysRemaining,
  dashboardUrl,
  integrationsUrl,
  upgradeUrl,
  supportUrl,
}: {
  email: UserEmail
  name: string
  organizationName: string
  daysRemaining: number
  dashboardUrl: string
  integrationsUrl: string
  upgradeUrl: string
  supportUrl: string
}): Promise<boolean> => {
  try {
    const html = await render(
      await MidTrialEmail({
        name,
        organizationName,
        daysRemaining,
        dashboardUrl,
        integrationsUrl,
        upgradeUrl,
        supportUrl,
      })
    )
    const text = MidTrialText({
      name,
      organizationName,
      daysRemaining,
      dashboardUrl,
      integrationsUrl,
      upgradeUrl,
      supportUrl,
    })

    return await sendEmail({
      to: email,
      subject: formatSubject(`You have ${daysRemaining} days left in your trial`),
      html,
      text,
    })
  } catch (error) {
    logger.error('Error in sendMidTrialEmail', { error })
    throw error
  }
}

/** Send trial conversion email */
export const sendTrialConversionEmail = async ({
  email,
  name,
  trialEndDate,
  totalTicketsResolved,
  totalTimeSaved,
  recommendedPlan,
  monthlyPrice,
  billingUrl,
  daysBeforeEnd,
}: {
  email: UserEmail
  name: string
  trialEndDate: string
  totalTicketsResolved?: number
  totalTimeSaved?: number
  recommendedPlan?: string
  monthlyPrice?: number
  billingUrl: string
  daysBeforeEnd: number
}): Promise<boolean> => {
  try {
    const html = await render(
      await TrialConversionEmail({
        name,
        trialEndDate,
        totalTicketsResolved,
        totalTimeSaved,
        recommendedPlan,
        monthlyPrice,
        billingUrl,
      })
    )
    const text = TrialConversionText({
      name,
      trialEndDate,
      totalTicketsResolved,
      totalTimeSaved,
      recommendedPlan,
      monthlyPrice,
      billingUrl,
    })

    return await sendEmail({
      to: email,
      subject: formatSubject(`Your trial ends in ${daysBeforeEnd} days`),
      html,
      text,
    })
  } catch (error) {
    logger.error('Error in sendTrialConversionEmail', { error })
    throw error
  }
}

/**
 * Customer-facing, org-branded payment receipt (plans/dispatch/money/15-payment-receipt-emails.md).
 * Unlike the other senders this one passes a per-send `fromName` + `replyTo` so the email reads as
 * the business, and builds its own subject WITHOUT the "Auxx.ai - " prefix (white-label). The From
 * address stays the verified `SYSTEM_FROM_EMAIL`.
 */
export const sendPaymentReceiptEmail = async ({
  email,
  fromName,
  replyTo,
  ...templateProps
}: PaymentReceiptEmailProps & {
  email: UserEmail
  fromName: string
  replyTo?: string
}): Promise<boolean> => {
  try {
    const html = await render(await PaymentReceiptEmail(templateProps))
    const text = PaymentReceiptText(templateProps)
    const subject =
      templateProps.context === 'deposit'
        ? `Deposit received — Quote ${templateProps.documentNumber}`
        : `Payment received — Invoice ${templateProps.documentNumber}`

    return await sendEmail({
      to: email,
      fromName,
      replyTo,
      subject,
      html,
      text,
    })
  } catch (error) {
    logger.error('Error in sendPaymentReceiptEmail', { error })
    throw error
  }
}
