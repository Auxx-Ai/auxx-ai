// packages/lib/src/ai/kopilot/capabilities/workflow-builder/tools/list-app-connections.ts

import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { workflowToolPermission } from './graph-tool-helpers'
import { resolveWorkflowAuthoring } from './workflow-authoring-guard'

/**
 * The workspace connections an app block can be bound to (plan 17 §7, D1).
 *
 * An app block runs on a connection. Leaving `connectionId` unset is the
 * healthy default — the runtime resolves the workspace's primary credential for
 * the app — so this tool exists for the case where that is not what the user
 * wants: several connections for one app, and a node that must use a specific
 * one. The binding itself needs no tool: `connectionId` is an ordinary
 * top-level config key `update_node` already accepts.
 *
 * **Org-scoped rows only.** A personal credential pinned to a shared graph ties
 * the workflow to one person, and a scheduled run then resolves nothing
 * (`plans/kopilot/apps/workflow-account-selection.md` §2). The canvas is
 * currently WIDER than this — `BasePanel` renders `AppAccountPopover` without
 * `allowPersonal`, whose default is `true`, so a human can already bind a
 * personal credential to a workflow node. That is a pre-existing bug; this tool
 * deliberately does not reproduce it.
 *
 * **Nothing secret crosses this boundary.** `encryptedSecrets` is stripped
 * structurally by `toRecord()` before a `CredentialRecord` exists, and this tool
 * projects a fixed five-field row — `metadata`/`connectionVariables` are NOT
 * forwarded even though they are plaintext, because they carry account emails
 * and shop domains and the agent needs none of it to pick an id. No OAuth URL is
 * minted, returned or described anywhere in this capability.
 *
 * Permission is `view`, not the `edit` §7 proposed. The binding is an edit and
 * goes through `update_node`, which is edit-tier and asserts there; making the
 * *listing* edit-tier would mean a viewer of the workflow gets a thrown
 * `ForbiddenError` for a question every other read tool here answers at `view`.
 * (The dirty-canvas gate is NOT a factor either way — it keys on
 * `opts.mutation`, not on the tier.)
 */
export function createListAppConnectionsTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'list_app_connections',
    permission: workflowToolPermission('view'),
    displayName: 'List app connections',
    surfaces: ['builder'],
    idempotent: true,
    description:
      'List the workspace connections an app block can be bound to, for one app. Take the type from list_app_blocks or a node, or pass the app slug. Bind one with update_node({ config: { connectionId } }) — but only when the user wants a SPECIFIC connection: leaving connectionId unset means the node uses the workspace default, which is normally right. Personal connections are never listed or bindable.',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description:
            "An app block's '<appId>:<blockId>' node type, from list_app_blocks or get_node.",
        },
        appSlug: {
          type: 'string',
          description: "The app's slug (e.g. 'ups'), if you have that instead of a node type.",
        },
      },
      additionalProperties: false,
    },
    buildDigest: (output) => {
      const out = (output ?? {}) as { app?: string; connections?: unknown[] }
      return {
        label: out.app ? `${out.app} connections listed` : 'App connections listed',
        resultCount: Array.isArray(out.connections) ? out.connections.length : 0,
      }
    },
    execute: async (args, agentDeps) => {
      const auth = await resolveWorkflowAuthoring(getDeps, agentDeps, 'view')
      if (!auth.ok) return { success: false, output: null, error: auth.error }

      const type = typeof args.type === 'string' ? args.type.trim() : ''
      const appSlug = typeof args.appSlug === 'string' ? args.appSlug.trim() : ''
      if (!type && !appSlug) {
        return {
          success: false,
          output: null,
          error: 'Pass either type (an app block\'s "<appId>:<blockId>") or appSlug.',
        }
      }

      // Lazy imports — both modules pull server-only deps; same reason
      // list-app-blocks.ts defers the cache barrel.
      const { getCachedInstalledApps } = await import('../../../../../cache')
      const apps = await getCachedInstalledApps(agentDeps.organizationId)

      // `<appId>:<blockId>` — split on the FIRST colon only; a block id may
      // contain one, an app id may not.
      const appIdFromType = type ? type.slice(0, type.indexOf(':')) : ''
      const inst = appIdFromType
        ? apps.find((a) => a.app.id === appIdFromType)
        : apps.find((a) => a.app.slug === appSlug)

      if (!inst) {
        return {
          success: false,
          output: null,
          error: type
            ? `No app installed in this workspace contributes the node type "${type}". Call list_app_blocks for the ones that do.`
            : `No app with the slug "${appSlug}" is installed in this workspace. Call list_app_blocks to see what is.`,
        }
      }

      const { listAppConnections } = await import('@auxx/services/app-connections')
      const result = await listAppConnections(agentDeps.organizationId)
      if (result.isErr()) {
        return { success: false, output: null, error: result.error.message }
      }

      const connections = result.value
        // Org-scoped rows for THIS app. `userId === null` is what makes a row
        // workspace-owned — `global` describes the METHOD, not the row.
        .filter((conn) => conn.appId === inst.app.id && conn.userId === null)
        .map((conn) => ({
          connectionId: conn.id,
          label: conn.label || `${inst.app.title} (workspace)`,
          scope: 'organization' as const,
          status: conn.connectionStatus,
          ...(conn.isDefault ? { isDefault: true } : {}),
        }))
        .sort((a, b) => Number(b.isDefault ?? false) - Number(a.isDefault ?? false))

      if (connections.length === 0) {
        const { connectionsPath } = await import(
          '../../../../../workflow-engine/catalog/app-manifests'
        )
        // Name the method, so "connect one" is a specific instruction rather
        // than a category — and say plainly that the agent cannot do it, or the
        // next turn is spent trying.
        const method = inst.methods.find((m) => m.global) ?? inst.methods[0]
        return {
          success: false,
          output: null,
          error:
            `${inst.app.title} has no workspace connection, so its blocks cannot run. ` +
            `An admin needs to connect one${method ? ` — ${method.label}` : ''} at ${connectionsPath(inst)}. ` +
            `I can't create it: connecting requires signing in to ${inst.app.title}, which only a person can do.`,
        }
      }

      return {
        success: true,
        output: { app: inst.app.title, appSlug: inst.app.slug, connections },
      }
    },
  }
}
