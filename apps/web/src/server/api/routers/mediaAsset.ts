// apps/web/src/server/api/routers/mediaAsset.ts

import { MediaAssetService } from '@auxx/lib/files'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

/**
 * MediaAsset router for managing media assets
 */
export const mediaAssetRouter = createTRPCRouter({
  /**
   * Convert TEMP_UPLOAD MediaAsset to a permanent kind
   */
  convertTempToPermanent: protectedProcedure
    .input(
      z.object({
        mediaAssetId: z.string(),
        newKind: z.enum([
          'USER_AVATAR',
          'INLINE_IMAGE',
          'THUMBNAIL',
          'SYSTEM_BLOB',
          'EMAIL_ATTACHMENT',
          'DOCUMENT',
        ]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const mediaAssetService = new MediaAssetService(organizationId, userId, ctx.db)

      await mediaAssetService.convertTempToPermanent(
        input.mediaAssetId,
        input.newKind,
        organizationId
      )

      return { success: true }
    }),
})
