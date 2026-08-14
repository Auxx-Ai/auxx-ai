// packages/lib/src/workflows/graph-edit/persist.ts

/**
 * The ONE seam through which every graph mutation writes the draft
 * (`03-graph-edit-service.md` §7) — SERVER-ONLY.
 *
 * Writes go through the existing `WorkflowService.update` path (NOT
 * `workflow-engine/services/`), so everything it does on save keeps
 * happening: the blocking `assertMailTriggerNotPersonal`, entity-id
 * canonicalization, the `deriveTriggerLinkColumns` app/webhook column
 * derivation, the hash-CAS on `expectedGraphHash`, and cache invalidation.
 * `publish`, `enabled` and the admin-only field set are never touched here —
 * those are the user's actions.
 *
 * Trigger columns are re-derived on EVERY persist (`deriveTriggerColumns`
 * over the cleaned nodes — the same derivation `use-workflow-save.ts` runs),
 * so a mutation that adds/edits/removes a trigger node can never leave
 * `Workflow.triggerType`/`entityDefinitionId` stale.
 *
 * THE SEAM: the Redis turn snapshot (`turn-snapshot.ts`) is captured BEFORE
 * this write and the `workflow:draft-updated` realtime signal
 * ({@link publishDraftUpdatedSignal}) fires AFTER it — both wrap `persistDraft`
 * in the mutation pipeline (`ops.ts` `runGraphMutation`) and the turn-revert
 * path, never inside it, so non-pipeline callers keep a bare persist.
 */

import type { Database } from '@auxx/database'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError, NotFoundError, UnprocessableEntityError } from '../../errors'
import { deriveTriggerColumns } from '../../workflow-engine/catalog/derive-trigger'
import type { WorkflowTriggerType, WorkflowUpdateInput } from '../types'
import type { GraphEditScope } from './read'
import type { DraftGraph, GraphEdge, GraphNode } from './types'

/** Strip `_`-prefixed keys — derived state the initializer regenerates on load. */
function stripDerivedKeys(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !key.startsWith('_')))
}

/**
 * The same cleanup the canvas save applies (`use-workflow-save.ts`
 * `cleanNodes`/`cleanEdges`): `_`-prefixed keys in node and edge data never
 * persist. Agent-authored data must not carry them either — manifest
 * `defaultData` may (if-else ships `_targetBranches`), so cleaning here keeps
 * that invariant regardless of the mutation.
 */
export function cleanGraphForSave(graph: DraftGraph): DraftGraph {
  const nodes: GraphNode[] = graph.nodes.map((node) => ({
    ...node,
    data: stripDerivedKeys((node.data ?? {}) as Record<string, unknown>),
  }))
  const edges: GraphEdge[] = graph.edges.map((edge) => {
    if (!edge.data) return edge
    const data = stripDerivedKeys(edge.data)
    return { ...edge, data: Object.keys(data).length > 0 ? data : undefined }
  })
  return { nodes, edges, ...(graph.viewport ? { viewport: graph.viewport } : {}) }
}

/** What a mutation hands the persist seam. */
export interface PersistDraftInput {
  graph: DraftGraph
  /** CAS token from `loadDraftContext` — a concurrent save between load and write 409s. */
  expectedGraphHash?: string
  /**
   * Trigger type to write when the graph derives none (template installs
   * carrying not-yet-migrated triggers). Ordinary mutations pass the loaded
   * draft's current type, mirroring the browser save's fallback.
   */
  fallbackTriggerType?: string | null
  envVars?: WorkflowUpdateInput['envVars']
  variables?: WorkflowUpdateInput['variables']
  icon?: WorkflowUpdateInput['icon']
}

/** What the persist wrote — chained into the next mutation's CAS token. */
export interface PersistDraftOutcome {
  graphHash: string | null
  triggerType?: string | null
  entityDefinitionId?: string | null
}

/**
 * Persist a mutated draft graph. Callers must have validated the graph first
 * (structural errors reject before this runs) and asserted edit access +
 * `assertWorkflowAppNotSystemOwned` at the capability layer — no permission
 * checks live in lib.
 *
 * `assertMailTriggerNotPersonal` (inside `WorkflowService.update`) and the
 * hash-CAS surface as `err(AuxxError)` — never swallowed.
 */
export async function persistDraft(
  db: Database,
  scope: GraphEditScope,
  input: PersistDraftInput
): Promise<Result<PersistDraftOutcome, AuxxError>> {
  const graph = cleanGraphForSave(input.graph)

  // Re-derive the trigger columns from the graph being written — the exact
  // derivation (and fallbacks) the canvas save posts.
  const derived = deriveTriggerColumns(graph.nodes)
  const triggerType = derived.triggerType ?? input.fallbackTriggerType ?? undefined
  // `null` is the explicit clear: a graph with no resource trigger must not
  // leave a stale entity id next to the new trigger type.
  const entityDefinitionId = derived.entityDefinitionId ?? null

  try {
    // Lazy import — `workflow-service` statically loads the engine + queue
    // module graph, which must not ride along at import time.
    const { WorkflowService } = await import('../workflow-service')
    const updated = await new WorkflowService(db).update(scope.organizationId, {
      id: scope.workflowAppId,
      graph: graph as WorkflowUpdateInput['graph'],
      triggerType: triggerType as WorkflowTriggerType | undefined,
      entityDefinitionId,
      ...(input.expectedGraphHash !== undefined
        ? { expectedGraphHash: input.expectedGraphHash }
        : {}),
      ...(input.envVars !== undefined ? { envVars: input.envVars } : {}),
      ...(input.variables !== undefined ? { variables: input.variables } : {}),
      ...(input.icon !== undefined ? { icon: input.icon } : {}),
    })
    return ok({
      graphHash: (updated?.graphHash as string | null | undefined) ?? null,
      triggerType: (updated?.triggerType as string | null | undefined) ?? triggerType ?? null,
      entityDefinitionId:
        (updated?.entityDefinitionId as string | null | undefined) ?? entityDefinitionId,
    })
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    const message = error instanceof Error ? error.message : String(error)
    if (message === 'Workflow not found') return err(new NotFoundError('Workflow not found'))
    return err(new UnprocessableEntityError(`Failed to save the workflow draft: ${message}`))
  }
}

/**
 * Fire the `workflow:draft-updated` refresh signal on the org channel AFTER a
 * successful persist. Signal only — open canvases refetch the draft; nothing
 * in the payload is applied directly. Fire-and-forget: a realtime hiccup never
 * fails the mutation that already persisted.
 *
 * The realtime barrel is lazy-imported on purpose: statically importing it
 * breaks `vi.mock` at collection as the module graph grows
 * (`project_realtime_barrel_import_cycle`).
 */
export async function publishDraftUpdatedSignal(
  organizationId: string,
  data: { workflowAppId: string; nodeIds?: string[]; reason: 'kopilot' | 'system' }
): Promise<void> {
  try {
    const { getRealtimeService, publishWorkflowDraftUpdated } = await import('../../realtime')
    await publishWorkflowDraftUpdated(getRealtimeService(), organizationId, data)
  } catch {
    // Fire-and-forget — the draft write already succeeded.
  }
}
