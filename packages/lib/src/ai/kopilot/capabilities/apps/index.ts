// packages/lib/src/ai/kopilot/capabilities/apps/index.ts

import { resolveAppConnectionForRuntime } from '@auxx/services/app-connections'
import { invokeLambdaExecutor, prepareLambdaContext } from '@auxx/services/lambda-execution'
import { getOrgCache } from '../../../../cache'
import type { AgentToolDefinition, AgentToolResult } from '../../../agent-framework/types'
import type { GetToolDeps, PageCapability } from '../types'
import { getAppConnectionPresence } from './connection-resolver'
import { buildAppToolDigest } from './digest'

/**
 * AI tool bridge — registers app-backed tools alongside native capabilities.
 *
 * Resolution flow (see plans/kopilot/apps/credentials.md §4):
 *   1. Pull installed apps from the org cache (decision B2 — installedApps
 *      now carries the AI tool catalog + org-scope connection presence).
 *   2. For each installation × published tool:
 *      - resolve connection presence per `connectionScope`
 *      - skip when `requiresConnection: true && !present` (decision A4 —
 *        hidden when no connection)
 *      - else wrap as `AgentToolDefinition` with a `<appSlug>_<toolId>`
 *        registered name (decision D1) and an `execute` closure that POSTs
 *        through `invokeLambdaExecutor` with `caller: 'kopilot'` (decision E1).
 *
 * Refresh policy is the per-provider O1 path (plans/kopilot/apps/credentials.md §3.5):
 * `invokeLambdaExecutor` already maps `CONNECTION_NOT_FOUND` /
 * `CONNECTION_EXPIRED` to a typed `CONNECTION_REQUIRED` error the LLM can act on.
 */
export async function createAppCapabilities(deps: {
  organizationId: string
  /** Human invoker. null on autonomous runs. */
  userId: string | null
  /** Active agent. null for master Kopilot. */
  agentId?: string | null
  /** Active trigger. null for chat / non-trigger calls. */
  triggerId?: string | null
  /** Session id — flows to `KopilotLambdaContext`. */
  sessionId?: string
  /** Used by the bridge's execute() to construct lambda payloads. */
  getToolDeps?: GetToolDeps
}): Promise<PageCapability> {
  const { organizationId, userId, agentId, triggerId, sessionId } = deps
  const installedApps = await getOrgCache().get(organizationId, 'installedApps')
  // Org handle is needed for the lambda context — read from the cached profile.
  const orgProfile = await getOrgCache().get(organizationId, 'orgProfile')
  const organizationHandle = orgProfile?.handle ?? null
  const organizationName = orgProfile?.name ?? organizationHandle

  const tools: AgentToolDefinition[] = []

  for (const installation of installedApps) {
    const catalogTools = installation.aiTools ?? []
    if (catalogTools.length === 0) continue
    if (!installation.currentDeployment) continue

    const serverBundleSha = installation.currentDeployment.serverBundleSha
    const appId = installation.app.id
    const appSlug = installation.app.slug
    const installationId = installation.installationId
    // Per decision D1 — kebab → snake on the slug portion so the LLM tool
    // name regex `^[a-zA-Z0-9_-]{1,64}$` is honored cleanly.
    const slugPrefix = appSlug.replace(/-/g, '_')

    for (const tool of catalogTools) {
      // Connection-presence gate (decision A4).
      if (tool.requiresConnection) {
        let present = false
        if (tool.connectionScope === 'organization') {
          present = installation.orgConnectionPresent
        } else if (tool.connectionScope === 'user') {
          const result = await getAppConnectionPresence({
            orgId: organizationId,
            userId,
            appId,
            scope: 'user',
          })
          present = result.present
        }
        if (!present) continue
      }

      const registeredName = `${slugPrefix}_${tool.id}`
      const refDescriptors = tool.refs ?? []
      const toolId = tool.id
      const timeoutMs = tool.timeoutMs

      tools.push({
        name: registeredName,
        description: tool.description,
        parameters: tool.inputsJsonSchema,
        requiresApproval:
          typeof tool.requiresApproval === 'object' ? true : Boolean(tool.requiresApproval),
        toolsetSlug: tool.toolsetSlug,
        buildDigest: (output: unknown) =>
          buildAppToolDigest(output, { appSlug, toolId }, refDescriptors),
        execute: async (args, _ctx): Promise<AgentToolResult> => {
          try {
            // At execute() we have a real call, so this is the spot to
            // decrypt the connection (plans/kopilot/apps/credentials.md §8.3).
            // Decryption stays in `resolveAppConnectionForRuntime` — same
            // path workflow blocks use.
            //
            // For org-scope-only tools without a user, pass a sentinel userId
            // so the resolver can still find the org credential (its filter
            // is per-scope, not "must have user").
            const connections = userId
              ? await resolveAppConnectionForRuntime({
                  appId,
                  organizationId,
                  userId,
                })
              : {
                  isErr: () => true as const,
                  error: { code: 'NO_USER', message: 'autonomous run' },
                }

            // resolveAppConnectionForRuntime requires userId. For autonomous
            // runs we'd need a userId-less variant — out of Wedge A scope.
            if ('isErr' in connections && connections.isErr()) {
              return {
                success: false,
                output: null,
                error: 'CONNECTION_REQUIRED: No credential resolved for AI tool',
              }
            }

            const resolved = (connections as { value: any }).value
            const context = prepareLambdaContext({
              appId,
              installationId,
              organizationId,
              organizationHandle,
              userId: userId ?? undefined,
              userEmail: null,
              userName: organizationName,
              userConnection: resolved.userConnection,
              organizationConnection: resolved.organizationConnection,
              includeEntitiesScope: true,
            })

            const lambdaResult = await invokeLambdaExecutor({
              caller: 'kopilot',
              payload: {
                type: 'ai-tool',
                serverBundleSha,
                toolId,
                toolInput: args,
                context,
                timeout: timeoutMs,
                kopilotContext: {
                  sessionId,
                  agentId: agentId ?? null,
                  triggerId: triggerId ?? null,
                },
              },
            })

            if (lambdaResult.isErr()) {
              const lambdaError = lambdaResult.error
              return {
                success: false,
                output: null,
                error: `${lambdaError.code}: ${lambdaError.message}`,
              }
            }
            const value = lambdaResult.value
            // Runtime errors thrown via BlockRuntimeError surface here.
            if (value.metadata?.runtime_error) {
              return {
                success: false,
                output: null,
                error: `${value.metadata.runtime_error.code ?? 'RUNTIME_ERROR'}: ${value.metadata.runtime_error.message}`,
              }
            }
            return {
              success: true,
              output: value.execution_result,
            }
          } catch (error) {
            return {
              success: false,
              output: null,
              error: `EXECUTION_ERROR: ${error instanceof Error ? error.message : String(error)}`,
            }
          }
        },
      })
    }
  }

  return {
    page: '__global__',
    tools,
  }
}
