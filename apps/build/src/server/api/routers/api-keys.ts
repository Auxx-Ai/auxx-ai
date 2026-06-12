// apps/build/src/server/api/routers/api-keys.ts
// Developer API keys tRPC router (headless CLI publishing)

import { generateApiKey, hashApiKey } from '@auxx/credentials/api-key'
import { ApiKey, DeveloperAccount, DeveloperAccountMember } from '@auxx/database'
import { TRPCError } from '@trpc/server'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'

/**
 * Resolve a developer slug to an account ID and verify the caller is a member.
 */
async function resolveAccount(
  db: Parameters<Parameters<typeof protectedProcedure.query>[0]>['ctx']['db'],
  developerSlug: string,
  userId: string
) {
  const [account] = await db
    .select({ id: DeveloperAccount.id })
    .from(DeveloperAccount)
    .where(eq(DeveloperAccount.slug, developerSlug))
    .limit(1)

  if (!account) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Developer account not found' })
  }

  const [member] = await db
    .select({ id: DeveloperAccountMember.id })
    .from(DeveloperAccountMember)
    .where(
      and(
        eq(DeveloperAccountMember.developerAccountId, account.id),
        eq(DeveloperAccountMember.userId, userId)
      )
    )
    .limit(1)

  if (!member) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'You are not a member of this account' })
  }

  return account.id
}

/**
 * Developer API keys router — manages `type: 'developer'` keys used by CI to
 * publish apps headlessly. Keys are scoped to a developer account via
 * `referenceId`; the plaintext is shown once on creation.
 */
export const apiKeysRouter = createTRPCRouter({
  /**
   * List active developer keys for an account (never returns plaintext/hash).
   */
  list: protectedProcedure
    .input(z.object({ developerSlug: z.string() }))
    .query(async ({ ctx, input }) => {
      const accountId = await resolveAccount(ctx.db, input.developerSlug, ctx.session.userId)

      return ctx.db
        .select({
          id: ApiKey.id,
          name: ApiKey.name,
          createdAt: ApiKey.createdAt,
        })
        .from(ApiKey)
        .where(
          and(
            eq(ApiKey.type, 'developer'),
            eq(ApiKey.referenceId, accountId),
            eq(ApiKey.isActive, true)
          )
        )
        .orderBy(desc(ApiKey.createdAt))
    }),

  /**
   * Mint a new developer key. Returns the plaintext `auxx_dev_...` once.
   */
  create: protectedProcedure
    .input(z.object({ developerSlug: z.string(), name: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const accountId = await resolveAccount(ctx.db, input.developerSlug, ctx.session.userId)

      const secretKey = generateApiKey('auxx_dev')
      const hashedKey = hashApiKey(secretKey)
      const keySuffix = secretKey.slice(-5).toUpperCase()

      await ctx.db.insert(ApiKey).values({
        userId: ctx.session.userId,
        name: input.name || `Deploy key ...${keySuffix}`,
        hashedKey,
        isActive: true,
        type: 'developer',
        referenceId: accountId,
        updatedAt: new Date(),
      })

      return { secretKey }
    }),

  /**
   * Revoke (deactivate) a developer key.
   */
  revoke: protectedProcedure
    .input(z.object({ developerSlug: z.string(), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const accountId = await resolveAccount(ctx.db, input.developerSlug, ctx.session.userId)

      const [updated] = await ctx.db
        .update(ApiKey)
        .set({ isActive: false, updatedAt: new Date() })
        .where(
          and(
            eq(ApiKey.id, input.id),
            eq(ApiKey.type, 'developer'),
            eq(ApiKey.referenceId, accountId)
          )
        )
        .returning({ id: ApiKey.id })

      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'API key not found' })
      }

      return { success: true }
    }),
})
