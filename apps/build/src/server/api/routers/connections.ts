// apps/build/src/server/api/routers/connections.ts
// Connections tRPC router

import { decryptValue, encryptValue, isMaskEcho, maskValue } from '@auxx/credentials/crypto'
import { App, ConnectionDefinition, DeveloperAccountMember, type database } from '@auxx/database'
import { AUDIT_ACTIONS, recordAudit } from '@auxx/lib/audit-log'
import { invalidateOrgsByAppId } from '@auxx/lib/cache'
import { TRPCError } from '@trpc/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'

/** Pure `{var}` templates are config, not secret material — shown unmasked in the form. */
const TEMPLATE_ONLY = /^\{[^}]+\}$/

/** Fetch the app and assert the caller is a member of its developer account. */
async function getAppForMember(db: typeof database, appId: string, userId: string) {
  const [app] = await db.select().from(App).where(eq(App.id, appId)).limit(1)
  if (!app) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'App not found' })
  }

  const [member] = await db
    .select()
    .from(DeveloperAccountMember)
    .where(
      and(
        eq(DeveloperAccountMember.developerAccountId, app.developerAccountId),
        eq(DeveloperAccountMember.userId, userId)
      )
    )
    .limit(1)

  if (!member) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this app' })
  }

  return app
}

/**
 * Redact a row before it leaves the server: client id decrypted (public by protocol),
 * client secret decrypted then masked — the real value never reaches the browser.
 */
function redactConnection<
  T extends { oauth2ClientId: string | null; oauth2ClientSecret: string | null },
>(connection: T): T {
  const secret = decryptValue(connection.oauth2ClientSecret)
  return {
    ...connection,
    oauth2ClientId: decryptValue(connection.oauth2ClientId),
    oauth2ClientSecret: secret && !TEMPLATE_ONLY.test(secret) ? maskValue(secret) : secret,
  }
}

/**
 * Connections router
 */
