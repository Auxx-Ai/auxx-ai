// packages/lib/src/providers/mailgun/mailgun-api-service.ts

import { env } from '@auxx/config/server'
import { createScopedLogger } from '@auxx/logger'
import formData from 'form-data'
import Mailgun from 'mailgun.js'
import type { DkimRecord, EmailOptions, EmailProvider, EmailResult } from '../../email/types'

const logger = createScopedLogger('mailgun-api')

/**
 * Singleton service for interacting with the Mailgun API
 * This centralizes all direct Mailgun API interactions to avoid duplication
 * between the MailgunProvider (for emails) and DomainService (for domain management)
 * Implements the EmailProvider interface for abstraction
 */
export class MailgunApiService implements EmailProvider {
  private static instance: MailgunApiService
  private client: any
  private apiKey: string
  private region: string
  public readonly id = 'mailgun'

  private constructor() {
    this.apiKey = env.MAILGUN_API_KEY || ''
    this.region = env.MAILGUN_REGION || 'us'

    if (!this.apiKey) {
      throw new Error('Mailgun API key not configured')
    }

    // Initialize Mailgun client
    const mailgun = new Mailgun(formData)
    this.client = mailgun.client({
      username: 'api',
      key: this.apiKey,
      url: this.region === 'eu' ? 'https://api.eu.mailgun.net' : undefined,
    })
  }

  /**
   * Get the singleton instance of the MailgunApiService
   */
  public static getInstance(): MailgunApiService {
    if (!MailgunApiService.instance) {
      MailgunApiService.instance = new MailgunApiService()
    }
    return MailgunApiService.instance
  }

  /**
   * Creates a domain in Mailgun if it doesn't already exist
   *
   * @param domain - The domain name to create
   * @returns Promise that resolves when the domain is created or verified to exist
   * @throws Error if domain creation fails
   */
  async createDomain(domain: string): Promise<boolean> {
    try {
      // Check if domain exists in Mailgun
      try {
        await this.client.domains.get(domain)
        logger.info('Domain already exists in Mailgun', { domain })
        // Domain exists, no need to create
        return true
      } catch {
        // Domain doesn't exist, create it
        logger.info('Creating domain in Mailgun', { domain })

        await this.client.domains.create({
          name: domain,
          spam_action: 'disabled',
          wildcard: true, // Enable wildcard for subdomains
        })

        return true
      }
    } catch (error) {
      logger.error('Error creating domain in Mailgun:', { error, domain })
      throw error
    }
  }

  /**
   * Creates a route in Mailgun for handling incoming emails
   *
   * @param domain - The domain to create a route for
   * @param webhookUrl - The URL where emails should be forwarded
   * @returns Promise that resolves when the route is created
   * @throws Error if route creation fails
   */
  async createRoute(domain: string, webhookUrl: string): Promise<boolean> {
    try {
      // Check if route already exists
      const routesList = await this.client.routes.list()

      // Check if route already exists for this domain and webhook
      const routeExists = routesList.items.some(
        (route: any) =>
          route.expression.includes(domain) &&
          route.actions.some((action: string) => action.includes(webhookUrl))
      )

      if (routeExists) {
        logger.info('Route already exists for domain', { domain, webhookUrl })
        return true
      }

      // Create the route
      logger.info('Creating route for domain', { domain, webhookUrl })
      await this.client.routes.create({
        priority: 0,
        description: `Route for ${domain}`,
        expression: `match_recipient(".*@${domain}")`,
        actions: [`forward("${webhookUrl}")`, 'store()'],
      })

      return true
    } catch (error) {
      logger.error('Error creating route in Mailgun:', { error, domain, webhookUrl })
      throw error
    }
  }

  /**
   * Deletes routes for a domain
   *
   * @param domain - The domain to delete routes for
   * @returns Promise that resolves when routes are deleted
   */
  async deleteRoutes(domain: string): Promise<boolean> {
    try {
      const routesList = await this.client.routes.list()

      // Find routes that match this domain
      for (const route of routesList.items) {
        if (route.expression.includes(domain)) {
          await this.client.routes.destroy(route.id)
        }
      }

      return true
    } catch (error) {
      logger.error('Error deleting routes from Mailgun:', { error, domain })
      throw error
    }
  }

  /**
   * Deletes a domain from Mailgun
   *
   * @param domain - The domain to delete
   * @returns Promise that resolves when the domain is deleted
   */
  async deleteDomain(domain: string): Promise<boolean> {
    try {
      await this.client.domains.destroy(domain)
      return true
    } catch (error) {
      logger.error('Error deleting domain from Mailgun:', { error, domain })
      throw error
    }
  }

