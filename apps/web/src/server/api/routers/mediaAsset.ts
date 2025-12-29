// apps/web/src/server/api/routers/mediaAsset.ts
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'
import { MediaAssetService } from '@auxx/lib/files'

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
      const mediaAssetService = new MediaAssetService(
        ctx.session.organization.id,
        ctx.session.user.id,
        ctx.db
      )

      await mediaAssetService.convertTempToPermanent(
        input.mediaAssetId,
        input.newKind,
        ctx.session.organization.id
      )

      return { success: true }
    }),
})
