// packages/lib/src/email/nodemailer-service.ts

import { configService } from '@auxx/credentials'
import { createScopedLogger } from '@auxx/logger'
import type nodemailer from 'nodemailer'
import { TransportFactory } from './transports/factory'
import type { EmailOptions, EmailResult } from './types'

const logger = createScopedLogger('nodemailer-service')

/**
 * Lightweight wrapper around Nodemailer with lazy verification and a unified send API
 */
export class NodemailerService {
  private static instance: NodemailerService
  private transporter: nodemailer.Transporter
  private initialized = false

  /**
   * Private constructor to enforce singleton usage
   */
  private constructor() {
    this.transporter = TransportFactory.create()
  }

  /**
   * Get singleton instance of the email service
   */
  public static getInstance(): NodemailerService {
    if (!NodemailerService.instance) {
      NodemailerService.instance = new NodemailerService()
    }
    return NodemailerService.instance
  }

  /**
   * One-time verification for the underlying transport
   */
  async init(): Promise<void> {
    if (this.initialized) return
    try {
      await this.transporter.verify()
      this.initialized = true
      logger.info('Email transport verified')
    } catch (error) {
      logger.error('Email transport verification failed', { error })
      throw error
    }
  }

  /**
   * Send an email using Nodemailer but keep our EmailResult shape
   */
  async sendEmail(options: Omit<EmailOptions, 'from'> & { from?: string }): Promise<EmailResult> {
    logger.info('NodemailerService.sendEmail called', {
      to: options.to,
      subject: options.subject,
      hasFrom: !!options.from,
    })

    try {
      logger.info('Initializing transport...')
      await this.init()
      logger.info('Transport initialized successfully')

      const mailOptions = {
        from: options.from || this.getDefaultFrom(),
        to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
        cc: options.cc
          ? Array.isArray(options.cc)
            ? options.cc.join(', ')
            : options.cc
          : undefined,
        bcc: options.bcc
          ? Array.isArray(options.bcc)
            ? options.bcc.join(', ')
            : options.bcc
          : undefined,
        subject: options.subject,
        text: options.text,
        html: options.html,
        attachments: options.attachments as any,
        headers: options.headers,
        replyTo: options.replyTo || configService.get<string>('EMAIL_REPLY_TO'),
        inReplyTo: options.inReplyTo,
        references: options.references,
        messageId: options.messageId,
      }

      logger.info('NodemailerService sending email', {
        to: mailOptions.to,
        subject: mailOptions.subject,
        hasText: !!mailOptions.text,
        hasHtml: !!mailOptions.html,
        from: mailOptions.from,
        fieldCount: Object.keys(mailOptions).filter((k) => mailOptions[k] !== undefined).length,
      })

      const info = await this.transporter.sendMail(mailOptions)

      return {
        id: (info as any).messageId || '',
        success: true,
        raw: info,
      }
    } catch (error) {
      logger.error('Failed to send email', { error })
      return {
        id: '',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        raw: error,
      }
    }
  }

  /**
   * Compose the default From header
   */
  private getDefaultFrom(): string {
    const email = configService.get<string>('SYSTEM_FROM_EMAIL') || 'noreply@example.com'
    const name =
      configService.get<string>('SYSTEM_FROM_NAME') ||
      configService.get<string>('SUPPORT_NAME') ||
      'System'
    return `${name} <${email}>`
  }
}
