// apps/build/src/server/api/routers/connections.ts
// Connections tRPC router

import { decryptValue, encryptValue, isMaskEcho, maskValue } from '@auxx/credentials/crypto'
import {
  App,
  ConnectionDefinition,
  Credential,
  DeveloperAccountMember,
  type database,
} from '@auxx/database'
import { AUDIT_ACTIONS, recordAudit } from '@auxx/lib/audit-log'
import { invalidateOrgsByAppId } from '@auxx/lib/cache'
import { TRPCError } from '@trpc/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'

/** Pure `{var}` templates are config, not secret material — shown unmasked in the form. */
const TEMPLATE_ONLY = /^\{[^}]+\}$/

/** Slugish method key: lowercase letters/digits/underscore, e.g. 'api_key', 'oauth2'. */
const KEY_PATTERN = /^[a-z0-9_]+$/

/** One credential insertion onto an outgoing HTTP request (mirror of `AuthInsertion`). */
const authInsertionSchema = z.discriminatedUnion('in', [
  z.object({ in: z.literal('header'), name: z.string(), format: z.string().optional() }),
  z.object({
    in: z.literal('basic'),
    userField: z.string().optional(),
    passwordField: z.string().optional(),
  }),
  z.object({ in: z.literal('query'), name: z.string(), format: z.string().optional() }),
])

/**
 * How a resolved credential is applied to outgoing HTTP requests (mirror of the
 * `AuthApply` column type): a single insertion (the common case) or a multi-insertion
 * spec with optional constant `headers`. `null` for methods that aren't HTTP-request auth.
 */
const authApplySchema = z.union([
  authInsertionSchema,
  z.object({
    insertions: z.array(authInsertionSchema),
    headers: z.record(z.string(), z.string()).optional(),
  }),
])

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

/** Load a connection definition by id and assert the caller may manage its app. */
async function getConnectionForMember(
  db: typeof database,
  connectionDefinitionId: string,
  userId: string
) {
  const [connection] = await db
    .select()
    .from(ConnectionDefinition)
    .where(eq(ConnectionDefinition.id, connectionDefinitionId))
    .limit(1)

  if (!connection?.appId) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Connection definition not found' })
  }

  const app = await getAppForMember(db, connection.appId, userId)
  return { connection, app }
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

/** Editable method fields shared by create + update (everything except identity: appId/key/major). */
const methodFields = {
  global: z.boolean(),
  connectionType: z.enum(['oauth2-code', 'secret', 'none']),
  label: z.string(),
  description: z.string().optional(),
  oauth2AuthorizeUrl: z.string().optional(),
  oauth2AccessTokenUrl: z.string().optional(),
  oauth2RefreshUrl: z.string().optional(),
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
    })
    .optional(),
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
  // How the resolved credential becomes request auth (null for `none`/non-HTTP methods).
  authApply: authApplySchema.nullable().optional(),
  // Base-URL template the connection contributes to a request origin, interpolated from
  // value + fields at runtime (e.g. 'https://{shop}.myshopify.com').
  baseUrlTemplate: z.string().optional(),
}

const methodFieldsSchema = z.object(methodFields)
type MethodFieldsInput = z.infer<typeof methodFieldsSchema>

/**
 * Resolve the client secret to persist under the write-only contract: the form prefills a mask,
 * so an unchanged field comes back as HIDDEN_VALUE (or the mask itself) — both keep the stored
 * ciphertext rather than corrupting the credential. Blank on an existing row also keeps it.
 */
function resolveClientSecret(submitted: string | undefined, stored: string | null): string | null {
  const isEcho = submitted !== undefined && isMaskEcho(submitted)
  if (isEcho && !stored) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Client secret looks like a masked placeholder — paste the real secret.',
    })
  }
  if (stored && (submitted === undefined || submitted === '' || isEcho)) return stored
  return submitted ? encryptValue(submitted) : (submitted ?? null)
}

/** Map validated method fields → the column values shared by insert + update. */
function toColumnValues(input: MethodFieldsInput, oauth2ClientSecret: string | null) {
  return {
    global: input.global,
    connectionType: input.connectionType,
    label: input.label,
    description: input.description,
    oauth2AuthorizeUrl: input.oauth2AuthorizeUrl,
    oauth2AccessTokenUrl: input.oauth2AccessTokenUrl,
    oauth2RefreshUrl: input.oauth2RefreshUrl,
    oauth2ClientId: input.oauth2ClientId
      ? encryptValue(input.oauth2ClientId)
      : input.oauth2ClientId,
    oauth2ClientSecret,
    oauth2Scopes: input.oauth2Scopes || [],
    oauth2TokenRequestAuthMethod: input.oauth2TokenRequestAuthMethod || 'request-body',
    oauth2RefreshTokenIntervalSeconds: input.oauth2RefreshTokenIntervalSeconds,
    oauth2Features: input.oauth2Features ?? {},
    connectionVariables: input.connectionVariables ?? [],
    // null (not undefined) clears the column on update; `none` methods send null.
    authApply: input.authApply ?? null,
    baseUrlTemplate: input.baseUrlTemplate || null,
  }
}

