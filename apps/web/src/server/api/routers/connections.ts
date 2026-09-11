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
import type { Database } from '@auxx/database'
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
import { PermissionKey, requirePermission } from '@auxx/lib/permissions'
import { getChannelProviderIcon } from '@auxx/lib/providers'
import { CredentialTestingService, isCredentialInUse } from '@auxx/lib/workflow-engine'
import { parseGrantedScopes } from '@auxx/services/app-connections'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import {
  capabilityProcedure,
  createTRPCRouter,
  notDemo,
  protectedProcedure,
} from '~/server/api/trpc'

/** The credential families (mirrors `CredentialKind` in @auxx/credentials). */
const credentialKindSchema = z.enum(['app', 'mcp', 'connection'])

/**
 * Connection-scope gate, one credential at a time — the twin of
 * `requireConnectionManageAccess` in `routers/apps.ts` and the only place this
 * router decides who may touch a given row.
 *
 * **Ownership first, key second, in both directions.** A user-scoped credential
 * (`Credential.userId` set) is its owner's regardless of capability, so the
 * owner short-circuits before either key is consulted; that carve-out is what
 * lets a member keep their own OAuth accounts on a profile that closes
 * `Area.integrations` entirely (plan 21 §5.2, and `Area.integrations`'s note in
 * the capability registry). Org-scoped rows (`userId IS NULL`) gate on the
 * area's own keys: `integrationsView` to read one, `integrationsManage` to
 * change one.
 *
 * A row that does not exist in this org is a 404 rather than a 403 on purpose —
 * the caller learns nothing about another org's ids either way, and the
 * existing surfaces already report a missing connection that way.
 */
async function requireConnectionAccess(
  db: Database,
  session: { userId: string; organizationId: string },
  credentialId: string,
  key: PermissionKey.integrationsView | PermissionKey.integrationsManage
): Promise<void> {
  const credential = await db.query.Credential.findFirst({
    where: (c, { and, eq }) =>
      and(eq(c.id, credentialId), eq(c.organizationId, session.organizationId)),
    columns: { userId: true },
  })
  if (!credential) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Connection not found' })
  }
  if (credential.userId === session.userId) return
  await requirePermission(session.userId, session.organizationId, key)
}

/** Read one connection: own it, or hold `integrationsView`. */
const requireConnectionViewAccess = (
  db: Database,
  session: { userId: string; organizationId: string },
  credentialId: string
) => requireConnectionAccess(db, session, credentialId, PermissionKey.integrationsView)

