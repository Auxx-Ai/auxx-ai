// apps/web/src/server/api/routers/connections.ts

import { isMasked, projectCredentialForEdit, splitConnectionValues } from '@auxx/credentials/crypto'
import {
  deleteCredential,
  listCredentials,
  mergeSecrets,
  revealSecrets,
  splitSensitiveFields,
  updateCredential,
} from '@auxx/credentials/store'
import { getOrgCache } from '@auxx/lib/cache'
import {
  gateConnectionVariables,
  mintClientCredentialToken,
  NO_OWN_CLIENT_GATE,
  providerOAuthCallbackUrl,
  refreshCredentialTokens,
  resolveOwnClientGateForOrg,
  runPostConnectHook,
  saveConnection,
} from '@auxx/lib/connections'
import { getAllProviders, getProviderByKey } from '@auxx/lib/connections/providers'
import { isAdminOrOwner } from '@auxx/lib/members'
import { getChannelProviderIcon } from '@auxx/lib/providers'
import { CredentialTestingService, isCredentialInUse } from '@auxx/lib/workflow-engine'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { createTRPCRouter, notDemo, protectedProcedure } from '~/server/api/trpc'

/** The credential families (mirrors `CredentialKind` in @auxx/credentials). */
const credentialKindSchema = z.enum(['app', 'mcp', 'connection'])

/**
 * Consecutive refresh failures at which a connection's circuit breaker is "open"
 * — mirrors `CONNECTION_CIRCUIT_OPEN_THRESHOLD` in
 * `@auxx/services/app-connections`. At or above this, the credential surfaces as
 * `expired` so a uniform status applies across every kind.
 */
const CONNECTION_CIRCUIT_OPEN_THRESHOLD = 5

/**
 * The single connection surface over the `Credential` table. Covers listing,
 * the non-OAuth *secret* connect (a single API key or a multi-field
 * `connectionVariables` form), editing, deleting, testing, and token refresh.
 * OAuth connects run through `/api/connections/[connectionDefinitionId]/oauth2/*`.
 */
