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
export function workflowToolPermission(level: 'view' | 'edit' | 'admin'): AgentToolPermission {
  return {
    target: 'instance',
    keys: ['workflow'],
    level,
    enforcement: 'enforced',
    note:
      'resolveWorkflowAuthoring — fail-closed on absent capabilities, PermissionKey.workflowsView ' +
      'area rung, org-scope check on the session workflow ref, ' +
      `${
        level === 'view'
          ? 'canViewInstance (silent read filter)'
          : level === 'edit'
            ? 'assertEditInstance'
            : 'assertAdminInstance'
      } ` +
      'per workflow, and assertWorkflowAppNotSystemOwned. Proven behaviourally by ' +
      'workflow-builder/tools/__tests__/workflow-authoring-guard.test.ts.',
  }
}

// NOTE: no tool in this capability carries a `toolsetSlug`, and that is
// deliberate — they are mounted by PAGE CONTEXT (`page: 'workflow.builder'`),
// exactly like the agents-builder and records-view tools, and are listed in
// `tool-slug-coverage`'s `ALWAYS_ON_TOOLS` allowlist.
//
// They DID carry `toolsetSlug: 'workflow.builder'` until it was found to
// disable the whole capability: master Kopilot's toolsets come from the
// `kopilot.toolsets` org setting, whose default is the glob `auxx:*` — which
// cannot match a slug outside the `auxx:` namespace — and orgs that have
// customised the list hold explicit slugs that predate the toolset entirely.
// `filterToolsByToolsets` drops any tool whose toolset isn't enabled, so all 15
// were stripped after registration: the builder prompt section rendered, and
// not one tool existed. An org-toolset grant was meaningless here anyway —
// these tools only exist on a page no user-authored agent can ever run on.
//
// `surfaces: ['builder']` stays a LITERAL in each factory (not a shared
// spread): the anti-drift scan reads each factory's `return {` window as text
// and cannot see through a spread. Builder-only because graph editing has no
// meaning on chat/email, and a runtime AI node must never inherit these tools.

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
  /** Nothing was written because the requested state already held. */
  unchanged?: boolean
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
    ...(value.unchanged ? { unchanged: true } : {}),
    // Say plainly that nothing moved. `summarize` would otherwise report
    // "Updated X" for a write that wrote nothing, which is what let the model
    // re-issue the same edit without ever learning it was already applied.
    summary: value.unchanged
      ? `No change — ${value.node?.title ?? 'the target'} already had these values.`
      : summarize(value),
    ...(value.node ? { node: projectNode(value.node) } : {}),
    ...(value.outputs ? { outputs: projectOutputs(value.outputs) } : {}),
    issues: value.issues,
    graphSummary: value.graphSummary,
  }
  if (!value.applied) {
    const blocking = value.issues.filter((issue) => issue.severity === 'error')
    // Fresh first, inherited ones labelled: a refused edit lists the whole
    // draft's errors, and without the split the caller reads damage it did not
    // do as the reason it was refused — then "fixes" a node it never touched.
    const shown = (blocking.length > 0 ? blocking : value.issues)
      .slice()
      .sort((a, b) => Number(a.preExisting ?? false) - Number(b.preExisting ?? false))
    return {
      success: false,
      output: projected,
      error:
        'The edit was NOT applied — blocking issues:\n' +
        shown
          .map(
            (issue) =>
              `- ${issue.nodeRef ? `${issue.nodeRef}: ` : ''}${issue.message}` +
              (issue.preExisting
                ? ' (pre-existing — already in the draft, not what blocked this edit)'
                : '')
          )
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
