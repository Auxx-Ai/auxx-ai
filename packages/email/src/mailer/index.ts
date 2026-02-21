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
  VerificationEmail,
  VerificationText,
  WelcomeEmail,
  WelcomeText,
} from '../templates'
import type { EmailOptions, UserEmail } from '../types'
import { NodemailerService } from './nodemailer-service'

const logger = createScopedLogger('system-mail')

function formatSubject(subject: string) {
  return `Auxx.ai - ${subject}`
}

interface SendEmailDataProps {
  to: string
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
    configService.get<string>('EMAIL_REPLY_TO') || configService.get<string>('SUPPORT_EMAIL')
  const supportName = configService.get<string>('SUPPORT_NAME') || 'Support Team'

  try {
    // Set up the from address with a friendly name
    const from = `${supportName} <${fromEmail}>`

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

    return result
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
    logger.error(error, 'Error in sendVerificationEmail')
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
    logger.error(error, 'Error in sendEmailChangeVerificationEmail')
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
    logger.error(error, 'Error in sendResetPasswordEmail')
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
    logger.error(error, 'Error in sendPasswordResetNotifyEmail')
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
    logger.error(error, 'Error in sendWelcomeEmail')
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
    logger.error(error, 'Error in sendBillingEmail')
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
    logger.error(error, 'Error in sendSystemEmail')
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
    logger.error(error, 'Error in sendInviteEmail')
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
    logger.error(error, 'Error in sendJoinOrganizationEmail')
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
  expiresAt: Date
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
    logger.error(error, 'Error in sendApprovalRequestEmail')
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
  expiresAt: Date
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
    logger.error(error, 'Error in sendApprovalReminderEmail')
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
    const html = await render(
      await SubscriptionWelcomeEmail({ name, planName, billingCycle, dashboardUrl })
    )
    const text = SubscriptionWelcomeText({ name, planName, billingCycle, dashboardUrl })

    return await sendEmail({
      to: email,
      subject: formatSubject(`Welcome to ${planName}!`),
      html,
      text,
    })
  } catch (error) {
    logger.error(error, 'Error in sendSubscriptionWelcomeEmail')
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
    logger.error(error, 'Error in sendTrialStartedEmail')
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
    logger.error(error, 'Error in sendTrialEndingEmail')
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
    logger.error(error, 'Error in sendTrialExpiredEmail')
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
    logger.error(error, 'Error in sendSubscriptionCancelledEmail')
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
    logger.error(error, 'Error in sendPaymentFailedEmail')
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
    logger.error(error, 'Error in sendTrialDeletionWarningEmail')
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
    logger.error(error, 'Error in sendTrialDeletionFinalEmail')
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
    logger.error(error, 'Error in sendGettingStartedEmail')
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
    logger.error(error, 'Error in sendMidTrialEmail')
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
    logger.error(error, 'Error in sendTrialConversionEmail')
    throw error
  }
}