/** Change one connection: own it, or hold `integrationsManage`. */
const requireConnectionManageAccess = (
  db: Database,
  session: { userId: string; organizationId: string },
  credentialId: string
) => requireConnectionAccess(db, session, credentialId, PermissionKey.integrationsManage)

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
   *
   * **`integrationsView` decides the SCOPE, not admission.** This procedure
   * cannot be a flat `permissionProcedure(integrationsView)`: a member's own
   * user-scoped connections are theirs by the ownership carve-out
   * (`requireConnectionAccess` above), and a 403 here would take them away from
   * a member whose profile closes the area. So the key selects the predicate
   * instead:
   *
   * - holds it (every admin, and every member on the seeded baseline, which
   *   carries `integrations: Read`) — unchanged behaviour: admins see every
   *   row, members see their own plus the org-scoped ones.
   * - lacks it — **own rows only** (`userId = <caller>`), and an
   *   `orgScopedOnly` request composes to the empty list rather than throwing.
   *
   * That last case is the leak this gate closes: before it, `list` was a bare
   * `protectedProcedure` handing `ownedByOrOrgScoped` to everyone, so a
   * contractor on a locked-down profile enumerated every OAuth connection the
   * workspace owns (names, provider types, creators — never secrets, which the
   * projection has always masked).
   *
   * It degrades rather than throws because this one query backs four different
   * surfaces (the settings grid, the workflow/agent connection picker, the data
   * connector binding card, the Quo channel form) and a hard refusal would turn
   * a narrowed profile into an error toast on all of them. An empty picker is
   * the honest answer for someone who may not see workspace connections.
   */
  list: capabilityProcedure
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
      const canSeeOrgScoped = ctx.capabilities.can(PermissionKey.integrationsView)
      // Without the key the caller is confined to rows they own, so an
      // `orgScopedOnly` request (which asks for `userId IS NULL`) can only be
      // the empty set — the two filters are mutually exclusive by construction.
      if (input?.orgScopedOnly && !canSeeOrgScoped) return []

      const isAdmin = await isAdminOrOwner(organizationId, ctx.session.user.id)
      const result = await listCredentials({
        organizationId,
        kind: input?.kind ?? ['app', 'mcp', 'connection'],
        type: input?.type,
        // `orgScopedOnly` forces `userId: null`; otherwise apply member visibility —
        // admins see everything, members with `integrationsView` see their own +
        // org-scoped rows, and members without it see their own and nothing else.
        ...(input?.orgScopedOnly
          ? { userId: null }
          : isAdmin
            ? {}
            : canSeeOrgScoped
              ? { ownedByOrOrgScoped: ctx.session.user.id }
              : { userId: ctx.session.user.id }),
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
          // What the provider actually GRANTED, parsed off `metadata.scope`. Always an array
          // (`[]` when nothing is stored) so the client never branches on absence. Reconnect
          // seeds `scope_add` from this ∩ the definition's optional list, which is what stops
          // a full re-auth from silently downgrading the grant — §4.4/§4.6 of
          // plans/connections/optional-oauth-scopes.md.
          grantedScopes: parseGrantedScopes(record.metadata?.scope),
        }
      })
    }),

  /**
   * Client-safe projection of the platform provider catalog (`getAllProviders()`)
   * for the "+ New connection" dialog. Each entry feeds `useConnectFlow` as a
   * `platform` owner — its `connectionDefinitionId` is the `providerKey` (the
   * OAuth route + `save` resolve a providerKey as the id).
   *
   * **Deliberately left ungated when `integrations.view` was added.** It returns
   * no org data: the catalog is code-native (`providers/defs.ts`), and the only
   * org-derived values are the three BYO-client gate flags, which say whether
   * the PLATFORM's OAuth client is configured and approved and whether this org
   * is entitled to bring its own. Knowing that is not knowing what the workspace
   * has connected. Gating it would break real callers that hold a different
   * key: `channel-gallery-dialog.tsx` and `quo-connect-form.tsx` are channel
   * surfaces reached with `channelsManage`, and an org that runs a mail-admin
   * profile grants that without `Area.integrations`. The rows this catalog
   * describes are still unreachable without the manage key — `save` asserts it
   * for every `global` definition.
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
        // Scope floor + additive optional list, read from the ROW rather than the code-native
        // catalog: the authorize route resolves the definition by id and
        // `resolveRequestedScopes` intersects `scope_add` against THIS row, so a picker built
        // off the catalog could offer a scope the row does not declare and have it dropped
        // silently. The row is a faithful mirror of the def (`ensurePlatformProviders` upserts
        // both columns), but it is the one the server enforces.
        oauth2Scopes: true,
        oauth2OptionalScopes: true,
      },
    })
    const defByKey = new Map(defRows.map((d) => [d.providerKey as string, d]))
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
      const defRow = defByKey.get(p.providerKey)
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
        /** Scope floor — always requested. Joined with the picks for the copyable line. */
        oauth2Scopes: defRow?.oauth2Scopes ?? [],
        /** Additive scopes this provider MAY be asked for. Empty = no picker. */
        oauth2OptionalScopes: defRow?.oauth2OptionalScopes ?? [],
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
   *
   * 🛑 The masking is NOT the access control, and this procedure used to rely on
   * it as if it were. `revealSecrets` scopes by org and nothing else, so before
   * the gate below any member could pass any credential id in the org and read
   * that row's PLAIN `metadata.connectionVariables` — account ids, client ids,
   * hosts, regions, tenant ids — including from another member's personal
   * connection. That is a narrower but strictly worse leak than the listing one,
   * because it needs no listing to exploit: an id from a workflow node is enough.
   */
  getForEdit: protectedProcedure
    .input(z.object({ connectionId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      await requireConnectionViewAccess(
        ctx.db,
        { userId: ctx.session.user.id, organizationId },
        input.connectionId
      )

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

      // Who may mint or rotate this row, decided the same way the app OAuth
      // authorize route decides it (`api/apps/[slug]/oauth2/authorize/route.ts`):
      // scope follows the definition's `global` flag, and only the ORG-SCOPED
      // half needs the key. A reconnect is gated on the target row instead of
      // the definition, because that row's own `userId` is the authority on
      // whose credential is being rotated — and a `global` definition's row is
      // `userId: null`, so the manage key is required there either way.
      if (input.connectionId) {
        await requireConnectionManageAccess(
          ctx.db,
          { userId: ctx.session.user.id, organizationId },
          input.connectionId
        )
      } else if (def.global) {
        await requirePermission(
          ctx.session.user.id,
          organizationId,
          PermissionKey.integrationsManage
        )
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

      await requireConnectionManageAccess(
        ctx.db,
        { userId: ctx.session.user.id, organizationId },
        input.id
      )

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
   * Delete a connection.
   *
   * Refuses while anything still depends on the credential: a workflow using it, a channel
   * bound to it, or a data connector borrowing it. The last two are FK `set null` edges, so
   * the delete would not fail — it would quietly leave a dependent with no token source and,
   * for a bank feed, no way to stop the recurring charge (see the guard's comment below).
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string().min(1, 'Connection ID is required') }))
    .use(notDemo('delete connection'))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      await requireConnectionManageAccess(
        ctx.db,
        { userId: ctx.session.user.id, organizationId },
        input.id
      )

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

      // 🛑 A data connector bound to this credential would be orphaned the same way
      // (`DataConnector.credentialId` is `onDelete: 'set null'`) — and for a bank feed that
      // orphaning costs money forever. `Credential.metadata.providerAccountId` is the ONLY
      // place a Stripe Financial Connections `fca_…` account id lives, and all three release
      // doors in `banking/feed/reaper.ts` reach it by
      // `innerJoin Credential ON DataConnector.credentialId = Credential.id`. Delete the
      // credential from here and the connector survives with a null FK, the account id is
      // gone, no door can ever release the account, and Stripe keeps billing 30c per
      // institution per month, invisibly. That is verbatim the failure `reaper.ts`'s own
      // docblock says the file exists to prevent.
      //
      // Refuse rather than route through the banking teardown: `banking/writes.ts` already
      // owns the correct order — reap at Stripe, then the connector, then the credential only
      // when no sibling connector shares that bank login — and a second implementation of
      // "release, then delete" is how the two come to disagree about which happens first.
      // See plans/accounting/tasks/24-the-company-on-the-entry.md §5.
      const connectors = await ctx.db.query.DataConnector.findMany({
        where: (connector, { and, eq }) =>
          and(eq(connector.organizationId, organizationId), eq(connector.credentialId, input.id)),
        columns: { id: true },
      })
      if (connectors.length > 0) {
        throw new TRPCError({
          code: 'CONFLICT',
          message:
            connectors.length === 1
              ? 'Cannot delete connection: 1 connector depends on it. Remove that connector first.'
              : `Cannot delete connection: ${connectors.length} connectors depend on it. Remove them first.`,
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
   *
   * The `credentialId` form gates on VIEW, not manage: testing spends the stored
   * secret but changes nothing, and the member who binds an org connection into
   * a workflow is exactly who needs to press Test. The `type` + `data` form is
   * ungated because the values are the caller's own, typed into the connect
   * form, and no stored credential is read.
   *
   * 🛑 The assert is deliberately OUTSIDE the `try` below. That block rethrows
   * only `TRPCError`; an `AuxxError` from `requirePermission` would be caught by
   * its `catch` and flattened into a generic 500, turning a 403 into an
   * "internal error" (the `isAuxxError` trap in CLAUDE.md).
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

      if (input.credentialId) {
        await requireConnectionViewAccess(
          ctx.db,
          { userId: ctx.session.user.id, organizationId },
          input.credentialId
        )
      }

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
   *
   * Manage, not view: it rotates the stored token set. Same `try`-placement rule
   * as `test` above — the assert precedes the block that rethrows only
   * `TRPCError`.
   */
  refreshTokens: protectedProcedure
    .input(z.object({ credentialId: z.string().min(1, 'Connection ID is required') }))
    .use(notDemo('refresh connection tokens'))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      await requireConnectionManageAccess(
        ctx.db,
        { userId: ctx.session.user.id, organizationId },
        input.credentialId
      )

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