  /**
   * Gets DKIM records for a domain
   *
   * @param domain - The domain to get DKIM records for
   * @returns Promise that resolves to DKIM record object or null if not found
   */
  async getDkimRecord(domain: string): Promise<DkimRecord | null> {
    try {
      // First check if domain exists in Mailgun
      try {
        const domainInfo = await this.client.domains.get(domain)

        // If domain exists, get the DKIM record
        if (domainInfo?.sending_dns_records) {
          // Find the DKIM record in the response
          const dkimRecord = domainInfo.sending_dns_records.find(
            (record: any) => record.record_type === 'TXT' && record.name.includes('dkim')
          )

          if (dkimRecord) {
            return {
              name: dkimRecord.name,
              value: dkimRecord.value,
              type: dkimRecord.record_type || 'TXT',
            }
          }

          return null
        }

        return null
      } catch {
        // Domain doesn't exist in Mailgun yet, create it first
        logger.info('Domain not found in Mailgun, creating...', { domain })

        // Create the domain in Mailgun
        await this.createDomain(domain)

        // Fetch domain info again to get the DKIM record
        const domainInfo = await this.client.domains.get(domain)

        if (domainInfo?.sending_dns_records) {
          const dkimRecord = domainInfo.sending_dns_records.find(
            (record: any) => record.record_type === 'TXT' && record.name.includes('dkim')
          )

          if (dkimRecord) {
            return {
              name: dkimRecord.name,
              value: dkimRecord.value,
              type: dkimRecord.record_type || 'TXT',
            }
          }
        }

        return null
      }
    } catch (error) {
      logger.error('Error fetching DKIM records:', { error, domain })
      throw error
    }
  }

  /**
   * Sends an email via Mailgun (overloaded for compatibility)
   */
  async sendEmail(options: EmailOptions): Promise<EmailResult>
  async sendEmail(
    options: {
      from: string
      to: string | string[]
      subject: string
      text?: string
      html?: string
      inReplyTo?: string
      references?: string
      messageId?: string
      attachments?: Array<{ filename: string; data: Buffer; contentType: string }>
      trackingEnabled?: boolean
    },
    domain?: string
  ): Promise<EmailResult>
  async sendEmail(options: EmailOptions | any, domain?: string): Promise<EmailResult> {
    const messageData: Record<string, any> = {
      to: Array.isArray(options.to) ? options.to.join(',') : options.to,
      from: options.from,
      subject: options.subject,
      text: options.text || '',
      html: options.html || '',
      'h:In-Reply-To': options.inReplyTo,
      'h:References': options.references,
      'h:Message-Id': options.messageId,
      'o:tracking': options.trackingEnabled ? 'yes' : 'no',
    }

    // Add attachments if provided
    if (options.attachments && options.attachments.length > 0) {
      messageData.attachment = options.attachments.map((attachment) => ({
        filename: attachment.filename,
        data: attachment.data,
        contentType: attachment.contentType,
      }))
    }

    try {
      // Extract domain from the from address if not provided
      const fromDomain = domain || options.from.split('@')[1]

      if (!fromDomain) {
        throw new Error('Invalid from address or domain not provided')
      }

      const response = await this.client.messages.create(fromDomain, messageData)

      return { id: response.id, success: true, raw: response }
    } catch (error) {
      logger.error('Error sending email via Mailgun:', { error })
      return {
        id: '',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        raw: error,
      }
    }
  }

  /**
   * Verifies a webhook signature from Mailgun
   *
   * @param signature - The signature to verify
   * @param token - The token provided in the webhook
   * @param timestamp - The timestamp provided in the webhook
   * @param webhookKey - The webhook signing key (optional, uses API key if not provided)
   * @returns Promise resolving to boolean indicating if signature is valid
   */
  async verifyWebhookSignature(
    signature: string,
    token: string,
    timestamp: string,
    webhookKey?: string
  ): Promise<boolean> {
    try {
      // Use the official Mailgun verification
      const key = webhookKey || this.apiKey
      return this.client.webhooks.verify(timestamp, token, signature, key)
    } catch (error) {
      logger.error('Error verifying Mailgun webhook signature:', { error })
      return false
    }
  }

  /**
   * Gets the Mailgun client instance for direct use if needed
   * (should be avoided in favor of using the specific methods)
   */
  getClient() {
    return this.client
  }
}
