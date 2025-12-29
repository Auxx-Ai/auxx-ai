// server/api/routers/mail-domains.ts
import { z } from 'zod'
import { DomainService } from '@auxx/lib/mail-domains'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'
import { schema } from '@auxx/database'
import { eq, desc, and } from 'drizzle-orm'
import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('mailgun-router')

export const mailDomainsRouter = createTRPCRouter({
  /** Get all domains for the organization */
  getDomains: protectedProcedure.query(async ({ ctx }) => {
    const { organizationId } = ctx.session

    const domains = await ctx.db
      .select()
      .from(schema.MailDomain)
      .where(eq(schema.MailDomain.organizationId, organizationId))
      .orderBy(desc(schema.MailDomain.createdAt))

    return { domains }
  }),

  /** Get a single domain by ID */
  getDomain: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const [domain] = await ctx.db
        .select()
        .from(schema.MailDomain)
        .where(and(eq(schema.MailDomain.id, input.id), eq(schema.MailDomain.organizationId, organizationId)))
        .limit(1)

      if (!domain) {
        logger.error('Domain not found for ID:', { id: input.id })
        throw new Error('Domain not found')
      }

      return { domain }
    }),

  /** Get provider domain info (the base domain for subdomains) */
  getProviderDomainInfo: protectedProcedure.query(async () => {
    const providerDomain = await DomainService.getProviderDomain()
    return { providerDomain }
  }),

  /** Check if a subdomain is available */
  checkSubdomain: protectedProcedure
    .input(z.object({ subdomain: z.string().min(3) }))
    .query(async ({ input }) => {
      const isAvailable = await DomainService.checkSubdomainAvailability(input.subdomain)

      let suggestions: string[] = []
      if (!isAvailable) {
        suggestions = await DomainService.suggestSubdomains(input.subdomain)
      }

      return {
        subdomain: input.subdomain,
        isAvailable,
        suggestions: !isAvailable ? suggestions : [],
      }
    }),

  /** Register a new provider subdomain */
  registerProviderDomain: protectedProcedure
    .input(z.object({ subdomain: z.string().min(3), routingPrefix: z.string().min(1).default('ticket') }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      try {
        const result = await DomainService.registerProviderDomain(
          organizationId,
          input.subdomain,
          input.routingPrefix
        )

        return result
      } catch (error) {
        logger.error('Error registering provider domain:', { error })
        throw new Error(error instanceof Error ? error.message : 'Unknown error')
      }
    }),

  /** Update domain settings */
  updateDomain: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        routingPrefix: z.string().min(1).optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      try {
        const [domain] = await ctx.db.select()
          .from(schema.MailDomain)
          .where(and(
            eq(schema.MailDomain.id, input.id),
            eq(schema.MailDomain.organizationId, organizationId)
          ))
          .limit(1)

        if (!domain) {
          logger.error('Domain not found for update:', { id: input.id })
          throw new Error('Domain not found')
        }

        const [updatedDomain] = await ctx.db.update(schema.MailDomain)
          .set({
            routingPrefix: input.routingPrefix,
            isActive: input.isActive,
            updatedAt: new Date(),
          })
          .where(eq(schema.MailDomain.id, input.id))
          .returning()

        return { success: true, domain: updatedDomain }
      } catch (error) {
        logger.error('Error updating domain:', { error })
        throw new Error(error instanceof Error ? error.message : 'Unknown error')
      }
    }),

  // Delete domain
  deleteDomain: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      try {
        const result = await DomainService.deleteDomain(organizationId, input.id)

        return result
      } catch (error) {
        logger.error('Error deleting domain:', { error })
        throw new Error(error instanceof Error ? error.message : 'Unknown error')
      }
    }),
})
