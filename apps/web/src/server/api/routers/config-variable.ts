// apps/web/src/server/api/routers/config-variable.ts
// Config variable router — super admin only.

import { configService } from '@auxx/credentials'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { createTRPCRouter, superAdminProcedure } from '~/server/api/trpc'

/**
 * Config variable router — super admin only.
 * Manages server-level configuration variables.
 */
export const configVariableRouter = createTRPCRouter({
  /**
   * Get all config variables grouped by category.
   * Returns resolved values (DB override, env, or default).
   * Sensitive values are masked.
   */
  getGrouped: superAdminProcedure.query(async () => {
    try {
      return await configService.getGrouped()
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : 'Failed to fetch config variables',
      })
    }
  }),

  /**
   * Get a single config variable with full details.
   */
  getByKey: superAdminProcedure.input(z.object({ key: z.string().min(1) })).query(({ input }) => {
    const resolved = configService.getResolved(input.key)
    if (!resolved) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Config variable '${input.key}' not found`,
      })
    }
    return resolved
  }),

  /**
   * Set a DB override for a config variable.
   */
  set: superAdminProcedure
    .input(
      z.object({
        key: z.string().min(1),
        value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!configService.isDbEnabled) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message:
            'Database config overrides are not enabled. Set IS_CONFIG_VARIABLES_IN_DB_ENABLED=true',
        })
      }

      try {
        await configService.set(input.key, input.value, ctx.session.user.id)
        return { success: true }
      } catch (error) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Failed to set config variable',
        })
      }
    }),

  /**
   * Delete a DB override (revert to env var or default).
   */
  delete: superAdminProcedure
    .input(z.object({ key: z.string().min(1) }))
    .mutation(async ({ input }) => {
      if (!configService.isDbEnabled) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Database config overrides are not enabled',
        })
      }

      try {
        await configService.delete(input.key)
        return { success: true }
      } catch (error) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : 'Failed to delete config variable',
        })
      }
    }),

  /**
   * Check if DB config overrides are enabled.
   * Used by the UI to show read-only vs editable state.
   */
  getStatus: superAdminProcedure.query(() => {
    return {
      isDbEnabled: configService.isDbEnabled,
    }
  }),
})
