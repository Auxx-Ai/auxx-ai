// packages/lib/src/mail-domains/domains-service.ts

import { configService } from '@auxx/credentials'
import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import crypto from 'crypto'
import { and, eq } from 'drizzle-orm'
import { MailgunApiService } from '../providers/mailgun/mailgun-api-service'

const logger = createScopedLogger('domain-service')

/** Base domain for provider-supplied domains */
const MAILGUN_DOMAIN = configService.get<string>('MAILGUN_DOMAIN') || ''
const APP_URL = configService.get<string>('NEXT_PUBLIC_APP_URL')

/**
 * Service for managing email domains.
 * Only supports provider domains (subdomains on our domain).
 */
export class DomainService {
  /** Generate a verification token for webhook authentication */
  static generateVerificationToken(): string {
    return `verify-${crypto.randomBytes(16).toString('hex')}`
  }

  /** Generate a random subdomain name based on org ID and a random string */
  static generateSubdomain(organizationId: string): string {
    const randomPart = crypto.randomBytes(3).toString('hex')
    const orgPart = organizationId.slice(0, 5).toLowerCase()
    return `${orgPart}-${randomPart}`
  }

  /** Get the provider domain from settings */
  static async getProviderDomain(): Promise<string> {
    return MAILGUN_DOMAIN
  }

  /** Register a new provider-supplied subdomain for an organization */
  static async registerProviderDomain(
    organizationId: string,
    subdomain: string,
    routingPrefix: string = 'ticket'
  ) {
    try {
      const providerDomain = await DomainService.getProviderDomain()

      // Normalize the subdomain
      const normalizedSubdomain = subdomain.toLowerCase().replace(/[^a-z0-9-]/g, '')

      // Check if subdomain is already in use
      const [existingDomain] = await db
        .select({ id: schema.MailDomain.id })
        .from(schema.MailDomain)
        .where(
          and(
            eq(schema.MailDomain.subdomain, normalizedSubdomain),
            eq(schema.MailDomain.type, 'PROVIDER' as any)
          )
        )

      if (existingDomain) {
        throw new Error('This subdomain is already in use. Please choose another one.')
      }

      // Full domain will be subdomain.provider-domain.com
      const fullDomain = `${normalizedSubdomain}.${providerDomain}`

      // Create domain record - already verified since it's our domain
      const [domainRecord] = await db
        .insert(schema.MailDomain)
        .values({
          organizationId,
          domain: fullDomain,
          subdomain: normalizedSubdomain,
          routingPrefix,
          verificationToken: DomainService.generateVerificationToken(),
          isVerified: true,
          verifiedAt: new Date(),
          isActive: true,
          type: 'PROVIDER',
          updatedAt: new Date(),
        })
        .returning()

      // Set up webhook route on parent domain
      // No need to create a new domain - the parent domain handles all subdomains
      const mailgunApi = MailgunApiService.getInstance()
      const webhookUrl = `${APP_URL}/api/mailgun/webhook`
      await mailgunApi.createRoute(fullDomain, webhookUrl)

      return { success: true, domain: domainRecord }
    } catch (error) {
      logger.error('Error registering provider domain:', { error })
      throw new Error(
        'Failed to register provider domain: ' +
          (error instanceof Error ? error.message : 'Unknown error')
      )
    }
  }

  /** Delete a domain */
  static async deleteDomain(organizationId: string, domainId: string) {
    const [domainRecord] = await db
      .select()
      .from(schema.MailDomain)
      .where(
        and(
          eq(schema.MailDomain.id, domainId),
          eq(schema.MailDomain.organizationId, organizationId)
        )
      )

    if (!domainRecord) {
      logger.error('Domain not found for deletion', { organizationId, domainId })
      throw new Error('Domain not found')
    }

    try {
      // Delete from database
      await db.delete(schema.MailDomain).where(eq(schema.MailDomain.id, domainId))

      // Remove from Mailgun
      try {
        const mailgunApi = MailgunApiService.getInstance()
        await mailgunApi.deleteDomain(domainRecord.domain)
      } catch (error) {
        // If domain doesn't exist in Mailgun, just log it
        logger.warn(`Could not delete domain ${domainRecord.domain} from Mailgun:`, { error })
      }

      return { success: true }
    } catch (error) {
      logger.error('Error deleting domain:', { error })
      throw new Error('Failed to delete domain')
    }
  }

  /** Check if a subdomain is available */
  static async checkSubdomainAvailability(subdomain: string): Promise<boolean> {
    const normalizedSubdomain = subdomain.toLowerCase().replace(/[^a-z0-9-]/g, '')

    const [existingDomain] = await db
      .select({ id: schema.MailDomain.id })
      .from(schema.MailDomain)
      .where(
        and(
          eq(schema.MailDomain.subdomain, normalizedSubdomain),
          eq(schema.MailDomain.type, 'PROVIDER' as any)
        )
      )

    return !existingDomain
  }

  /** Suggest alternative subdomains if the requested one is taken */
  static async suggestSubdomains(baseSubdomain: string, count: number = 3): Promise<string[]> {
    const suggestions: string[] = []
    const normalizedBase = baseSubdomain.toLowerCase().replace(/[^a-z0-9-]/g, '')

    for (let i = 0; i < count * 3 && suggestions.length < count; i++) {
      const randomSuffix = Math.floor(Math.random() * 1000)
        .toString()
        .padStart(3, '0')
      const suggestion = `${normalizedBase}-${randomSuffix}`

      if (await DomainService.checkSubdomainAvailability(suggestion)) {
        suggestions.push(suggestion)
      }
    }

    return suggestions
  }
}
