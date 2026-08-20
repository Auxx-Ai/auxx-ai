// apps/web/src/components/workflow/parity/branch-scope-parity.test.ts

import {
  resolveGraphOutputs,
  type WorkflowOutputGraph,
} from '@auxx/lib/workflow-engine/catalog/resolve-outputs'
import {
  BaseType,
  buildUpstreamHandleMap,
  type EdgeMeta,
  getManifest,
  type NodeMeta,
  type Resource,
  type ResourceField,
  type UnifiedVariable,
} from '@auxx/lib/workflow-engine/client'
import { checkVariableRefsAgainstOutputs } from '@auxx/lib/workflows/graph-edit'
import { describe, expect, it, vi } from 'vitest'
import { scopeAncestorOutputs } from '~/components/workflow/store/branch-scope'

// ═══════════════════════════════════════════════════════════════════════════
// 🔴 BRANCH-SCOPE PARITY — PICKER VS REF-CHECKER
//
// Plan 24 §8: "a picker that narrows while the validator does not is a lie,
// and the reverse is a false refusal." Both consumers read the same ancestry
// (`buildUpstreamHandleMap`) and the same per-handle rule
// (`scopeOutputsToHandle`), so they cannot disagree about what a HANDLE
// carries. What they can still disagree about is the layer above that: how
// each turns a set of reachable handles into an answer for the author.
//
// - The picker (`store/branch-scope.ts` → `use-var-store.ts`) answers by
//   OFFERING: hard-filter what no reachable handle writes, mark what only some
//   of them write, offer the rest plain.
// - The ref checker (`graph-edit/normalize/ref-check.ts`) answers by FINDING:
//   `warning` for the first case, `info` for the second, silence for the third.
//
// This suite builds one graph, runs BOTH, and asserts the three-way
// correspondence ref by ref. It is the test that makes "both consumers agree"
// a fact rather than a claim — and it is a real comparison, not a re-derivation:
// neither side's expected answer is computed from the other's, and the two code
// paths share no function above `scopeOutputsToHandle` itself.
//
// The fixture deliberately carries BOTH shapes plan 24 distinguishes:
//   • single-path consumers (reachable on exactly one of crud's handles), where
//     the narrowing actually bites — this is the reported bug;
//   • a CONVERGENCE consumer (reachable on both), where the union rule means
//     nothing is filtered and the marker is the only signal. §4.6.
//
// Output RESOLUTION parity — that both sides build the same variable tree in
// the first place — is `output-resolution-parity.test.ts`'s job, so both sides
// here start from one `resolveGraphOutputs` result. This suite isolates the
// scoping layer on top of it.
// ═══════════════════════════════════════════════════════════════════════════

const getCachedResources = vi.hoisted(() => vi.fn())

vi.mock('@auxx/lib/cache/org-cache-helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/lib/cache/org-cache-helpers')>()),
  getCachedResources,
}))

const ORG_ID = 'org-branch-scope-test'

function field(overrides: { id: string; key: string; label: string }): ResourceField {
  return {
    ...overrides,
    type: BaseType.STRING,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: true,
    },
  } as unknown as ResourceField
}

const FIXTURE_RESOURCE: Resource = {
  type: 'custom',
  id: 'entity_vendor',
  label: 'Vendor',
  plural: 'Vendors',
  icon: 'box',
  color: 'blue',
  isVisible: true,
  entityType: 'entity_vendor',
  apiSlug: 'vendors',
  entityDefinitionId: 'entity_vendor',
  organizationId: ORG_ID,
  fields: [field({ id: 'email', key: 'email', label: 'Email' })],
  display: {
    primaryDisplayField: null,
    secondaryDisplayField: null,
    avatarField: null,
    defaultSortField: 'updatedAt',
    defaultSortDirection: 'desc',
    orgScopingStrategy: 'direct',
  },
}

getCachedResources.mockResolvedValue([FIXTURE_RESOURCE])

// ── The fixture graph — plan 24 §4.3, with the join wired ────────────────────
//
//   Manual ─→ Create Vendor (crud, create, error_strategy: 'fail')
//                  ├─[source]─→ Send Welcome ──┐
//                  └─[fail]───→ Log Failure ───┴─→ Notify Ops
//
const CRUD_ID = 'create-vendor'
const ON_SUCCESS = 'send-welcome'
const ON_FAILURE = 'log-failure'
const JOIN = 'notify-ops'

/**
 * Every top-level output the crud node declares under this config. Spelled out
 * rather than derived so a manifest change that silently drops one fails here
 * instead of quietly shrinking the assertion.
 */
const CRUD_OUTPUTS = [
  'entity_vendor',
  'success',
  'operation',
  'resourceType',
  'error',
  'errorDetails',
  'id',
  'record',
] as const

