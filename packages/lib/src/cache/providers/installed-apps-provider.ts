// packages/lib/src/cache/providers/installed-apps-provider.ts

import type { CatalogBlock, CatalogTool } from '@auxx/database'
import { schema } from '@auxx/database'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { getBuiltinAuxxInstalledRow } from '../../agents/builtin-installed-row'
import { getRegisteredToolName } from '../../ai/kopilot/capabilities/apps/tool-naming'
import type {
  CachedAction,
  CachedAgentTool,
  CachedBlockOp,
  CachedInstalledApp,
  CachedWorkflowBlock,
} from '../org-cache-keys'
import type { CacheProvider } from '../org-cache-provider'

/**
 * Join each workflow block to the contracts of the tools its `toolMap`
 * dispatches to, from the deployment's **full** `catalog.tools` registry.
 *
 * Why the full registry and not `agent.tools`: block tools carry no agent
 * surface, so they are absent there — the same reason `CachedAction` joins
 * from `catalog.tools`.
 *
 * Why at all: `CatalogBlock` declares no outputs, and the block's own
 * `computeOutputs` is a function that only runs inside the app iframe. The
 * dispatched tool's `outputsJsonSchema` is the only server-readable answer to
 * "what does this node produce". See
 * `plans/kopilot/workflow/17-app-block-authoring-and-connections.md` §2.3/D3.
 *
 * Malformed entries are dropped, never thrown: a dangling tool id or a key
 * that isn't `resource.operation` is an app-authoring mistake, and failing the
 * projection would poison the whole org's `installedApps` cache over one bad
 * block.
 */
export function projectWorkflowBlocks(
  blocks: CatalogBlock[] | undefined,
  tools: CatalogTool[] | undefined
): CachedWorkflowBlock[] | undefined {
  if (!blocks) return undefined
  const toolById = new Map((tools ?? []).map((t) => [t.id, t]))
  return blocks.map((block) => ({
    ...block,
    ops: Object.entries(block.toolMap ?? {}).flatMap<CachedBlockOp>(([key, toolId]) => {
      const tool = toolById.get(toolId)
      if (!tool) return []
      const [resource, operation, ...rest] = key.split('.')
      if (!resource || !operation || rest.length > 0) return []
      return [
        {
          key,
          resource,
          operation,
          toolId,
          inputsJsonSchema: tool.inputsJsonSchema,
          outputsJsonSchema: tool.outputsJsonSchema,
          requiresConnection: tool.requiresConnection,
          ...(tool.exampleOutput !== undefined ? { exampleOutput: tool.exampleOutput } : {}),
        },
      ]
    }),
  }))
}

/**
 * Computes installed apps with connection definitions for an organization.
 *
 * Extended for the app surface bridge (decision B2 in
 * `plans/kopilot/agents/tool-loading-and-execution.md` §3):
 * each row carries surface projections from the deployment's static catalog
 * (`agentTools`, `agentToolsets`, `agentTriggers`, `workflowBlocks`,
 * `workflowTriggers`, `actions`) plus a denormalized `orgConnectionPresent` /
 * `orgConnectionExpiresAt` via a left join on
 * `Credential WHERE userId IS NULL`. User-scope presence stays a
 * per-request direct DB hit (decision G2).
 */