export const connectionsRouter = createTRPCRouter({
  /**
   * Lists connections across kinds (`app | mcp | connection`). Default
   * (no input) — the Settings → Channels → Connections card grid: admins see all
   * org connections; members see their own + org-scoped ones. With input, the
   * picker narrows by `kind`/`type` and can force org-scoped rows only.
   */
  list: protectedProcedure
    .input(
      z
        .object({
          type: z.string().optional().describe('Filter by provider type'),
          /** Connection family/families to list. Defaults to all bindable kinds. */
          kind: z
            .union([credentialKindSchema, credentialKindSchema.array().min(1)])
            .optional()
            .describe('Filter by connection family'),
          /**
           * When true, only org-scoped (workspace) connections are returned —
           * personal/user-scoped rows are excluded. Background resources like data
           * connectors must bind org-scoped connections so they don't break for
           * other users.
           */
          orgScopedOnly: z.boolean().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      // Scope/visibility selection: determining what credentials to return (plan 21 §5.2).
      const isAdmin = await isAdminOrOwner(organizationId, ctx.session.user.id)
      const result = await listCredentials({
        organizationId,
        kind: input?.kind ?? ['app', 'mcp', 'connection'],
        type: input?.type,
        // `orgScopedOnly` forces `userId: null`; otherwise apply member visibility —
        // admins see everything, members see their own + org-scoped rows.
        ...(input?.orgScopedOnly
          ? { userId: null }
          : isAdmin
            ? {}
            : { ownedByOrOrgScoped: ctx.session.user.id }),
        withCreatedBy: true,
      })
      if (result.isErr()) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.error.message })
      }

      // Channels bind a connection credential — flag those rows so the UI can disable delete.
      // Sourced from the `channels` org cache (no extra query); keyed by the credential FK.
      const channels = await getOrgCache().get(organizationId, 'channels')
      // One credential can back MANY channels — a Quo (OpenPhone) API key is workspace-scoped
      // and every phone number on it becomes its own channel. A plain `new Map(...)` keyed by
      // credentialId silently collapses those to whichever came last, so group instead and
      // report the count alongside a representative row.
      const channelsByCred = new Map<string, typeof channels>()
      for (const c of channels) {
        if (!c.credentialId) continue
        const bucket = channelsByCred.get(c.credentialId)
        if (bucket) bucket.push(c)
        else channelsByCred.set(c.credentialId, [c])
      }

      // MCP rows are owned by `mcpServerId` (no provider `type`/`providerKey`), so their brand
      // mark lives on the `McpServer` row, not the platform catalog. Source it from the
      // `mcpServers` org cache and key by server id.
      const mcpServers = await getOrgCache().get(organizationId, 'mcpServers')
      const mcpByServer = new Map(mcpServers.map((s) => [s.serverId, s]))

      const now = new Date()
      return result.value.map((record) => {
        const boundChannels = channelsByCred.get(record.id)
        const channel = boundChannels?.[0]
        const mcpServer = record.mcpServerId ? mcpByServer.get(record.mcpServerId) : undefined
        const expired =
          record.consecutiveRefreshFailures >= CONNECTION_CIRCUIT_OPEN_THRESHOLD ||
          (record.expiresAt !== null && record.expiresAt < now)
        return {
          id: record.id,
          name: record.name,
          type: record.type ?? '',
          kind: record.kind,
          label: record.label,
          // Visual-ref for non-app rows. MCP rows resolve their brand mark from the owning
          // server's icon (they carry no provider `type`). Channel creds use a
          // ChannelProviderType ('google', 'outlook', …); platform integration creds (incl. AI
          // keys like 'openaiApi') use a providerKey, whose icon lives on the platform provider
          // catalog. App rows leave this null and hydrate the app's avatar client-side.
          icon: mcpServer
            ? (mcpServer.icon?.iconId ?? null)
            : record.type
              ? (getChannelProviderIcon(record.type) ??
                getProviderByKey(record.type)?.uiMetadata?.icon ??
                null)
              : null,
          appId: record.appId,
          appInstallationId: record.appInstallationId,
          // MCP rows surface their server id so the grid can drive the MCP connect/reconnect flow.
          mcpServerId: record.mcpServerId,
          connectionDefinitionId: record.connectionDefinitionId,
          scope: record.userId ? ('user' as const) : ('organization' as const),
          status: expired ? ('expired' as const) : ('connected' as const),
          createdAt: record.createdAt,
          // Fresh-connect verify polls for a new id; reconnect verify watches this stamp move.
          updatedAt: record.updatedAt,
          createdBy: { name: record.createdByName },
          // Set when a channel binds this credential — the UI disables delete and shows an "In use"
          // badge. Deleting would orphan the channel (FK is set-null), so block it here too.
          usedByChannel: channel ? { provider: channel.provider, email: channel.email } : null,
          // How many channels bind this credential. `usedByChannel` names only the first —
          // a workspace-scoped key (Quo) legitimately backs one channel per phone number, and
          // the delete guard's message counts all of them.
          channelCount: boundChannels?.length ?? 0,
        }
      })
    }),

  /**
   * Client-safe projection of the platform provider catalog (`getAllProviders()`)
   * for the "+ New connection" dialog. Each entry feeds `useConnectFlow` as a
   * `platform` owner — its `connectionDefinitionId` is the `providerKey` (the
   * OAuth route + `save` resolve a providerKey as the id).
   */
  listProviders: protectedProcedure.query(async ({ ctx }) => {
    const { organizationId } = ctx.session
    // The approval gate (§3.1) is DB-derived: a platform client is "present" only if its
    // env was set at seed time (column non-blank), and `platformClientApproved` carries
    // the verification flag. Join the catalog (icons/labels) with the platform
    // ConnectionDefinition rows so the connect dialog can require BYO client up-front.
    const defRows = await ctx.db.query.ConnectionDefinition.findMany({
      where: (cd, { isNotNull }) => isNotNull(cd.providerKey),
      columns: {
        providerKey: true,
        oauth2ClientId: true,
        oauth2ClientSecret: true,
        platformClientApproved: true,
      },
    })
    // Org-aware: `byoOAuthClient` can offer BYO on top of a verified platform client.
    // Resolved per row but the feature read behind it is one cached org lookup, not N.
    const gateByKey = new Map(
      await Promise.all(
        defRows.map(
          async (d) =>
            [
              d.providerKey as string,
              await resolveOwnClientGateForOrg(organizationId, {
                oauth2ClientId: d.oauth2ClientId,
                oauth2ClientSecret: d.oauth2ClientSecret,
                platformClientApproved: d.platformClientApproved,
              }),
            ] as const
        )
      )
    )
    return getAllProviders().map((p) => {
      // The BYO-client gate is an authorization-code concept (platform redirect app +
      // approval). Secret/client-credentials defs have no platform OAuth client, so the
      // gate would wrongly read as `no-platform-client` — only consult it for oauth2-code.
      const gate =
        p.connectionType === 'oauth2-code'
          ? (gateByKey.get(p.providerKey) ?? NO_OWN_CLIENT_GATE)
          : NO_OWN_CLIENT_GATE
      const { requiresOwnClient, ownClientOptional } = gate
      return {
        providerKey: p.providerKey,
        label: p.label,
        description: p.description ?? null,
        connectionType: p.connectionType,
        global: p.global ?? false,
        // Gate the connect-form variables (§3.1): for OAuth providers, drop the optional
        // BYO client fields when the platform client is usable (→ one-click connect), force
        // them required when the connection must bring its own, and keep-but-optional when
        // the platform client is pending approval (user may try platform login OR BYO). The
        // server reads the ungated def for the authorize/callback exchange — this only
        // shapes the UI form.
        connectionVariables: gateConnectionVariables(
          p.connectionType,
          p.connectionVariables ?? [],
          {
            requiresOwnClient,
            ownClientOptional,
          }
        ),
        icon: p.uiMetadata?.icon ?? null,
        category: p.uiMetadata?.category ?? null,
        // OAuth-only: whether this connection must bring its own client id/secret, whether
        // BYO is offered as an optional alternative, and why. `false`/`null` for non-OAuth
        // providers (no DB gate) and secret defs.
        requiresOwnClient,
        ownClientOptional,
        ownClientReason: gate.reason,
        // Server-built so a BYO user can register it in their own OAuth app.
        oauthCallbackUrl:
          p.connectionType === 'oauth2-code'
            ? providerOAuthCallbackUrl({ providerKey: p.providerKey })
            : null,
      }
    })
  }),

  /**
   * Load a connection's values for the edit/reconnect form, masked so no secret ever leaves the
   * server. Projects **strictly** through the resolved ConnectionDefinition's `connectionVariables`:
   * plain vars come back real, secret vars come back as the `HIDDEN_VALUE` sentinel when set (a
   * boolean "is set" marker, never the value), and any key not declared as a user variable
   * (`accessToken`, `refreshToken`, `client_id`, `client_secret`, …) is structurally excluded.
   *
   * Bare API-key connections (no connection variables, definition-backed or not) return only
   * `tokenSet` — whether any secret is stored — so the form can show "saved" without re-prompting.
   */
  getForEdit: protectedProcedure
    .input(z.object({ connectionId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      const revealed = await revealSecrets<Record<string, unknown>>(
        input.connectionId,
        organizationId
      )
      if (revealed.isErr()) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Connection not found' })
      }
      const { record, secrets } = revealed.value

      // Resolve the definition by FK first, then by provider key (Credential.type). Definition-less
      // connections (plain integration/workflow secrets) have neither and fall through to the
      // bare-secret branch — never run an unfiltered findFirst that would match an arbitrary def.
      const def =
        record.connectionDefinitionId || record.type
          ? await ctx.db.query.ConnectionDefinition.findFirst({
              where: (cd, { eq, or }) =>
                record.connectionDefinitionId
                  ? eq(cd.id, record.connectionDefinitionId)
                  : or(eq(cd.id, record.type as string), eq(cd.providerKey, record.type as string)),
            })
          : null

      const vars = def?.connectionVariables ?? []
      if (vars.length > 0) {
        // Multi-field: project through declared variables only. Plain values live in
        // `metadata.connectionVariables`; secret presence in the nested `secrets.fields` bag.
        const metadata = (record.metadata ?? {}) as Record<string, unknown>
        const plainVars = (metadata.connectionVariables ?? {}) as Record<string, unknown>
        const secretFields = (secrets.fields ?? {}) as Record<string, unknown>
        const values = projectCredentialForEdit(vars, { plain: plainVars, secrets: secretFields })
        return { values, tokenSet: false }
      }

      // Bare API-key (or definition-less): report only whether some secret is stored — a boolean,
      // never a value. Covers both `secrets.secret` and the legacy by-name `secrets.<apiKey>` shape.
      const tokenSet = Object.values(secrets).some(
        (v) =>
          v != null &&
          (typeof v !== 'object' || Object.keys(v as Record<string, unknown>).length > 0)
      )
      return { values: {} as Record<string, string>, tokenSet }
    }),

  /**
   * Persists a non-OAuth secret connection (a single API key, or a multi-field
   * `connectionVariables` form) via the unified `saveConnection`. Supports
   * reconnect by rotating an existing credential.
   */
  save: protectedProcedure
    .input(
      z.object({
        /** ConnectionDefinition id or platform providerKey (resolved either way). */
        connectionDefinitionId: z.string().min(1),
        /** Display name for the connection. */
        name: z.string().min(1),
        /** Multi-field connection-variable values (split by the def's secret flags). */
        values: z.record(z.string(), z.string()).optional(),
        /** Single API-key value (for definitions without connection variables). */
        secret: z.string().optional(),
        /** Reconnect: rotate the existing credential instead of inserting. */
        connectionId: z.string().optional(),
        /**
         * Opaque post-connect context handed to the provider's hook as `ctx.extra`. The OAuth
         * flow carries this via `pc_*` params; secret connections (e.g. channels-v2 inbox-first
         * Quo) route it through here instead. Channels use `{ inboxId }`.
         */
        postConnect: z.record(z.string(), z.string()).optional(),
      })
    )
    .use(notDemo('save connection'))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      const def = await ctx.db.query.ConnectionDefinition.findFirst({
        where: (cd, { eq, or }) =>
          or(
            eq(cd.id, input.connectionDefinitionId),
            eq(cd.providerKey, input.connectionDefinitionId)
          ),
      })
      if (!def?.providerKey) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Connection definition not found' })
      }

      // Split the provided values by the definition's secret flags: secret-flagged values
      // encrypt under `secrets.fields`, plain ones ride in plaintext metadata. `resolveForWrite`
      // drops any masked echo (an unchanged secret submitted as the `HIDDEN_VALUE` sentinel) so the
      // edit/reconnect merge keeps the stored value instead of overwriting it.
      const { secretFields, plainVariables } = splitConnectionValues(
        def.connectionVariables ?? [],
        input.values ?? {}
      )
      // Bare API-key definitions (no connection variables): drop an unchanged sentinel the same way.
      const secret =
        input.secret !== undefined && !isMasked(input.secret) ? input.secret : undefined

      const result = await saveConnection({
        connectionDefinitionId: def.id,
        providerKey: def.providerKey,
        name: input.name,
        organizationId,
        createdById: ctx.session.user.id,
        // Scope follows the definition's `global` flag — the resolver queries the credential by it.
        userId: def.global ? null : ctx.session.user.id,
        connectionData: {
          ...(secret && { secret }),
          ...(Object.keys(secretFields).length > 0 && { secretFields }),
          ...(Object.keys(plainVariables).length > 0 && {
            metadata: { connectionVariables: plainVariables },
          }),
        },
        ...(input.connectionId && { connectionId: input.connectionId }),
      })

      if (result.isErr()) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.error.message })
      }

      // Connection test for the no-browser grant: mint once now so a bad client id/secret
      // surfaces immediately rather than on first runtime use (mirrors the oauth2 flow's
      // validate-on-connect). The minted token is cached on the credential for reuse.
      if (def.connectionType === 'client-credentials') {
        const minted = await mintClientCredentialToken(result.value, organizationId)
        if (!minted.success) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Couldn't authenticate with these credentials: ${minted.error ?? 'mint failed'}`,
          })
        }
      }

      // Domain provisioning after the credential commits — mirrors the oauth2 callback's
      // post-connect hook for secret connections. No-op unless a hook is registered for the
      // providerKey (only channel secret providers like `openphone` register one); a hook
      // throwing surfaces as the save error (the credential is already committed).
      await runPostConnectHook(def.providerKey, {
        credentialId: result.value,
        providerKey: def.providerKey,
        organizationId,
        userId: ctx.session.user.id,
        ...(input.connectionId && { connectionId: input.connectionId }),
        ...(input.postConnect && { extra: input.postConnect }),
      })

      return { credentialId: result.value }
    }),

  /**
   * Update a connection's name and/or data.
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1, 'Connection ID is required'),
        name: z.string().min(1).optional(),
        label: z.string().min(1).optional(),
        data: z.record(z.string(), z.any()).optional(),
      })
    )
    .use(notDemo('update connection'))
    .mutation(async ({ ctx, input }) => {
      if (!input.name && !input.label && !input.data) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'At least one field (name, label, or data) must be provided for update',
        })
      }

      const { organizationId } = ctx.session
      const split: { secrets: Record<string, unknown>; metadata?: Record<string, unknown> } =
        input.data ? splitSensitiveFields(input.data) : { secrets: {} }
      const { secrets, metadata } = split

      // Drop any masked echo (an unchanged secret submitted as the `HIDDEN_VALUE` sentinel) so it's
      // never written as a literal — mergeSecrets then keeps the existing stored value.
      for (const [key, value] of Object.entries(secrets)) {
        if (typeof value === 'string' && isMasked(value)) delete secrets[key]
      }

      const updateResult = await updateCredential(input.id, organizationId, {
        name: input.name,
        label: input.label,
        metadata,
      })
      if (updateResult.isErr()) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: updateResult.error.message })
      }

      // mergeSecrets keeps existing values for blank fields, so an edit form that
      // leaves a password empty never wipes the stored secret.
      if (Object.keys(secrets).length > 0) {
        const mergeResult = await mergeSecrets(input.id, organizationId, secrets)
        if (mergeResult.isErr()) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: mergeResult.error.message })
        }
      }

      return { success: true }
    }),

  /**
   * Delete a connection (errors if it's in use in workflows).
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string().min(1, 'Connection ID is required') }))
    .use(notDemo('delete connection'))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      if (await isCredentialInUse(input.id, organizationId)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Cannot delete connection: it is currently being used in workflows',
        })
      }

      // Channels binding this credential would be orphaned by the delete (`Integration.credentialId`
      // is `onDelete: 'set null'`), losing their only token source. Block it — disconnect the
      // channels first. Sourced from the `channels` org cache, which already excludes soft-deleted
      // rows, so the count is exactly the live dependents.
      //
      // The count is named on purpose: one credential can now back MANY channels (a Quo workspace
      // key covers every phone number on it, one Integration per number), so "it is in use by a
      // channel" would understate what the delete is about to break. Generic over providers — the
      // 1:N case is just where it stops being self-evident.
      const channels = await getOrgCache().get(organizationId, 'channels')
      const dependents = channels.filter((c) => c.credentialId === input.id)
      if (dependents.length > 0) {
        throw new TRPCError({
          code: 'CONFLICT',
          message:
            dependents.length === 1
              ? 'Cannot delete connection: 1 channel depends on it. Disconnect that channel first.'
              : `Cannot delete connection: ${dependents.length} channels depend on it. Disconnect them first.`,
        })
      }

      const result = await deleteCredential(input.id, organizationId)
      if (result.isErr()) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.error.message })
      }

      return { success: true }
    }),

  /**
   * Test a connection against its external service. Pass `credentialId` to test
   * a saved connection, or `type` + `data` to validate prospective values before
   * saving.
   */
  test: protectedProcedure
    .input(
      z.object({
        credentialId: z.string().min(1).optional(),
        type: z.string().min(1).optional(),
        data: z.record(z.string(), z.any()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      try {
        if (input.credentialId) {
          return await CredentialTestingService.testCredential(input.credentialId, organizationId)
        }
        if (input.type && input.data) {
          return await CredentialTestingService.testCredentialData(
            input.type,
            input.data,
            organizationId
          )
        }
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Provide either credentialId, or type and data',
        })
      } catch (error) {
        if (error instanceof TRPCError) throw error
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to test connection',
        })
      }
    }),

  /**
   * Refresh OAuth2 tokens for a connection.
   */
  refreshTokens: protectedProcedure
    .input(z.object({ credentialId: z.string().min(1, 'Connection ID is required') }))
    .use(notDemo('refresh connection tokens'))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      try {
        const result = await refreshCredentialTokens(input.credentialId, organizationId)
        if (!result.success) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to refresh tokens',
          })
        }
        return { success: true }
      } catch (error) {
        if (error instanceof TRPCError) throw error
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to refresh tokens',
        })
      }
    }),
})