/** `answer` reads `{{…}}` refs out of `data.text`, so one field carries them all. */
const refsToEveryCrudOutput = () => CRUD_OUTPUTS.map((key) => `{{${CRUD_ID}.${key}}}`).join(' ')

function answerNode(id: string): NodeMeta {
  const manifest = getManifest('answer')
  if (!manifest?.defaultData) throw new Error('answer manifest is missing defaultData')
  return {
    id,
    type: 'answer',
    data: {
      ...manifest.defaultData(),
      id,
      type: 'answer',
      title: id,
      text: refsToEveryCrudOutput(),
    },
  }
}

function crudNode(): NodeMeta {
  const manifest = getManifest('crud')
  if (!manifest?.defaultData) throw new Error('crud manifest is missing defaultData')
  return {
    id: CRUD_ID,
    type: 'crud',
    data: {
      ...manifest.defaultData(),
      id: CRUD_ID,
      type: 'crud',
      title: 'Create Vendor',
      resourceType: FIXTURE_RESOURCE.id,
      mode: 'create',
      error_strategy: 'fail',
    },
  }
}

const FIXTURE_NODES: NodeMeta[] = [
  { id: 'trigger', type: 'manual', data: { id: 'trigger', type: 'manual', title: 'Manual' } },
  crudNode(),
  answerNode(ON_SUCCESS),
  answerNode(ON_FAILURE),
  answerNode(JOIN),
]

const FIXTURE_EDGES: EdgeMeta[] = [
  { id: 'e1', source: 'trigger', target: CRUD_ID, sourceHandle: 'source' },
  { id: 'e2', source: CRUD_ID, target: ON_SUCCESS, sourceHandle: 'source' },
  { id: 'e3', source: CRUD_ID, target: ON_FAILURE, sourceHandle: 'fail' },
  { id: 'e4', source: ON_SUCCESS, target: JOIN, sourceHandle: 'source' },
  { id: 'e5', source: ON_FAILURE, target: JOIN, sourceHandle: 'source' },
]

const FIXTURE_GRAPH: WorkflowOutputGraph = { nodes: FIXTURE_NODES, edges: FIXTURE_EDGES }

/** What the picker offers a consumer from the crud node, and what it marks. */
function pickerAnswer(
  consumerId: string,
  outputs: Map<string, UnifiedVariable[]>
): { offered: Set<string>; conditional: Set<string> } {
  const handles = buildUpstreamHandleMap(FIXTURE_EDGES, FIXTURE_NODES).get(consumerId)?.get(CRUD_ID)
  const crud = FIXTURE_NODES.find((n) => n.id === CRUD_ID)
  const { variables, conditional } = scopeAncestorOutputs({
    ancestorId: CRUD_ID,
    handles,
    declared: outputs.get(CRUD_ID) ?? [],
    errorHandling: getManifest('crud')?.errorHandling,
    config: crud?.data,
  })
  const strip = (id: string) => id.slice(`${CRUD_ID}.`.length)
  return {
    offered: new Set(variables.map((v) => strip(v.id))),
    conditional: new Set(Array.from(conditional, strip)),
  }
}

/** What the ref checker says about each of this consumer's crud refs. */
function checkerAnswer(
  consumerId: string,
  outputs: Map<string, UnifiedVariable[]>
): Map<string, 'warning' | 'info'> {
  const { issues } = checkVariableRefsAgainstOutputs({
    graph: FIXTURE_GRAPH,
    outputs,
    lookup: getManifest,
  })
  const consumerTitle = FIXTURE_NODES.find((n) => n.id === consumerId)?.data.title
  const byKey = new Map<string, 'warning' | 'info'>()
  for (const issue of issues) {
    if (!issue.ref?.startsWith(`${CRUD_ID}.`)) continue
    if (!issue.nodeRef?.includes(String(consumerTitle))) continue
    if (issue.severity !== 'warning' && issue.severity !== 'info') continue
    byKey.set(issue.ref.slice(`${CRUD_ID}.`.length), issue.severity)
  }
  return byKey
}

