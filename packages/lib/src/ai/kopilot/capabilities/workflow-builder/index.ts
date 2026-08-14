// packages/lib/src/ai/kopilot/capabilities/workflow-builder/index.ts

import { createScopedLogger } from '@auxx/logger'
import { findRef } from '../../context-refs'
import { buildWorkflowBuilderPromptSection } from '../../prompts/sections/workflow-builder'
import type { GetToolDeps, PageCapability } from '../types'
import { WORKFLOW_BUILDER_PAGE } from './client'
import { createAddNodeTool } from './tools/add-node'
import { createApplyTemplateTool } from './tools/apply-template'
import { createConnectNodesTool } from './tools/connect-nodes'
import { createDeleteNodesTool } from './tools/delete-nodes'
import { createDescribeNodeTypeTool } from './tools/describe-node-type'
import { createDisconnectNodesTool } from './tools/disconnect-nodes'
import { createFindWorkflowTemplatesTool } from './tools/find-workflow-templates'
import { createGetNodeTool } from './tools/get-node'
import { createGetWorkflowTool } from './tools/get-workflow'
import { createListNodeTypesTool } from './tools/list-node-types'
import { createReplaceGraphTool } from './tools/replace-graph'
import { createRunNodeTool } from './tools/run-node'
import { createSetTriggerTool } from './tools/set-trigger'
import { createUpdateNodeTool } from './tools/update-node'
import { createValidateWorkflowTool } from './tools/validate-workflow'

export { WORKFLOW_BUILDER_PAGE, WORKFLOW_BUILDER_TOOLSET_SLUG } from './client'
export {
  DIRTY_CANVAS_ERROR,
  NO_WORKFLOW_REF_ERROR,
  resolveWorkflowAuthoring,
  type WorkflowAuthoringTier,
} from './tools/workflow-authoring-guard'

const logger = createScopedLogger('workflow-builder-capability')

/**
 * The graph mutation tools — the "read, build, and edit" bullet is only honest
 * while at least one of these survived runtime filtering.
 */
const WRITE_TOOL_NAMES = [
  'add_node',
  'update_node',
  'delete_nodes',
  'connect_nodes',
  'disconnect_nodes',
  'set_trigger',
  'replace_graph',
  'apply_template',
]

/**
 * Page capability for the workflow builder (`plans/kopilot/workflow/04`).
 * Mounts on `/app/workflows/[id]`; the docked chat there passes
 * `page='workflow.builder'` and the `workflow` session ref, so every tool
 * resolves the workflow from `findRef(ctx, 'workflow')` without taking a
 * workflowId argument. Thin wrappers over `workflows/graph-edit/` — permission
 * checks live HERE (`resolveWorkflowAuthoring`), never in graph-edit.
 *
 * No `publish`, `enable`, or `delete_workflow` tools — those stay with the
 * user. No full-workflow execution tool exists at all (absent, not gated).
 */
export function createWorkflowBuilderCapabilities(getDeps: GetToolDeps): PageCapability {
  return {
    page: WORKFLOW_BUILDER_PAGE,
    tools: [
      // Discovery (progressive disclosure — the prompt carries no node list).
      createListNodeTypesTool(getDeps),
      createDescribeNodeTypeTool(getDeps),
      createFindWorkflowTemplatesTool(getDeps),
      // Read
      createGetWorkflowTool(getDeps),
      createGetNodeTool(getDeps),
      // Write
      createAddNodeTool(getDeps),
      createUpdateNodeTool(getDeps),
      createDeleteNodesTool(getDeps),
      createConnectNodesTool(getDeps),
      createDisconnectNodesTool(getDeps),
      createSetTriggerTool(getDeps),
      createReplaceGraphTool(getDeps),
      createApplyTemplateTool(getDeps),
      // Verify
      createValidateWorkflowTool(getDeps),
      createRunNodeTool(getDeps),
    ],
    systemPromptAddition: buildWorkflowBuilderPromptSection(),
    capabilities: ({ toolNames }) =>
      WRITE_TOOL_NAMES.some((name) => toolNames.has(name))
        ? ['Read, build, and edit the workflow open in this builder']
        : ['Read the workflow open in this builder'],
    lifecycle: {
      // A workflow turn is a turn-scoped transaction against the open draft:
      // the first mutation captures a pre-turn snapshot in Redis
      // (`graph-edit/turn-snapshot.ts`, inside `runGraphMutation`); turn end
      // discards it (completed — the turn committed atomically) or reverts
      // (restore the pre-turn graph, guarded by `expectedTurnId`). Undo of a
      // successful turn is the CANVAS's job: the builder's realtime subscriber
      // records each Kopilot edit as a normal client-side history entry, so
      // the snapshot exists only for failed-turn atomicity — there is no
      // per-turn Undo card and no server-side undo of a completed turn.
      // The snapshot keyed by `(workflowAppId, turnId)` IS the "did THIS turn
      // write" record: `readWorkflowTurnSnapshot` with the turn id returns
      // null unless this turn wrote, which also stops a prior turn's
      // still-pending snapshot (24h TTL) from being touched here.
      async onTurnEnd(outcome, { turnId }) {
        const { db, sessionContext, organizationId } = getDeps()
        const workflowAppId = findRef(sessionContext, 'workflow')?.id
        if (!workflowAppId) return
        // Lazy import — turn-snapshot pulls @auxx/redis and (via the revert
        // path) the persist seam; neither belongs in this capability's
        // import-time graph, and the laziness keeps tests free to mock the
        // graph-edit module wholesale.
        const { finalizeWorkflowTurn, readWorkflowTurnSnapshot, revertWorkflowTurn } = await import(
          '../../../../workflows/graph-edit/turn-snapshot'
        )
        const snapshot = await readWorkflowTurnSnapshot(workflowAppId, turnId)
        if (!snapshot) return
        try {
          if (outcome === 'completed') {
            // The turn committed — discard its snapshot (turn-checked, so a
            // fresher turn's slot is never cleared). Keeping it would only
            // leave a stale revert target around; client-side canvas history
            // owns undo from here.
            await finalizeWorkflowTurn(workflowAppId, turnId)
            return
          }
          // `expectedTurnId` (the third argument) is load-bearing: it rejects
          // a stale prior-turn snapshot so a later failed turn can never roll
          // back a workflow it didn't touch.
          const reverted = await revertWorkflowTurn(db, { workflowAppId, organizationId }, turnId)
          if (reverted.isErr()) {
            logger.error('Kopilot workflow turn revert failed', {
              workflowAppId,
              turnId,
              error: reverted.error.message,
            })
          }
        } catch (err) {
          logger.error('Kopilot turn-end workflow lifecycle failed', {
            workflowAppId,
            turnId,
            outcome,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      },
    },
  }
}
