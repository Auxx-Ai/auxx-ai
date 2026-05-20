// packages/lib/src/ai/kopilot/capabilities/apps/index.ts

import { resolveAppConnectionForRuntime } from '@auxx/services/app-connections'
import {
  invokeLambdaExecutor,
  invokeLambdaExecutorStreaming,
  prepareLambdaContext,
} from '@auxx/services/lambda-execution'
import { getCachedAgentById, getOrgCache } from '../../../../cache'
import type {
  AgentToolDefinition,
  AgentToolResult,
  ToolProgressPayload,
} from '../../../agent-framework/types'
import { loadMasterKopilotSettings } from '../../load-master-settings'
import type { GetToolDeps, PageCapability } from '../types'
import { buildAppToolDigest } from './digest'
import { getRegisteredToolName } from './tool-naming'

/**
 * AI tool bridge — registers app-backed tools alongside native capabilities.
 *
 * Resolution flow (see plans/kopilot/apps/credentials.md §4):
 *   1. Pull installed apps from the org cache (decision B2 — installedApps
 *      now carries the AI tool catalog + org-scope connection presence).
 *   2. For each installation × published tool:
 *      - resolve connection presence per the agent's `appAccounts` binding
 *        (agent runs) or workspace-then-user fallback (master Kopilot)
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

  // Per plans/kopilot/apps/agent-credentials.md §3.5 — when an agent is
  // active, registration is gated on `Agent.appAccounts[appId].credId`. The
  // master Kopilot path reads `kopilot.appAccounts` from org settings
  // (plans/kopilot/settings — explicit pin only, no fallbacks).
  const agent = agentId ? await getCachedAgentById(organizationId, agentId) : null
  const appAccounts: Record<string, { credId: string }> = agent
    ? (agent.appAccounts ?? {})
    : (await loadMasterKopilotSettings(organizationId)).appAccounts

  const tools: AgentToolDefinition[] = []

  for (const installation of installedApps) {
    const catalogTools = installation.agentTools ?? []
    if (catalogTools.length === 0) continue
    if (!installation.currentDeployment) continue

    const serverBundleSha = installation.currentDeployment.serverBundleSha
    const appId = installation.app.id
    const appSlug = installation.app.slug
    const installationId = installation.installationId

    // Per plans/kopilot/apps/agent-credentials.md §3.5 — registration is
    // gated on the bound credId from the agent's (or master's)
    // `appAccounts[appId]`. Agents fall back to any workspace cred during
    // the transition; master no longer has any fallback path
    // (plans/kopilot/settings/README.md §4.2 — explicit pin only).
    const binding = appAccounts[appId]
    const boundCredId: string | null = binding?.credId ?? null

    for (const tool of catalogTools) {
      // Connection-presence gate (decision A4).
      if (tool.requiresConnection) {
        if (agent) {
          // Agent run: require an explicit binding OR a workspace cred
          // fallback. User-scope tools are no longer special-cased — the
          // creator's pick (workspace or personal) is the binding.
          if (!boundCredId && !installation.orgConnectionPresent) continue
        } else {
          // Master Kopilot: explicit pin only, no fallback.
          if (!boundCredId) continue
        }
      }

      const registeredName = getRegisteredToolName(appSlug, tool.id)
      const refDescriptors = tool.refs ?? []
      const toolId = tool.id
      const timeoutMs = tool.timeoutMs
      const isStreaming = tool.streaming === true

      // Both buffered + streaming closures share the same connection-resolution
      // and lambda-context shape — extracted so we don't fork the prep code.
      const prepareLambdaCall = async (args: Record<string, unknown>) => {
        // Resolution priority:
        //  1. Explicit binding (agent or master) → resolve by credId.
        //  2. Agent run, no binding → resolve any workspace cred (transition).
        //  3. Master Kopilot, no binding → unreachable (registration above
        //     would have skipped this tool). Defensive fall-through still
        //     returns a clear error.
        const resolveInput: Parameters<typeof resolveAppConnectionForRuntime>[0] | null =
          boundCredId
            ? { appId, organizationId, userId: userId ?? '', connectionId: boundCredId }
            : agent
              ? { appId, organizationId, userId: userId ?? '' }
              : null

        if (!resolveInput) {
          return {
            ok: false as const,
            error: 'CONNECTION_REQUIRED: No credential resolved for AI tool',
          }
        }

        const connections = await resolveAppConnectionForRuntime(resolveInput)

        if (connections.isErr()) {
          return {
            ok: false as const,
            error: 'CONNECTION_REQUIRED: No credential resolved for AI tool',
          }
        }

        const resolved = connections.value
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

        return {
          ok: true as const,
          payload: {
            type: 'tool' as const,
            serverBundleSha,
            toolId,
            inputs: args,
            context,
            timeout: timeoutMs,
            invocationContext: {
              kind: 'agent' as const,
              sessionId,
              agentId: agentId ?? null,
              triggerId: triggerId ?? null,
            },
          },
        }
      }

      const buildAgentTool = (execute: AgentToolDefinition['execute']): AgentToolDefinition => ({
        name: registeredName,
        displayName: tool.name || registeredName,
        description: tool.description,
        parameters: tool.inputsJsonSchema,
        // App-backed tools never require per-call approval — toolset enablement
        // at agent-creation time is the approval gate. See
        // plans/kopilot/apps/gog-calendar-overhaul.md §3 decision #3 and
        // plans/kopilot/agents/README.md §2 decision #12.
        requiresApproval: false,
        toolsetSlug: tool.toolsetSlug,
        buildDigest: (output: unknown) =>
          buildAppToolDigest(output, { appSlug, toolId }, refDescriptors),
        execute,
      })

      if (isStreaming) {
        // Streaming closure: wraps `invokeLambdaExecutorStreaming` with a
        // queue so each progress frame surfaces as a `tool-progress` agent
        // event in the chat SSE channel. Per plans/kopilot/apps/README.md
        // §6.2, autonomous / triggered runs without a chat consumer simply
        // see no `tool-progress` events flowing through (the bridge still
        // yields them — the upstream consumer ignores them). The terminal
        // result is taken from the streaming caller's `Result`, not from
        // the in-stream `event: result` frame, so error mapping flows
        // through the same code path as the buffered caller.
        tools.push(
          buildAgentTool(async function* execute(args): AsyncGenerator<
            ToolProgressPayload,
            AgentToolResult,
            void
          > {
            const prep = await prepareLambdaCall(args)
            if (!prep.ok) {
              return { success: false, output: null, error: prep.error }
            }

            type QueueItem =
              | { kind: 'progress'; data: unknown }
              | { kind: 'done'; result: AgentToolResult }
            const queue: QueueItem[] = []
            let waiter: (() => void) | null = null
            const wake = () => {
              if (waiter) {
                const w = waiter
                waiter = null
                w()
              }
            }

            const fetchTask = invokeLambdaExecutorStreaming({
              caller: 'kopilot',
              payload: prep.payload,
              onEvent: (ev) => {
                if (ev.event === 'progress') {
                  queue.push({ kind: 'progress', data: ev.data })
                  wake()
                }
                // `result` and `error` frames are folded into the awaited
                // Result below — we don't push them through the queue.
              },
            })
              .then((res) => {
                let final: AgentToolResult
                if (res.isErr()) {
                  final = {
                    success: false,
                    output: null,
                    error: `${res.error.code}: ${res.error.message}`,
                  }
                } else {
                  final = { success: true, output: res.value.finalResult }
                }
                queue.push({ kind: 'done', result: final })
                wake()
              })
              .catch((error) => {
                queue.push({
                  kind: 'done',
                  result: {
                    success: false,
                    output: null,
                    error: `STREAM_TASK_ERROR: ${error instanceof Error ? error.message : String(error)}`,
                  },
                })
                wake()
              })

            try {
              while (true) {
                while (queue.length > 0) {
                  const item = queue.shift()!
                  if (item.kind === 'done') return item.result
                  yield { data: item.data }
                }
                await new Promise<void>((resolve) => {
                  waiter = resolve
                })
              }
            } finally {
              // Make sure we don't leak the streaming task on early loop exits.
              await fetchTask.catch(() => {})
            }
          })
        )
        continue
      }

      tools.push(
        buildAgentTool(async (args, _ctx): Promise<AgentToolResult> => {
          try {
            const prep = await prepareLambdaCall(args)
            if (!prep.ok) {
              return { success: false, output: null, error: prep.error }
            }

            const lambdaResult = await invokeLambdaExecutor({
              caller: 'kopilot',
              payload: prep.payload,
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
        })
      )
    }
  }

  return {
    page: '__global__',
    tools,
  }
}