describe('branch-scope parity: picker vs ref-checker', () => {
  it('the crud fixture actually declares every output the assertions name', async () => {
    const resolved = await resolveGraphOutputs(ORG_ID, { graph: FIXTURE_GRAPH })
    if (resolved.isErr()) throw resolved.error
    const declared = new Set(
      (resolved.value.get(CRUD_ID) ?? []).map((v) => v.id.slice(`${CRUD_ID}.`.length))
    )
    // Guards the whole suite against passing vacuously: if crud stops
    // declaring the record tree, every "offered" assertion below would still
    // pass while testing nothing.
    expect(declared).toEqual(new Set(CRUD_OUTPUTS))
  })

  it('offers a fail-branch consumer only what the failure path writes (§4.3, acceptance #2)', async () => {
    const resolved = await resolveGraphOutputs(ORG_ID, { graph: FIXTURE_GRAPH })
    if (resolved.isErr()) throw resolved.error

    const { offered, conditional } = pickerAnswer(ON_FAILURE, resolved.value)

    // Exactly the five-key status block `handleCrudError` writes before the
    // strategy switch. The record tree, `id` and `record` are gone — that is
    // the reported bug, fixed.
    expect(offered).toEqual(
      new Set(['success', 'error', 'errorDetails', 'operation', 'resourceType'])
    )
    // One reachable handle ⇒ nothing is path-conditional.
    expect(conditional).toEqual(new Set())
  })

  it('offers a success-branch consumer everything except the failure-only keys', async () => {
    const resolved = await resolveGraphOutputs(ORG_ID, { graph: FIXTURE_GRAPH })
    if (resolved.isErr()) throw resolved.error

    const { offered, conditional } = pickerAnswer(ON_SUCCESS, resolved.value)

    // `error`/`errorDetails` are written as an explicit `null` on the success
    // path under strategy `fail`, so offering them would offer a variable whose
    // only possible value is a logged warning (§6.1a).
    expect(offered).toEqual(
      new Set(['entity_vendor', 'success', 'operation', 'resourceType', 'id', 'record'])
    )
    expect(conditional).toEqual(new Set())
  })

  it('offers a convergence consumer the full union, and marks the difference (§4.6)', async () => {
    const resolved = await resolveGraphOutputs(ORG_ID, { graph: FIXTURE_GRAPH })
    if (resolved.isErr()) throw resolved.error

    const { offered, conditional } = pickerAnswer(JOIN, resolved.value)

    // Union over paths, not intersection: nothing is filtered at a join. This
    // is byte-identical to the pre-plan-24 picker, which is exactly why the
    // marker below is the only thing that makes it honest.
    expect(offered).toEqual(new Set(CRUD_OUTPUTS))

    // `union − intersection`. Both directions land here: the source-only record
    // keys AND the fail-only error keys are each written on one of the two
    // reachable handles.
    expect(conditional).toEqual(new Set(['entity_vendor', 'id', 'record', 'error', 'errorDetails']))

    // The three the engine writes on both paths stay unmarked.
    const alwaysWritten = ['success', 'operation', 'resourceType']
    for (const key of alwaysWritten) {
      expect(conditional.has(key), `"${key}" is written on both paths`).toBe(false)
    }
  })

  it('picker and ref-checker agree ref-for-ref on every consumer', async () => {
    const resolved = await resolveGraphOutputs(ORG_ID, { graph: FIXTURE_GRAPH })
    if (resolved.isErr()) throw resolved.error
    const outputs = resolved.value

    let compared = 0
    for (const consumerId of [ON_SUCCESS, ON_FAILURE, JOIN]) {
      const picker = pickerAnswer(consumerId, outputs)
      const checker = checkerAnswer(consumerId, outputs)

      for (const key of CRUD_OUTPUTS) {
        compared++
        const where = `${consumerId} → {{${CRUD_ID}.${key}}}`

        if (!picker.offered.has(key)) {
          // Hard-filtered by the picker ⇒ the checker must say it will be empty.
          expect(checker.get(key), `${where}: filtered by picker`).toBe('warning')
          continue
        }
        if (picker.conditional.has(key)) {
          // Marked by the picker ⇒ the checker must call it path-conditional.
          expect(checker.get(key), `${where}: marked conditional by picker`).toBe('info')
          continue
        }
        // Offered plain ⇒ the checker must be silent.
        expect(checker.get(key), `${where}: offered plain by picker`).toBeUndefined()
      }
    }

    // Loud-failure guard: three consumers × eight outputs. A fixture that
    // quietly stopped covering the join would still pass every assertion above.
    expect(compared).toBe(24)
  })

  it('never blocks a write — branch scope is warning/info, never error', async () => {
    const resolved = await resolveGraphOutputs(ORG_ID, { graph: FIXTURE_GRAPH })
    if (resolved.isErr()) throw resolved.error

    const { issues } = checkVariableRefsAgainstOutputs({
      graph: FIXTURE_GRAPH,
      outputs: resolved.value,
      lookup: getManifest,
    })

    // `ops.ts` gates the blocking tier on `severity === 'error'`. Every ref in
    // this fixture points at a genuinely declared output of a genuinely
    // upstream node, so scope is the only thing that could have anything to say
    // about them — and it must never refuse the edit (§8.3).
    const crudRefErrors = issues.filter(
      (i) => i.severity === 'error' && i.ref?.startsWith(`${CRUD_ID}.`)
    )
    expect(crudRefErrors).toEqual([])
  })
})
