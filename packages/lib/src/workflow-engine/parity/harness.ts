// packages/lib/src/workflow-engine/parity/harness.ts

/**
 * Shared, mock-free scaffolding for the resolvability suite
 * (`find.resolvability.test.ts` / `crud.resolvability.test.ts`). Nothing here
 * calls `vi.mock` — that stays in the two test files, since vitest hoists
 * `vi.mock` per file and a shared helper module can't declare it on another
 * file's behalf (the same reason `find-output-keying.test.ts` and
 * `crud-canonicalization.test.ts` each carry their own mock blocks instead of
 * sharing one).
 *
 * Three invariants, asserted per scenario against the SAME flattened walk of
 * a manifest's `resolveOutputs()` tree:
 *
 * 1. **declared ⊆ resolvable** — every id the manifest declares (root, every
 *    nested `properties` entry, every `items` entry) resolves through the
 *    REAL `ExecutionContextManager.resolveVariablePath` to something other
 *    than `undefined`, after the REAL processor has run. A stored `null` (the
 *    findOne-miss case) counts as resolved — `resolveVariablePath`'s direct
 *    lookup only returns `undefined` for an absent key, and a present `null`
 *    is a real, meaningful answer ("looked, found nothing"), not a resolution
 *    failure. See `find.resolvability.test.ts`'s miss scenario for why that
 *    distinction gets its own, narrower assertion instead of the full walk.
 * 2. **written ⊆ declared** — every key the processor actually wrote
 *    (`contextManager.getAllVariables()`, filtered to this node's prefix)
 *    is covered by some declared id: either an exact match (`<node>.count`
 *    needs a declared `<node>.count`) or a declared object/array root that
 *    the written key nests under (`<node>.<defId>.record_id` is covered by
 *    declared `<node>.<defId>`).
 * 3. **label coverage** — every declared id (root, nested, array items)
 *    carries a non-empty `label`. `buildVariableLabelPath`
 *    (`catalog/variable-inference.ts`) falls back to the raw id segment when
 *    `label` is absent, which for an entity-def resource means the picker
 *    renders a CUID to the user instead of a name.
 *
 * Each invariant consults `known-broken.ts` for a documented, PINNED
 * exception before asserting — see that file for the full list and the
 * pinning contract (flip a pin to the opposite assertion once the underlying
 * bug is fixed, forcing the pin's own deletion).
 */

import { expect } from 'vitest'
import { ExecutionContextManager } from '../core/execution-context'
import type { NodeExecutionResult, PreprocessedNodeData, WorkflowNode } from '../core/types'
import type { UnifiedVariable } from '../types/unified-variable'
import { ORG_ID, USER_ID, WORKFLOW_ID } from './fixtures'
import {
  matchDeclaredUnresolvablePin,
  matchMissingLabelPin,
  matchWrittenUndeclaredPin,
} from './known-broken'

/**
 * `BaseNodeProcessor.executeNode` is `protected` — every node test in this
 * codebase reaches it via a same-shape cast (`find-output-keying.test.ts`'s
 * `TestableFindProcessor` subclass, `crud-canonicalization.test.ts`'s
 * `(processor as any).executeNode(...)`). This is the one shared, PROPERLY
 * TYPED version, so both `find.resolvability.test.ts` and
 * `crud.resolvability.test.ts` get real argument/return checking instead of
 * `any`.
 */
interface ProtectedExecuteNode {
  executeNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager,
    preprocessedData?: PreprocessedNodeData
  ): Promise<Partial<NodeExecutionResult>>
}

/** Call a `BaseNodeProcessor` subclass's protected `executeNode` directly, bypassing the public `execute()` wrapper. */
export async function runExecuteNode(
  processor: object,
  node: WorkflowNode,
  ctx: ExecutionContextManager,
  preprocessed: PreprocessedNodeData
): Promise<Partial<NodeExecutionResult>> {
  return (processor as unknown as ProtectedExecuteNode).executeNode(node, ctx, preprocessed)
}

/**
 * A REAL `ExecutionContextManager` — never stubbed. `resolveVariablePath`'s
 * segment walker (base resolution → `lazyLoadResourceWithPath` /
 * `hydrateRelation` → `fetchResourceWithRelationships`, and the
 * record-field cache's `getFieldValue` → `batchGetValues`) is the exact
 * mechanism this suite exists to exercise; a stub contextManager (as
 * `find-output-keying.test.ts` uses, for a narrower purpose) would make
 * every resolvability assertion vacuous. `initializeSystemVariables()`
 * seeds `sys.organizationId`/`sys.userId`, which both `FindProcessor` and
 * `CrudNodeProcessor` read via `contextManager.getVariable('sys.organizationId')`.
 */
export function createContextManager(executionId: string): ExecutionContextManager {
  const ctx = new ExecutionContextManager(WORKFLOW_ID, executionId, ORG_ID, USER_ID)
  ctx.initializeSystemVariables()
  return ctx
}

/** One declared variable, flattened out of a `resolveOutputs()` tree. */
export interface FlatVariable {
  id: string
  label: string | undefined
}

/**
 * Flatten a manifest's declared output tree (`properties`/`items` recursion)
 * into one list — the same shape `findVariableInTree` (`resolve-outputs.ts`)
 * and the browser's `findVariableInTree` (`store/var-availability.ts`) walk,
 * just collected instead of searched.
 */