/**
 * Connections router
 */
export const connectionsRouter = createTRPCRouter({
  /**
   * List all connection methods for an app (one row per method).
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
   * Get one connection method by id.
   */
  get: protectedProcedure
    .input(z.object({ connectionDefinitionId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { connection } = await getConnectionForMember(
        ctx.db,
        input.connectionDefinitionId,
        ctx.session.userId
      )
      return redactConnection(connection)
    }),

  /**
   * Create a new connection method. Identity is (appId, key, major); the partial unique index
   * backstops the friendly guard below.
   */
  create: protectedProcedure
    .input(
      z.object({
        appId: z.string(),
        version: z.number(),
        key: z.string().regex(KEY_PATTERN, 'Use lowercase letters, digits, and underscores'),
        ...methodFields,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const app = await getAppForMember(ctx.db, input.appId, ctx.session.userId)

      const [conflict] = await ctx.db
        .select({ id: ConnectionDefinition.id })
        .from(ConnectionDefinition)
        .where(
          and(
            eq(ConnectionDefinition.appId, input.appId),
            eq(ConnectionDefinition.key, input.key),
            eq(ConnectionDefinition.major, input.version)
          )
        )
        .limit(1)
      if (conflict) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `A connection method with key "${input.key}" already exists for this version.`,
        })
      }

      const oauth2ClientSecret = resolveClientSecret(input.oauth2ClientSecret, null)
      const [created] = await ctx.db
        .insert(ConnectionDefinition)
        .values({
          developerAccountId: app.developerAccountId,
          appId: input.appId,
          key: input.key,
          major: input.version,
          createdById: ctx.session.userId,
          ...toColumnValues(input, oauth2ClientSecret),
        })
        .returning()

      await invalidateOrgsByAppId(input.appId, ctx.db)
      return created ? redactConnection(created) : created
    }),

  /**
   * Update an existing connection method by id. `key`/`appId`/`major` (its identity) are immutable.
   */
  update: protectedProcedure
    .input(
      z.object({
        connectionDefinitionId: z.string(),
        ...methodFields,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { connection } = await getConnectionForMember(
        ctx.db,
        input.connectionDefinitionId,
        ctx.session.userId
      )

      const oauth2ClientSecret = resolveClientSecret(
        input.oauth2ClientSecret,
        connection.oauth2ClientSecret
      )
      const [updated] = await ctx.db
        .update(ConnectionDefinition)
        .set({ ...toColumnValues(input, oauth2ClientSecret), updatedAt: new Date() })
        .where(eq(ConnectionDefinition.id, connection.id))
        .returning()

      await invalidateOrgsByAppId(connection.appId!, ctx.db)
      return updated ? redactConnection(updated) : updated
    }),

  /**
   * Delete a connection method. Blocked while organizations still hold credentials for it —
   * deleting would NULL their FK (onDelete: set null) and strand the runtime resolver (§4a).
   */
  delete: protectedProcedure
    .input(z.object({ connectionDefinitionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { connection } = await getConnectionForMember(
        ctx.db,
        input.connectionDefinitionId,
        ctx.session.userId
      )

      const [inUse] = await ctx.db
        .select({ id: Credential.id })
        .from(Credential)
        .where(eq(Credential.connectionDefinitionId, connection.id))
        .limit(1)
      if (inUse) {
        throw new TRPCError({
          code: 'CONFLICT',
          message:
            'This connection method is in use. Disconnect the organizations using it before deleting.',
        })
      }

      await ctx.db.delete(ConnectionDefinition).where(eq(ConnectionDefinition.id, connection.id))
      await invalidateOrgsByAppId(connection.appId!, ctx.db)
      return { success: true }
    }),

  /**
   * Return the decrypted client secret — plaintext, once, on explicit user action
   * ("dev lost the secret" recovery). Platform-level audit row (connection definitions
   * belong to developer accounts, not orgs); the reveal fails if the audit write fails.
   */
  revealClientSecret: protectedProcedure
    .input(z.object({ connectionDefinitionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { connection, app } = await getConnectionForMember(
        ctx.db,
        input.connectionDefinitionId,
        ctx.session.userId
      )

      if (!connection.oauth2ClientSecret) {
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
        metadata: { appId: connection.appId, developerAccountId: app.developerAccountId },
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
