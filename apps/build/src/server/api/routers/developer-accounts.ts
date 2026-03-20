// apps/build/src/server/api/routers/developer-accounts.ts
// Developer accounts tRPC router

import { onCacheEvent } from '@auxx/lib/cache'
import { createScopedLogger } from '@auxx/logger'
import {
  checkDeveloperAccountSlugExists,
  checkSlugInputSchema,
  createDeveloperAccount,
  createDeveloperAccountInputSchema,
  getDeveloperAccount,
  getDeveloperAccountFirstApp,
  getDeveloperAccountInputSchema,
  listDeveloperAccounts,
  updateDeveloperAccount,
  updateDeveloperAccountInputSchema,
} from '@auxx/services/developer-accounts'
import { TRPCError } from '@trpc/server'
import z from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'

const logger = createScopedLogger('trpc-build-developer-accounts')

/**
 * Developer accounts router
 */
export const developerAccountsRouter = createTRPCRouter({
  /**
   * Check if slug exists
   */
  slugExists: protectedProcedure.input(checkSlugInputSchema).query(async ({ input }) => {
    const result = await checkDeveloperAccountSlugExists({ slug: input.slug })

    if (result.isErr()) {
      const error = result.error
      logger.error('Failed to check slug exists', { error, slug: input.slug })

      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: error.message,
      })
    }

    return result.value
  }),

  /**
   * List developer accounts for current user
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const result = await listDeveloperAccounts({ userId: ctx.session.userId })

    if (result.isErr()) {
      const error = result.error
      logger.error('Failed to list developer accounts', { error, userId: ctx.session.userId })

      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: error.message,
      })
    }

    return result.value.accounts
  }),

  /**
   * Create developer account
   */
  create: protectedProcedure
    .input(createDeveloperAccountInputSchema.pick({ slug: true, title: true, logoId: true }))
    .mutation(async ({ ctx, input }) => {
      const result = await createDeveloperAccount({
        userId: ctx.session.userId,
        userEmail: ctx.session.userEmail,
        slug: input.slug,
        title: input.title,
        logoId: input.logoId,
      })

      if (result.isErr()) {
        const error = result.error
        logger.error('Failed to create developer account', { error, input })

        // Map error codes to TRPC error codes
        if (error.code === 'DEVELOPER_ACCOUNT_SLUG_TAKEN') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: error.message,
          })
        }

        if (error.code === 'DEVELOPER_ACCOUNT_CREATE_FAILED') {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: error.message,
          })
        }

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message,
        })
      }

      // Invalidate cache for the current user (they now have a new account)
      await onCacheEvent('build.developer-account.created', { userId: ctx.session.userId })

      return result.value
    }),

  /**
   * Get developer account by slug (with membership check)
   */
  getBySlug: protectedProcedure
    .input(getDeveloperAccountInputSchema)
    .query(async ({ ctx, input }) => {
      const result = await getDeveloperAccount({
        slug: input.slug,
        userId: ctx.session.userId,
      })

      if (result.isErr()) {
        const error = result.error
        logger.error('Failed to get developer account', { error, input })

        // Map error codes to TRPC error codes
        if (error.code === 'DEVELOPER_ACCOUNT_NOT_FOUND') {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: error.message,
          })
        }

        if (error.code === 'DEVELOPER_ACCESS_DENIED') {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: error.message,
          })
        }

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message,
        })
      }

      return result.value
    }),

  /**
   * Get first app for a developer account
   */
  getFirstApp: protectedProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await getDeveloperAccountFirstApp({
        slug: input.slug,
        userId: ctx.session.userId,
      })

      if (result.isErr()) {
        const error = result.error
        logger.error('Failed to get developer account first app', { error, input })

        // Map error codes to TRPC error codes
        if (error.code === 'DEVELOPER_ACCOUNT_NOT_FOUND') {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: error.message,
          })
        }

        if (error.code === 'DEVELOPER_ACCESS_DENIED') {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: error.message,
          })
        }

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message,
        })
      }

      return result.value
    }),

  /**
   * Update developer account
   */
  update: protectedProcedure
    .input(updateDeveloperAccountInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await updateDeveloperAccount({
        developerAccountId: input.developerAccountId,
        userId: ctx.session.userId,
        data: input.data,
      })

      if (result.isErr()) {
        const error = result.error
        logger.error('Failed to update developer account', { error, input })

        // Map error codes to TRPC error codes
        if (error.code === 'DEVELOPER_ACCOUNT_NOT_FOUND') {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: error.message,
          })
        }

        if (error.code === 'DEVELOPER_ACCESS_DENIED') {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: error.message,
          })
        }

        if (error.code === 'DEVELOPER_ACCOUNT_UPDATE_FAILED') {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: error.message,
          })
        }

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message,
        })
      }

      // Invalidate cache for the current user
      await onCacheEvent('build.developer-account.updated', { userId: ctx.session.userId })

      return result.value
    }),
})
