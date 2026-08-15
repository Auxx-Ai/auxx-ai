// packages/lib/src/workflows/graph-edit/run-node.ts

/**
 * Single-node run for the graph-edit module (`03-graph-edit-service.md` §8) —
 * SERVER-ONLY, and deliberately in its own file: the execution service pulls
 * the whole engine module graph (bullmq, processors), which must not ride
 * along with the rest of graph-edit in tests.
 *
 * Wraps the EXISTING `WorkflowExecutionService.runSingleNode` path — the same
 * one the node panel's "Run" button uses — over the DRAFT graph only. One run
 * per call; the result is SUMMARIZED (status, outputs, error), never the raw
 * execution dump. There is NO full-workflow trigger API here at all — not
 * gated, absent — so a later refactor cannot quietly widen it.
 *
 * SAFETY: single-node runs are unconditionally debug/dry runs since #1555
 * (`single-node-executor.ts:88-95` forces `setDebugMode(true)`) — a panel
 * "Run" previously emailed a real customer; side-effecting nodes now simulate,
 * and `ResumeOptions.debug` keeps a paused test run from resuming as
 * production. That is the strongest safety property this wrapper inherits.
 *
 * `runSingleNode` does NOT run upstream nodes — the caller supplies every
 * input variable value explicitly (`07-remaining-mechanics.md` §4), so
 * `input` values are synthesized test data, not live upstream output.
 *
 * No permission checks live here (house rule). The capability layer must
 * apply all four guards the tRPC procedure applies:
 * `permissionProcedure(workflowsView)`, `notDemo`,
 * `assertEditInstance('workflow', workflowAppId)`, and
 * `assertWorkflowAppNotSystemOwned`.
 */

import type { Database } from '@auxx/database'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError, BadRequestError, NotFoundError, UnprocessableEntityError } from '../../errors'
import { getManifest } from '../../workflow-engine/catalog/registry'
import { type GraphEditScope, loadDraftContext } from './read'
import { describeNode, resolveNodeRef } from './refs'
import type { GraphNode, Issue } from './types'
import { nodeType, validateNodeConfigs } from './validate'

/** Input for {@link runNode}. */
export interface RunNodeInput extends GraphEditScope {
  /** Node reference — title or id, resolved like every other op's `ref`. */
  nodeId: string
  /**
   * Input variable values keyed by variable id (the `{{…}}` names the node
   * consumes). Upstream nodes are NOT executed — omitted inputs are simply
   * undefined at run time.
   */
  input?: Record<string, unknown>
  /** User the run executes as (recorded on the execution row). */
  userId: string
}

/** The summarized outcome of a single-node run — never the raw execution dump. */
export interface RunNodeSummary {
  status: 'succeeded' | 'failed'
  /** The node's output variables (what downstream `{{Node.x}}` refs would see). */
  outputs: Record<string, unknown>
  error: string | null
  /** Seconds the node took to run. */
  elapsedTime: number | null
  /** Per-field messages when the node's own validation rejected the inputs. */
  validationErrors?: Array<{ field: string; message: string }>
}

/**
 * Run one draft node in isolation as a debug/dry run and summarize the result.
 * The node must be config-valid first (tier-2 validation — the manifest's own
 * validator); a config-invalid node is refused with the issues as the error,
 * because running it would only produce a less actionable failure.
 */
export async function runNode(
  db: Database,
  params: RunNodeInput
): Promise<Result<RunNodeSummary, AuxxError>> {
  const loaded = await loadDraftContext(db, params)
  if (loaded.isErr()) return err(loaded.error)
  const ctx = loaded.value

  const draftWorkflowId = ctx.draftRow?.id
  if (typeof draftWorkflowId !== 'string') {
    return err(new NotFoundError('The workflow has no draft to run a node from.'))
  }

  const resolved = resolveNodeRef(ctx.graph.nodes, params.nodeId)
  if (resolved.isErr()) return err(resolved.error)
  const node = resolved.value.node as GraphNode

  // Nodes the manifest declares un-runnable in isolation (triggers, and
  // `form-input`, which never executes at all — `NON_EXECUTABLE_NODE_TYPES`)
  // are refused HERE. Sent on, they reach the engine, get skipped, and come
  // back as a meaningless "succeeded" with no outputs.
  const manifest = getManifest(nodeType(node))
  if (manifest?.connection.canRunSingle === false) {
    return err(
      new BadRequestError(
        `Node ${describeNode(node)} is a "${nodeType(node)}" node, which cannot be run on its own — ` +
          'it has no standalone execution. Run a node downstream of it instead.'
      )
    )
  }

  // Tier-2 config validation, scoped to this node — a run needs a valid
  // config even though a draft legitimately persists without one.
  const configIssues = validateNodeConfigs({ nodes: [node], edges: [] })
  const blocking = configIssues.filter((issue) => issue.severity === 'error')
  if (blocking.length > 0) {
    return err(
      new UnprocessableEntityError(
        `Node "${issueRef(blocking[0]) ?? params.nodeId}" is not config-valid — fix these before running:\n` +
          blocking
            .map((issue) => `- ${issue.field ? `${issue.field}: ` : ''}${issue.message}`)
            .join('\n')
      )
    )
  }

  // Lazy import — the execution service constructs and initializes the
  // WorkflowEngine off its constructor; that module graph must not load at
  // import time (`project_workflow_engine_import_cycle`).
  const { WorkflowExecutionService } = await import('../workflow-execution-service')

  try {
    const execution = await new WorkflowExecutionService(db).runSingleNode({
      workflowAppId: params.workflowAppId,
      workflowId: draftWorkflowId,
      nodeId: node.id,
      inputs: Object.entries(params.input ?? {}).map(([variableId, value]) => ({
        variableId,
        value,
      })),
      userId: params.userId,
      organizationId: params.organizationId,
    })

    const metadata = execution.executionMetadata as
      | { validationError?: { fields?: Array<{ field: string; message: string }> } }
      | null
      | undefined
    const validationErrors = metadata?.validationError?.fields
    return ok({
      status: execution.status === 'succeeded' ? 'succeeded' : 'failed',
      outputs: (execution.outputs ?? {}) as Record<string, unknown>,
      error: execution.error ?? null,
      elapsedTime: execution.elapsedTime ?? null,
      ...(validationErrors && validationErrors.length > 0 ? { validationErrors } : {}),
    })
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    const message = error instanceof Error ? error.message : String(error)
    if (message === 'Workflow not found' || message === 'Node not found in workflow') {
      return err(new NotFoundError(message))
    }
    return err(new UnprocessableEntityError(`Node run failed: ${message}`))
  }
}

/** The node ref an issue names, if any. */
function issueRef(issue: Issue | undefined): string | undefined {
  return issue?.nodeRef
}