export function flattenDeclared(vars: UnifiedVariable[]): FlatVariable[] {
  const out: FlatVariable[] = []
  const seen = new Set<string>()

  const walk = (v: UnifiedVariable) => {
    if (!seen.has(v.id)) {
      seen.add(v.id)
      out.push({ id: v.id, label: v.label })
    }
    if (v.properties) {
      for (const prop of Object.values(v.properties)) walk(prop)
    }
    if (v.items) walk(v.items)
  }

  for (const v of vars) walk(v)
  return out
}

/** Every variable key this node actually wrote, prefix-scoped to `nodeId`. */
export function writtenKeysForNode(ctx: ExecutionContextManager, nodeId: string): string[] {
  const all = ctx.getAllVariables()
  return Object.keys(all).filter((k) => k === nodeId || k.startsWith(`${nodeId}.`))
}

/**
 * Invariant 1 — declared ⊆ resolvable.
 *
 * Walks every declared id and calls the REAL `resolveVariablePath` with the
 * FULL id (nodeId prefix included — that IS the path shape
 * `resolveVariablePath` documents: `"webhook-123.body.contact.email"`, not a
 * bare `body.contact.email`). A pinned id is asserted to STAY broken
 * (`undefined`) so a fix flips the assertion and fails until the pin is
 * deleted — same contract as `contract-drift-allowlist.ts`.
 */
export async function assertDeclaredResolvable(
  ctx: ExecutionContextManager,
  declared: FlatVariable[],
  scenario: string
): Promise<void> {
  for (const { id } of declared) {
    const pin = matchDeclaredUnresolvablePin(id)
    const resolved = await ctx.resolveVariablePath(id)
    const effectivelyResolved = isEffectivelyResolved(resolved)
    if (pin) {
      expect(
        effectivelyResolved,
        `[${scenario}] pinned-broken "${id}" now resolves (${JSON.stringify(resolved)}) — ` +
          `retire its known-broken entry: ${pin}`
      ).toBe(false)
    } else {
      expect(
        effectivelyResolved,
        `[${scenario}] declared "${id}" did not resolve (got ${JSON.stringify(resolved)})`
      ).toBe(true)
    }
  }
}

/**
 * `resolved !== undefined` alone is too permissive for an array produced by
 * `resolveVariablePath`'s `[*]` map branch: mapping a per-item resolver that
 * fails over an array ALWAYS yields a defined array (`[undefined, undefined]`),
 * which would silently pass every findMany-item variant of a resolution bug
 * that findOne correctly catches (see `known-broken.ts`'s `tierAFieldPathPin`
 * doc comment). An array counts as resolved only if it's empty (a legitimate
 * "no results" answer) or has at least one non-undefined element.
 */
function isEffectivelyResolved(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length === 0 || value.some((v) => v !== undefined)
  }
  return value !== undefined
}

/**
 * Invariant 2 — written ⊆ declared.
 *
 * A written key is covered when it EQUALS a declared id, or NESTS under one
 * (`startsWith('<id>.')` or `startsWith('<id>[')`) — an object/array root
 * declares its whole subtree, not just its own literal id.
 */
export function assertWrittenCovered(
  writtenKeys: string[],
  declared: FlatVariable[],
  scenario: string
): void {
  const declaredIds = declared.map((d) => d.id)
  const isCovered = (key: string) =>
    declaredIds.some((id) => key === id || key.startsWith(`${id}.`) || key.startsWith(`${id}[`))

  for (const key of writtenKeys) {
    const pin = matchWrittenUndeclaredPin(key)
    const covered = isCovered(key)
    if (pin) {
      expect(
        covered,
        `[${scenario}] pinned-undeclared write "${key}" is now covered — retire its known-broken entry: ${pin}`
      ).toBe(false)
    } else {
      expect(covered, `[${scenario}] written "${key}" has no declared coverage`).toBe(true)
    }
  }
}

/**
 * Invariant 3 — label coverage.
 *
 * Every declared id must carry a non-empty `label`; an absent one falls back
 * to the raw id segment in the picker (`buildVariableLabelPath`), which for
 * an entity-def resource means a CUID renders where a name should.
 */
export function assertLabelCoverage(declared: FlatVariable[], scenario: string): void {
  for (const { id, label } of declared) {
    const pin = matchMissingLabelPin(id)
    const hasLabel = typeof label === 'string' && label.trim().length > 0
    if (pin) {
      expect(
        hasLabel,
        `[${scenario}] pinned-no-label "${id}" now has a label ("${label}") — retire its known-broken entry: ${pin}`
      ).toBe(false)
    } else {
      expect(
        hasLabel,
        `[${scenario}] declared "${id}" has no label — the picker would render the raw id segment`
      ).toBe(true)
    }
  }
}

/** Run all three invariants for one scenario in one call. */
export async function assertResolvability(
  ctx: ExecutionContextManager,
  writtenKeys: string[],
  declared: FlatVariable[],
  scenario: string
): Promise<void> {
  assertLabelCoverage(declared, scenario)
  assertWrittenCovered(writtenKeys, declared, scenario)
  await assertDeclaredResolvable(ctx, declared, scenario)
}
