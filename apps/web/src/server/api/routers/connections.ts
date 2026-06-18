// apps/web/src/server/api/routers/connections.ts

import { saveConnection } from '@auxx/lib/connections'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { createTRPCRouter, notDemo, protectedProcedure } from '~/server/api/trpc'

/**
 * Platform-provider connections (the third owner). OAuth connects run through the
 * `/api/connections/[connectionDefinitionId]/oauth2/*` routes; this router covers the
 * non-OAuth *secret* connect — a single API key, or a multi-field `connectionVariables`
 * form — persisting via the unified `saveConnection`.
 */
export const connectionsRouter = createTRPCRouter({
  saveSecret: protectedProcedure
    .input(
      z.object({
        /** ConnectionDefinition id or platform providerKey (resolved either way). */
        connectionDefinitionId: z.string().min(1),
        /** Display name for the credential. */
        name: z.string().min(1),
        /** Multi-field connection-variable values (split by the def's secret flags). */
        values: z.record(z.string(), z.string()).optional(),
        /** Single API-key value (for definitions without connection variables). */
        secret: z.string().optional(),
        /** Reconnect: rotate the existing credential instead of inserting. */
        connectionId: z.string().optional(),
      })
    )
    .use(notDemo('save connection'))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.defaultOrganizationId
      if (!organizationId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No organization selected' })
      }

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
      // encrypt under `secrets.fields`, plain ones ride in plaintext metadata.
      const secretKeys = new Set(
        (def.connectionVariables ?? []).filter((v) => v.secret).map((v) => v.key)
      )
      const secretFields: Record<string, string> = {}
      const plainVariables: Record<string, string> = {}
      for (const [key, value] of Object.entries(input.values ?? {})) {
        if (secretKeys.has(key)) secretFields[key] = value
        else plainVariables[key] = value
      }

      const result = await saveConnection({
        connectionDefinitionId: def.id,
        providerKey: def.providerKey,
        name: input.name,
        organizationId,
        createdById: ctx.session.user.id,
        // Scope follows the definition's `global` flag — the resolver queries the credential by it.
        userId: def.global ? null : ctx.session.user.id,
        connectionData: {
          ...(input.secret && { secret: input.secret }),
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

      return { credentialId: result.value }
    }),
})
