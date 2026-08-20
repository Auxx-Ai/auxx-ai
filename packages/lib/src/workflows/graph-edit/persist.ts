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
import { dehydrateGraph, type GraphDocument } from '../../workflow-engine/catalog/graph-hydration'
import { DEHYDRATION_OPTIONS } from '../../workflow-engine/catalog/hydration-policy'
import { hashGraphSemantics } from '../graph-hash'
import type { WorkflowTriggerType, WorkflowUpdateInput } from '../types'
import type { GraphEditScope } from './read'
import type { DraftGraph, GraphEdge, GraphNode } from './types'

/**
 * The canonical stored shape (plan 23 §3), and one of the three write seams —
 * this is now nothing but {@link dehydrateGraph}, the EXACT inverse of the
 * `hydrateGraph` every read boundary runs.
 *
 * It used to be a `stripDerivedKeys` over `node.data`/`edge.data` and nowhere
 * else, which is why `edge._waitingRun` sits in 16 stored edges including two
 * published versions: a `_`-prefixed key on the node or edge OBJECT persisted
 * forever. `dehydrateGraph` owns the `_` rule at every level of the document,
 * and additionally removes everything hydration re-derives (so a load never
 * counts as an edit) plus the keys that never held information
 * (`isValid`/`errors`/`data.selected`/`outputVariables`).
 *
 */
export function cleanGraphForSave(graph: DraftGraph): DraftGraph {
  const stored = dehydrateGraph(graph as unknown as GraphDocument, DEHYDRATION_OPTIONS)
  return {
    nodes: stored.nodes as unknown as GraphNode[],
    edges: stored.edges as unknown as GraphEdge[],
    ...(stored.viewport ? { viewport: stored.viewport } : {}),
  }
}

/** What a mutation hands the persist seam. */
export interface PersistDraftInput {
  graph: DraftGraph
  /** Optional WorkflowApp metadata to atomically restore with a failed AI turn. */
  name?: string
  description?: string | null
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
  /**
   * Hash of the AUTHORED content only (see {@link hashGraphSemantics}) of the
   * CLEANED graph this call wrote — the same projection `loadDraftContext`'s
   * graph produces on the next read, so the two are directly comparable.
   *
   * Separate from `graphHash` because that one is the save-path CAS token and
   * must stay full-document. This is what the Kopilot Undo offer compares
   * against, so that merely opening the builder (which autosaves a new viewport
   * and selection) does not read as "the canvas moved on".
   */
  graphSemanticHash: string
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
  // Derive the trigger columns from the HYDRATED graph, BEFORE the clean step.
  //
  // Order matters and this is the order the two other writers already use
  // (`create-from-template.ts:105-124`, `workflow-save-provider.tsx:283`).
  // `deriveTriggerColumns` sets the columns only when a resource trigger has
  // BOTH `operation` and `entityDefinitionId`, so any future strip that removes
  // either key from the cleaned document would drop `Workflow.triggerType` to
  // the generic `'resource-trigger'` — which no dispatcher matches, meaning
  // every resource-triggered workflow silently stops firing. Deriving first
  // makes this seam indifferent to what the strip does.
  const derived = deriveTriggerColumns(input.graph.nodes)

  const graph = cleanGraphForSave(input.graph)
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
      // The agent's own writes must not wipe the pre-turn Undo snapshot the
      // mutation pipeline captured just before this persist. Manual canvas
      // saves (which don't go through this seam) DO clear it.
      preserveTurnSnapshot: true,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.expectedGraphHash !== undefined
        ? { expectedGraphHash: input.expectedGraphHash }
        : {}),
      ...(input.envVars !== undefined ? { envVars: input.envVars } : {}),
      ...(input.variables !== undefined ? { variables: input.variables } : {}),
      ...(input.icon !== undefined ? { icon: input.icon } : {}),
    })
    return ok({
      graphHash: (updated?.graphHash as string | null | undefined) ?? null,
      // Hashed from `graph` (the cleaned document written above), NOT
      // `input.graph` — `cleanGraphForSave` strips derived `node.data` keys, and
      // the next read sees the cleaned form. Hashing the input would make every
      // later comparison a false mismatch.
      graphSemanticHash: hashGraphSemantics(graph),
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
