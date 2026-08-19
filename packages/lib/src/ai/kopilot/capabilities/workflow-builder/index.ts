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
import { createListAppBlocksTool } from './tools/list-app-blocks'
import { createListAppConnectionsTool } from './tools/list-app-connections'
import { createListNodeTypesTool } from './tools/list-node-types'
import { createReplaceGraphTool } from './tools/replace-graph'
import { createRunNodeTool } from './tools/run-node'
import { createSetTriggerTool } from './tools/set-trigger'
import { createSetWorkflowDetailsTool } from './tools/set-workflow-details'
import { createUpdateNodeTool } from './tools/update-node'
import { createValidateWorkflowTool } from './tools/validate-workflow'

export { WORKFLOW_BUILDER_PAGE } from './client'
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
  'set_workflow_details',
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
      createListAppBlocksTool(getDeps),
      createListAppConnectionsTool(getDeps),
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
      createSetWorkflowDetailsTool(getDeps),
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
      // A workflow turn writes through a pre-turn snapshot: the first mutation
      // captures the prior graph in Redis (`graph-edit/turn-snapshot.ts`,
      // inside `runGraphMutation`). Turn end has exactly ONE job now —
      // `completed` discards the snapshot; every other outcome leaves it
      // alone. **Revert is never automatic** (plans/kopilot/workflow/20 §2,
      // Q1): each mutation persisted independently, through its own
      // validation, its own ref gate, its own hash-CAS and its own realtime
      // signal, so a turn that stopped early leaves N complete, valid edits
      // the user already watched land — not a corrupt half-write.
      // Undo of a COMPLETED turn is the CANVAS's job: the builder's realtime
      // subscriber records each Kopilot edit as a normal client-side history
      // entry. Undo of a turn that stopped early is the USER's click on the
      // phase-D card, served from the snapshot this hook deliberately keeps.
      // The snapshot keyed by `(workflowAppId, turnId)` IS the "did THIS turn
      // write" record: `readWorkflowTurnSnapshot` with the turn id returns
      // null unless this turn wrote, which also stops a prior turn's
      // still-pending snapshot (24h TTL) from being touched here.
      async onTurnEnd(outcome, { turnId }) {
        const { sessionContext, organizationId } = getDeps()
        const workflowAppId = findRef(sessionContext, 'workflow')?.id
        if (!workflowAppId) return

        // Release the canvas edit lock FIRST, and outside the snapshot branch
        // below. A turn that read but never wrote has no snapshot yet still
        // holds the lock (it is claimed on the first tool call of any kind), so
        // releasing inside the `if (!snapshot)` path would strand the canvas
        // read-only for the whole of every question-only turn. Turn-checked
        // inside, and its own try/catch so a Redis failure cannot stop the
        // snapshot bookkeeping that follows. This ordering holds for EVERY
        // outcome — an exhausted or aborted turn must not leave the canvas
        // locked either.
        const { endWorkflowTurnLock } = await import('../../../../workflows/graph-edit/turn-lock')
        try {
          await endWorkflowTurnLock(organizationId, workflowAppId, turnId)
        } catch (err) {
          logger.error('Kopilot workflow turn-lock release failed', {
            workflowAppId,
            turnId,
            error: err instanceof Error ? err.message : String(err),
          })
        }

        try {
          // Lazy import — turn-snapshot pulls @auxx/redis and the persist seam;
          // neither belongs in this capability's import-time graph, and the
          // laziness keeps tests free to mock the graph-edit module wholesale.
          // `revertWorkflowTurn` is deliberately NOT imported here any more:
          // the restore is offered by the phase-D card (tRPC), never performed
          // by this hook. Inside the try with the read — the engine swallows a
          // throwing hook, but this must not depend on that.
          const { finalizeWorkflowTurn, readWorkflowTurnSnapshot, recordWorkflowTurnEnding } =
            await import('../../../../workflows/graph-edit/turn-snapshot')
          const snapshot = await readWorkflowTurnSnapshot(workflowAppId, turnId)
          if (!snapshot) return
          if (outcome !== 'completed') {
            // [C4] The turn stopped early — KEEP the work AND the snapshot.
            //
            // Not reverting is the point of plan 20: `exhausted` (token
            // budget / iteration cap / failure streak), `aborted` (page
            // reload, navigate-away) and even `error` all leave a draft that
            // is N complete, individually persisted mutations. A draft graph
            // has no atomicity requirement to protect — "half-finished" is
            // what the canvas looks like every time a human stops mid-thought.
            //
            // Not FINALIZING is just as load-bearing, and less obvious.
            // Finalizing DISCARDS the snapshot, which is the only recovery
            // path this turn has left — and it is exactly what phase D's Undo
            // card consumes. `delete_nodes` carries no approval gate, so a
            // turn that deletes five nodes and then trips the budget leaves
            // them deleted; the snapshot is what makes that recoverable.
            //
            // Leaving it behind is safe, not a leak — do NOT "tidy this up":
            //  - the slot is one-per-workflow (`workflow:graph:<id>:preturn`)
            //  - `captureWorkflowTurnSnapshot` overwrites it on the NEXT
            //    turn's first write
            //  - `readWorkflowTurnSnapshot` is turn-checked, so a superseded
            //    caller reads null rather than a foreign turn's graph
            //  - `clearWorkflowTurnSnapshot` wipes it unconditionally on a
            //    manual canvas save
            //  - Redis expires it after 24h
            // Stamp HOW it ended onto the snapshot before returning. This is
            // the ONLY place the ending is knowable and durable at once: the
            // engine classifies the terminal event and hands it here, then the
            // turn is gone — the snapshot is a graph, not a transcript, so
            // without this stamp the Undo offer can only say "stopped early".
            //
            // ADDITIVE, not a finalize — [C4] above still holds in full. It
            // rewrites one field of the same slot and cannot delete it, and it
            // is turn-checked inside, so a superseded turn relabels nothing.
            // Best-effort by construction (it swallows its own failures), so a
            // Redis blip costs the adjective, never the offer.
            await recordWorkflowTurnEnding(workflowAppId, turnId, outcome)
            // Warn (not error): nothing is broken, but a turn that kept work
            // it did not finish is worth seeing in the logs.
            logger.warn('Kopilot workflow turn stopped early — edits kept, snapshot retained', {
              workflowAppId,
              turnId,
              outcome,
            })
            return
          }
          // The turn committed — discard its snapshot (turn-checked, so a
          // fresher turn's slot is never cleared). Keeping it would only
          // leave a stale revert target around; client-side canvas history
          // owns undo from here.
          await finalizeWorkflowTurn(workflowAppId, turnId)
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