export const installedAppsProvider: CacheProvider<CachedInstalledApp[]> = {
  async compute(orgId, db) {
    // 1. Query installations with relations (same query as getInstalledApps)
    const installations = await db.query.AppInstallation.findMany({
      where: (t, { eq, and, isNull }) => and(eq(t.organizationId, orgId), isNull(t.uninstalledAt)),
      with: {
        app: true,
        currentDeployment: {
          with: { clientBundle: true, serverBundle: true },
        },
      },
      orderBy: (t, { desc }) => desc(t.installedAt),
    })

    // 2. Batch-fetch connection definitions for all installed app IDs
    //    Replaces the N+1 getAppConnectionDefinition pattern
    const appIds = installations.map((i) => i.app.id)
    const connectionDefs =
      appIds.length > 0
        ? await db.query.ConnectionDefinition.findMany({
            where: (t, { inArray }) => inArray(t.appId, appIds),
            columns: {
              id: true,
              key: true,
              appId: true,
              label: true,
              description: true,
              global: true,
              connectionType: true,
              oauth2Features: true,
              connectionVariables: true,
              // Own-client gate (§3.1): a pending-verification platform client lets the app
              // offer platform-login OR bring-your-own client.
              oauth2ClientId: true,
              oauth2ClientSecret: true,
              platformClientApproved: true,
            },
          })
        : []

    // 2b. Org-scope connection presence — single batched query per
    //     decision B2 + G2. User-scope stays a per-request direct hit.
    const orgConnectionRows =
      appIds.length > 0
        ? await db
            .select({
              appId: schema.Credential.appId,
              expiresAt: schema.Credential.expiresAt,
            })
            .from(schema.Credential)
            .where(
              and(
                inArray(schema.Credential.appId, appIds),
                eq(schema.Credential.organizationId, orgId),
                isNull(schema.Credential.userId),
                eq(schema.Credential.kind, 'app')
              )
            )
        : []
    const orgConnByAppId = new Map<string, { present: boolean; expiresAt: Date | null }>()
    for (const row of orgConnectionRows) {
      if (!row.appId) continue
      orgConnByAppId.set(row.appId, { present: true, expiresAt: row.expiresAt })
    }

    // Index by appId, keeping both scopes. global === false → user, global === true → organization.
    const connDefsByAppId = new Map<
      string,
      { user?: (typeof connectionDefs)[0]; organization?: (typeof connectionDefs)[0] }
    >()
    // Full method list per app (the authoritative axis — the picker renders from this).
    const methodsByAppId = new Map<string, (typeof connectionDefs)[0][]>()
    for (const def of connectionDefs) {
      if (!def.appId) continue
      const existing = connDefsByAppId.get(def.appId) ?? {}
      if (def.global) existing.organization = def
      else existing.user = def
      connDefsByAppId.set(def.appId, existing)
      const list = methodsByAppId.get(def.appId) ?? []
      list.push(def)
      methodsByAppId.set(def.appId, list)
    }

    // 3. Build serializable output. Prepend the synthetic built-in `auxx`
    //    row so the client receives the same merged tree the server used to
    //    ship via `agentToolset.list`. See
    //    plans/kopilot/agents/tools/project-builtin-auxx-into-installations.md.
    const thirdPartyRows = installations.map((inst) => {
      // Pre-resolve per-tool icon cascade once per app: toolset.iconKey →
      // app.avatarUrl → 'package'. Same cascade as the admin tools tree
      // (packages/lib/src/agents/toolset-catalog.ts:276-288) so the kopilot
      // pill matches what users see in settings.
      const appIconId = inst.app.avatarUrl ?? 'package'
      const toolsetIconBySlug = new Map(
        (inst.currentDeployment?.catalog?.agent.toolsets ?? []).map(
          (ts) => [ts.slug, ts.iconKey] as const
        )
      )
      const agentTools: CachedAgentTool[] | undefined =
        inst.currentDeployment?.catalog?.agent.tools.map((t) => ({
          ...t,
          registeredName: getRegisteredToolName(inst.app.slug, t.id),
          iconId: toolsetIconBySlug.get(t.toolsetSlug) ?? appIconId,
        })) ?? undefined

      // Join action → tool inputs from the FULL tool registry (`catalog.tools`),
      // not `agent.tools`: action-only tools have no agent surface and so aren't
      // in `agent.tools`. The quick-action form keys off `inputsJsonSchema`.
      const toolInputsById = new Map(
        (inst.currentDeployment?.catalog?.tools ?? []).map((t) => [t.id, t.inputsJsonSchema])
      )
      const actions: CachedAction[] | undefined = inst.currentDeployment?.catalog?.actions.map(
        (a) => ({ ...a, inputsJsonSchema: toolInputsById.get(a.toolId) ?? {} })
      )

      const workflowBlocks = projectWorkflowBlocks(
        inst.currentDeployment?.catalog?.workflow.blocks,
        inst.currentDeployment?.catalog?.tools
      )

      return {
        installationId: inst.id,
        installationType: inst.installationType as 'development' | 'production',
        installedAt: inst.installedAt.toISOString(),
        app: {
          id: inst.app.id,
          slug: inst.app.slug,
          title: inst.app.title,
          description: inst.app.description,
          avatarUrl: inst.app.avatarUrl,
          category: inst.app.category,
        },
        currentDeployment: inst.currentDeployment
          ? {
              id: inst.currentDeployment.id,
              version: inst.currentDeployment.version,
              deploymentType: inst.currentDeployment.deploymentType,
              status: inst.currentDeployment.status,
              clientBundleSha: inst.currentDeployment.clientBundle.sha256,
              serverBundleSha: inst.currentDeployment.serverBundle.sha256,
              createdAt: inst.currentDeployment.createdAt.toISOString(),
            }
          : null,
        // The own-client gate is deliberately NOT resolved here. It depends on the org's
        // `byoOAuthClient` feature, and a cache-compute path must not read the org cache;
        // baking an org-dependent gate would also go stale, because `plan.changed`
        // invalidates `features` but not `installedApps`. So the blob carries the RAW
        // variables plus the three gate inputs, and `apps.listInstalled` gates on the way
        // out — the same read-time shape the limited-use provider gate uses.
        methods: (methodsByAppId.get(inst.app.id) ?? []).map((def) => ({
          id: def.id,
          key: def.key,
          label: def.label,
          description: def.description,
          connectionType: def.connectionType,
          global: def.global ?? false,
          connectionVariables: def.connectionVariables ?? [],
          oauth2ClientId: def.oauth2ClientId,
          oauth2ClientSecret: def.oauth2ClientSecret,
          platformClientApproved: def.platformClientApproved,
        })),
        connectionDefinitions: (() => {
          const defs = connDefsByAppId.get(inst.app.id) ?? {}
          const toCached = (def: (typeof connectionDefs)[0] | undefined) =>
            def
              ? {
                  label: def.label,
                  description: def.description,
                  global: def.global,
                  connectionType: def.connectionType,
                  oauth2Features: def.oauth2Features as Record<string, unknown> | null,
                  connectionVariables: def.connectionVariables ?? [],
                }
              : undefined
          return {
            user: toCached(defs.user),
            organization: toCached(defs.organization),
          }
        })(),
        agentTools,
        agentToolsets: inst.currentDeployment?.catalog?.agent.toolsets ?? undefined,
        agentTriggers: inst.currentDeployment?.catalog?.agent.triggers ?? undefined,
        workflowBlocks,
        workflowTriggers: inst.currentDeployment?.catalog?.workflow.triggers ?? undefined,
        actions,
        dataConnectors: inst.currentDeployment?.catalog?.dataConnectors ?? undefined,
        orgConnectionPresent: orgConnByAppId.get(inst.app.id)?.present ?? false,
        orgConnectionExpiresAt: orgConnByAppId.get(inst.app.id)?.expiresAt?.toISOString() ?? null,
      }
    })

    return [getBuiltinAuxxInstalledRow(), ...thirdPartyRows]
  },
}
