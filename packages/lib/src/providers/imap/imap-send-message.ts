// packages/lib/src/providers/imap/imap-send-message.ts

import { createScopedLogger } from '@auxx/logger'
import { createTransport, type Transporter } from 'nodemailer'
import { BadRequestError } from '../../errors'
import { resolvePublicHost } from '../../net/safe-fetch'
import type { SendMessageOptions } from '../channel-provider.interface'
import {
  SMTP_CONNECTION_TIMEOUT_MS,
  SMTP_GREETING_TIMEOUT_MS,
  SMTP_SOCKET_TIMEOUT_MS,
} from './constants'
import type { ImapCredentialData } from './types'

const logger = createScopedLogger('imap-smtp')

export class ImapSmtpSendService {
  private smtp: ImapCredentialData['smtp'] | null = null

  async initialize(credentials: ImapCredentialData): Promise<void> {
    this.smtp = credentials.smtp
  }

  // Resolved per send, not at initialize: provider init also serves sync, and a vetted
  // address must not go stale across a long-lived provider.
  private async createTransporter(smtp: ImapCredentialData['smtp']): Promise<Transporter> {
    const target = await resolvePublicHost(smtp.host)
    return createTransport({
      host: target.address,
      port: smtp.port,
      secure: smtp.secure,
      auth: {
        user: smtp.username,
        pass: smtp.password,
      },
      connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
      greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
      socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
      tls: {
        rejectUnauthorized: !smtp.allowUnauthorizedCerts,
        servername: target.servername,
      },
    })
  }

  async sendMessage(options: SendMessageOptions): Promise<{ id?: string; success: boolean }> {
    if (!this.smtp) {
      throw new BadRequestError('SMTP not initialized')
    }
    try {
      const transporter = await this.createTransporter(this.smtp)
      const result = await transporter.sendMail({
        from: options.from,
        to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
        cc: options.cc?.join(', '),
        bcc: options.bcc?.join(', '),
        subject: options.subject,
        text: options.text,
        html: options.html,
        inReplyTo: options.inReplyTo,
        references: options.references,
        headers: {
          ...(options.messageId ? { 'Message-ID': options.messageId } : {}),
          // Our own `Message.id`, so an inbound copy of this send arriving on
          // another channel resolves back to the row we sent and is recognised
          // as an echo (`store-message.ts`'s `ownEcho`). Gmail, Outlook and SES
          // stamp the same header — SMTP was the one door that didn't, leaving
          // IMAP channels with no cross-channel echo detection at all.
          ...(options.internalMessageId
            ? { 'X-AuxxAi-Message-Id': options.internalMessageId }
            : {}),
          // RFC 3834 loop prevention for automated sends (machine-mail plan Phase 2)
          ...(options.automated
            ? { 'Auto-Submitted': 'auto-replied', 'X-Auto-Response-Suppress': 'All' }
            : {}),
        },
      })

      logger.info('SMTP message sent', { messageId: result.messageId })

      return { id: result.messageId, success: true }
    } catch (error) {
      logger.error('SMTP send failed', {
        error: error instanceof Error ? error.message : String(error),
      })
      throw this.parseSmtpError(error)
    }
  }

  async verify(): Promise<boolean> {
    if (!this.smtp) return false

    try {
      const transporter = await this.createTransporter(this.smtp)
      await transporter.verify()
      transporter.close()
      return true
    } catch {
      return false
    }
  }

  async close(): Promise<void> {
    this.smtp = null
  }

  private parseSmtpError(error: unknown): Error {
    if (!(error instanceof Error)) {
      return new BadRequestError('Unknown SMTP error')
    }

    const smtpError = error as { code?: string; responseCode?: number }

    if (smtpError.responseCode === 535 || smtpError.code === 'EAUTH') {
      return new BadRequestError(`SMTP authentication failed: ${error.message}`)
    }

    const networkCodes = new Set([
      'ECONNREFUSED',
      'ECONNRESET',
      'ENOTFOUND',
      'ETIMEDOUT',
      'EHOSTUNREACH',
      'ESOCKET',
    ])

    if (smtpError.code && networkCodes.has(smtpError.code)) {
      return new BadRequestError(`SMTP network error: ${smtpError.code} - ${error.message}`)
    }

    if (smtpError.responseCode && smtpError.responseCode >= 550 && smtpError.responseCode <= 559) {
      return new BadRequestError(`SMTP recipient rejected: ${error.message}`)
    }

    return new BadRequestError(`SMTP error: ${error.message}`)
  }
}
