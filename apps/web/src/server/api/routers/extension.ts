// apps/web/src/server/api/routers/extension.ts

import { fetchAndStoreRemoteImage } from '@auxx/lib/files'
import { createScopedLogger } from '@auxx/logger'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

const logger = createScopedLogger('api-extension')

/**
 * Endpoints for the Auxx Chrome extension.
 *
 * - parserHealth: once-per-content-script ping aggregated downstream
 *   (PostHog) so we get an alert when DOM selectors break across many
 *   users at once.
 * - uploadAvatarFromUrl: server-side fetch of a remote avatar/logo URL
 *   into a MediaAsset. Returns an `asset:<id>` ref the extension injects
 *   into the FILE field (contact_avatar / company_logo) at record create.
 */
export const extensionRouter = createTRPCRouter({
  parserHealth: protectedProcedure
    .input(
      z.object({
        host: z.string().max(255),
        url: z.string().max(2048),
        parsed: z.boolean(),
        extensionVersion: z.string().max(32),
      })
    )
    .mutation(async ({ ctx, input }) => {
      logger.info('extension parser health', {
        userId: ctx.session.userId,
        organizationId: ctx.session.organizationId,
        host: input.host,
        parsed: input.parsed,
        extensionVersion: input.extensionVersion,
      })
      return { ok: true as const }
    }),

  uploadAvatarFromUrl: protectedProcedure
    .input(
      z.object({
        url: z.string().url().max(2048),
        entityType: z.enum(['contact', 'company']),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const isCompany = input.entityType === 'company'
      const result = await fetchAndStoreRemoteImage({
        url: input.url,
        organizationId: ctx.session.organizationId,
        userId: ctx.session.userId,
        pathPrefix: isCompany ? 'company-logos' : 'contact-avatars',
        purpose: isCompany ? 'company-logo' : 'contact-avatar',
        name: isCompany ? 'company-logo' : 'contact-avatar',
      })
      return { assetId: result.assetId, ref: result.ref }
    }),
})
