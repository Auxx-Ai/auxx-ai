// packages/lib/src/ai/kopilot/capabilities/workflow-builder/tools/graph-tool-helpers.ts

import type { Result } from 'neverthrow'
import type { AuxxError } from '../../../../../errors'
import type { UnifiedVariable } from '../../../../../workflow-engine/types/unified-variable'
import type {
  GraphMutationResult,
  Issue,
  NodeSummary,
} from '../../../../../workflows/graph-edit/types'
import type { AgentToolPermission } from '../../../../agent-framework/tool-permission'
import type { AgentToolResult } from '../../../../agent-framework/types'

/**
 * Shared `permission` declaration for the guarded workflow-builder tools —
 * every one routes through `resolveWorkflowAuthoring` before doing anything
 * else. `level` narrows per tool (view for reads, edit for mutations +
 * `run_node`, matching the tRPC ladder).
 */
export function workflowToolPermission(level: 'view' | 'edit'): AgentToolPermission {
  return {
    target: 'instance',
    keys: ['workflow'],
    level,
    enforcement: 'enforced',
    note:
      'resolveWorkflowAuthoring — fail-closed on absent capabilities, PermissionKey.workflowsView ' +
      'area rung, org-scope check on the session workflow ref, ' +
      `${level === 'view' ? 'canViewInstance (silent read filter)' : 'assertEditInstance'} ` +
      'per workflow, and assertWorkflowAppNotSystemOwned. Proven behaviourally by ' +
      'workflow-builder/tools/__tests__/workflow-authoring-guard.test.ts.',
  }
}

// NOTE: every tool in this capability writes `toolsetSlug: 'workflow.builder'`
// and `surfaces: ['builder']` as LITERALS (not a shared spread) on purpose —
// the `tool-slug-coverage` anti-drift test is a static text scan over each
// factory's `return {` window and cannot see through a spread. Builder-only:
// graph editing has no meaning on chat/email, and a runtime AI node must never
// inherit these tools.

/** A node summary for the model: everything but canvas coordinates. */
export type ProjectedNode = Omit<NodeSummary, 'position'>

/** One resolved output, compact: the wireable ref plus label + type. */
export interface ProjectedOutput {
  /** Echo this back verbatim inside a config to wire the value. */
  ref: string
  label: string
  type: string
}

/** Strip canvas coordinates — the model must never see or send positions. */
export function projectNode(node: NodeSummary): ProjectedNode {
  const { position: _position, ...rest } = node
  return rest
}

/**
 * Compact a node's resolved outputs (already friendly-rendered by graph-edit —
 * ids are `Title.path`; NOT re-rendered here) into `{{Title.path}}` refs.
 */
export function projectOutputs(outputs: unknown[] | undefined): ProjectedOutput[] {
  if (!Array.isArray(outputs)) return []
  return (outputs as UnifiedVariable[]).map((v) => ({
    ref: `{{${v.id}}}`,
    label: v.label,
    type: String(v.type),
  }))
}

/** The projected success output every graph mutation tool returns. */
export interface ProjectedMutation {
  applied: boolean
  /** Human line for the status pill — also what `buildDigest` picks up. */
  summary: string
  node?: ProjectedNode
  outputs?: ProjectedOutput[]
  issues: Issue[]
  graphSummary: GraphMutationResult['graphSummary']
}

/**
 * Convert a graph-edit mutation `Result` into an `AgentToolResult` (D12: the
 * touched node, its resolved outputs, and issues ride every write).
 *
 * - `err(AuxxError)` → tool error with the actionable message (ConflictError's
 *   re-read-and-retry text included) — returned, not thrown, so the model can
 *   recover in-turn.
 * - `applied: false` → tool error carrying the blocking issues; the draft is
 *   untouched.
 * - `applied: true` → success, coordinates stripped, outputs compacted.
 *
 * `summarize` names the completed action for the status pill — e.g.
 * "Added HTTP Request".
 */
export function mutationToToolResult(
  result: Result<GraphMutationResult, AuxxError>,
  summarize: (value: GraphMutationResult) => string
): AgentToolResult {
  if (result.isErr()) {
    return { success: false, output: null, error: result.error.message }
  }
  const value = result.value
  const projected: ProjectedMutation = {
    applied: value.applied,
    summary: summarize(value),
    ...(value.node ? { node: projectNode(value.node) } : {}),
    ...(value.outputs ? { outputs: projectOutputs(value.outputs) } : {}),
    issues: value.issues,
    graphSummary: value.graphSummary,
  }
  if (!value.applied) {
    const blocking = value.issues.filter((issue) => issue.severity === 'error')
    return {
      success: false,
      output: projected,
      error:
        'The edit was NOT applied — blocking issues:\n' +
        (blocking.length > 0 ? blocking : value.issues)
          .map((issue) => `- ${issue.nodeRef ? `${issue.nodeRef}: ` : ''}${issue.message}`)
          .join('\n'),
    }
  }
  return { success: true, output: projected }
}

/** The `summary` string off a projected mutation output, for `buildDigest`. */
export function digestLabelFromOutput(output: unknown, fallback: string): string {
  const summary = (output as { summary?: unknown } | null)?.summary
  return typeof summary === 'string' && summary.length > 0 ? summary : fallback
}