export const connectionsRouter = createTRPCRouter({
  /**
   * List all connection definitions for an app
   */
  list: protectedProcedure.input(z.object({ appId: z.string() })).query(async ({ ctx, input }) => {
    await getAppForMember(ctx.db, input.appId, ctx.session.userId)

    // Publish checks only need presence — booleans from the in-hand ciphertext, zero decrypts,
    // and credential material never ships on the list path.
    const connections = await ctx.db
      .select()
      .from(ConnectionDefinition)
      .where(eq(ConnectionDefinition.appId, input.appId))

    return connections.map(({ oauth2ClientId, oauth2ClientSecret, ...rest }) => ({
      ...rest,
      hasClientId: Boolean(oauth2ClientId),
      hasClientSecret: Boolean(oauth2ClientSecret),
    }))
  }),

  /**
   * Get connection definition for an app version
   */
  get: protectedProcedure
    .input(
      z.object({
        appId: z.string(),
        version: z.number(),
        global: z.boolean(),
      })
    )
    .query(async ({ ctx, input }) => {
      await getAppForMember(ctx.db, input.appId, ctx.session.userId)

      // Get connection definition
      const [connection] = await ctx.db
        .select()
        .from(ConnectionDefinition)
        .where(
          and(
            eq(ConnectionDefinition.appId, input.appId),
            eq(ConnectionDefinition.major, input.version),
            eq(ConnectionDefinition.global, input.global)
          )
        )
        .limit(1)

      return connection ? redactConnection(connection) : null
    }),

  /**
   * Create or update connection definition
   */
  upsert: protectedProcedure
    .input(
      z.object({
        appId: z.string(),
        version: z.number(),
        global: z.boolean(),
        connectionType: z.enum(['oauth2-code', 'secret', 'none']),
        label: z.string(),
        description: z.string().optional(),
        oauth2AuthorizeUrl: z.string().optional(),
        oauth2AccessTokenUrl: z.string().optional(),
        oauth2ClientId: z.string().optional(),
        oauth2ClientSecret: z.string().optional(),
        oauth2Scopes: z
          .array(z.string())
          .optional()
          .transform((scopes) => {
            if (!scopes) return scopes
            // Normalize: split entries that contain commas or whitespace into individual scopes
            return scopes
              .flatMap((s) => s.split(/[\s,]+/))
              .map((s) => s.trim())
              .filter((s) => s.length > 0)
          }),
        oauth2TokenRequestAuthMethod: z.enum(['request-body', 'basic-auth']).optional(),
        oauth2RefreshTokenIntervalSeconds: z.number().optional(),
        oauth2Features: z
          .object({
            pkce: z.boolean().optional(),
            callbackBaseUrl: z.string().optional(),
            additionalAuthorizeParams: z.record(z.string(), z.string()).optional(),
            additionalTokenParams: z.record(z.string(), z.string()).optional(),
            scopeSeparator: z.string().optional(),
            callbackMetadataParams: z.array(z.string()).optional(),
            connectionVariables: z
              .array(
                z.object({
                  key: z.string(),
                  label: z.string(),
                  description: z.string().optional(),
                  placeholder: z.string().optional(),
                  required: z.boolean().optional(),
                  secret: z.boolean().optional(),
                })
              )
              .optional(),
          })
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const app = await getAppForMember(ctx.db, input.appId, ctx.session.userId)

      // Check if connection exists
      const [existing] = await ctx.db
        .select()
        .from(ConnectionDefinition)
        .where(
          and(
            eq(ConnectionDefinition.appId, input.appId),
            eq(ConnectionDefinition.major, input.version),
            eq(ConnectionDefinition.global, input.global)
          )
        )
        .limit(1)

      // Write-only secret contract: the form prefills a mask, so an unchanged field comes back
      // as HIDDEN_VALUE (or, from a buggy client, the mask itself) — both keep the stored
      // ciphertext instead of corrupting the credential. Blank on an existing row also keeps it.
      const storedSecret = existing?.oauth2ClientSecret ?? null
      const submittedSecret = input.oauth2ClientSecret
      const secretIsMaskEcho = submittedSecret !== undefined && isMaskEcho(submittedSecret)
      if (secretIsMaskEcho && !storedSecret) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Client secret looks like a masked placeholder — paste the real secret.',
        })
      }
      const oauth2ClientSecret =
        storedSecret &&
        (submittedSecret === undefined || submittedSecret === '' || secretIsMaskEcho)
          ? storedSecret
          : submittedSecret
            ? encryptValue(submittedSecret)
            : submittedSecret

      // Prepare data
      const data = {
        developerAccountId: app.developerAccountId,
        appId: input.appId,
        major: input.version,
        global: input.global,
        connectionType: input.connectionType,
        label: input.label,
        description: input.description,
        oauth2AuthorizeUrl: input.oauth2AuthorizeUrl,
        oauth2AccessTokenUrl: input.oauth2AccessTokenUrl,
        oauth2ClientId: input.oauth2ClientId
          ? encryptValue(input.oauth2ClientId)
          : input.oauth2ClientId,
        oauth2ClientSecret,
        oauth2Scopes: input.oauth2Scopes || [],
        oauth2TokenRequestAuthMethod: input.oauth2TokenRequestAuthMethod || 'request-body',
        oauth2RefreshTokenIntervalSeconds: input.oauth2RefreshTokenIntervalSeconds,
        oauth2Features: input.oauth2Features ?? {},
        createdById: ctx.session.userId,
      }

      let result
      if (existing) {
        // Update existing connection
        const [updated] = await ctx.db
          .update(ConnectionDefinition)
          .set({
            ...data,
            updatedAt: new Date(),
          })
          .where(eq(ConnectionDefinition.id, existing.id))
          .returning()

        result = updated
      } else {
        // Create new connection
        const [created] = await ctx.db.insert(ConnectionDefinition).values(data).returning()

        result = created
      }

      await invalidateOrgsByAppId(input.appId, ctx.db)

      return result ? redactConnection(result) : result
    }),

  /**
   * Return the decrypted client secret — plaintext, once, on explicit user action
   * ("dev lost the secret" recovery). Platform-level audit row (connection definitions
   * belong to developer accounts, not orgs); the reveal fails if the audit write fails.
   */
  revealClientSecret: protectedProcedure
    .input(
      z.object({
        appId: z.string(),
        version: z.number(),
        global: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const app = await getAppForMember(ctx.db, input.appId, ctx.session.userId)

      const [connection] = await ctx.db
        .select()
        .from(ConnectionDefinition)
        .where(
          and(
            eq(ConnectionDefinition.appId, input.appId),
            eq(ConnectionDefinition.major, input.version),
            eq(ConnectionDefinition.global, input.global)
          )
        )
        .limit(1)

      if (!connection?.oauth2ClientSecret) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No client secret is stored' })
      }

      const audit = await recordAudit({
        organizationId: null,
        category: 'security',
        action: AUDIT_ACTIONS.connectionClientSecretRevealed,
        actorType: 'user',
        actorId: ctx.session.userId,
        targetType: 'connectionDefinition',
        targetId: connection.id,
        metadata: { appId: input.appId, developerAccountId: app.developerAccountId },
      })
      // An unauditable reveal is the thing this mutation exists to prevent.
      if (audit.isErr()) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Could not record the audit entry — secret not revealed.',
        })
      }

      return { clientSecret: decryptValue(connection.oauth2ClientSecret) }
    }),
})
