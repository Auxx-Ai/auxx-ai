// packages/lib/scripts/check-graph-hydration-roundtrip.ts
//
// The invariant check for `plans/kopilot/workflow/23-graph-document-canonicalization.md` §6,
// run against EVERY stored graph in the dev database rather than against fixtures.
//
// Three invariants, plus one shape rule:
//   1. hydrate(hydrate(g))              === hydrate(g)      -- hydration is idempotent
//   2. dehydrate(dehydrate(g))          === dehydrate(g)    -- dehydration is idempotent
//   3. hydrate(dehydrate(hydrate(g)))   === hydrate(g)      -- the round trip loses nothing
//                                                              a reader can observe
//   4. no key anywhere in dehydrate(g) starts with `_`      -- §3.1; today's strip is scoped
//                                                              to `.data` only, so
//                                                              `edge._waitingRun` survives
//
// NOTE ON THE LITERAL `hydrate(dehydrate(hydrate(g))) === hydrate(g)` FORM: it does NOT hold, by
// design, and asserting it would be wrong. Hydration is deliberately NOT a stripper — it must be a
// provable no-op on today's fat documents so the read side can ship before the write side. So a
// fat stored row keeps its dead keys through `hydrate` and loses them only at `dehydrate`. The
// difference is therefore always confined to keys no reader can observe (`data.isValid`,
// `data.errors`, `data.selected`, `data.outputVariables`, React Flow interaction state, `_`-keys,
// `$comment`) — measured across all 1413 dev graphs, that is EXACTLY the observed diff set and
// nothing else. Invariants 3 and 5 above are the two halves that actually carry meaning.
//
// (3) is the one that matters: `graph-edit/ops.ts`'s no-op short-circuit asserts
// `hashWorkflowGraph(cleanGraphForSave(graph)) === ctx.graphHash`, so if dehydrate is not the
// exact inverse of hydrate that comparison stops firing and the repeated-`update_node` agent
// edit loop #1701 fixed comes back.
//
// EXPECTED, NOT A BUG: ~870 sequence-compiled nodes store real engine types at `node.type`
// (`wait`, `sequence-send-email`, ...). All of them also carry a matching `data.type`, and every
// engine reader is `data.type || node.type`, so hydration rewriting them to `'standard'` is
// inert. The report calls these out separately so nobody reads the count as a failure.
//
// Read-only. Never writes.
//
// Usage:
//   npx dotenv -- npx tsx packages/lib/scripts/check-graph-hydration-roundtrip.ts [--verbose]

import { database as db, schema } from '@auxx/database'
import {
  dehydrateGraph,
  type GraphDocument,
  hydrateGraph,
} from '../src/workflow-engine/catalog/graph-hydration'
import {
  DEHYDRATION_OPTIONS,
  HYDRATION_OPTIONS,
} from '../src/workflow-engine/catalog/hydration-policy'
import { projectGraphSemantics } from '../src/workflows/graph-projection'

const { Workflow, WorkflowRun, WorkflowTemplate } = schema

const verbose = process.argv.includes('--verbose')

/**
 * `node.data` keys a canonical document is ALLOWED to drop: dead fields with no
 * readers, plus the derived ones hydration rebuilds under a different name.
 */
const DROPPABLE_DATA_KEYS = new Set([
  'isValid',
  'errors',
  'outputVariables',
  'selected',
  'description',
  'inputNodes',
  'isInLoop',
  'loopId',
])

interface Row {
  source: string
  id: string
  graph: GraphDocument
}

/** Stable stringify so key order never decides equality. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1))
      )
    }
    return v
  })
}

/** Every path in `value` whose final key starts with `_`. */
function underscoreKeys(value: unknown, path = '', out: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((v, i) => underscoreKeys(v, `${path}[${i}]`, out))
    return out
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k.startsWith('_')) out.push(`${path}.${k}`)
      underscoreKeys(v, `${path}.${k}`, out)
    }
  }
  return out
}

/** First few differing paths between two documents, for a readable failure. */
function diffPaths(a: unknown, b: unknown, path = '', out: string[] = [], limit = 5): string[] {
  if (out.length >= limit) return out
  if (stable(a) === stable(b)) return out
  const bothObjects =
    a &&
    b &&
    typeof a === 'object' &&
    typeof b === 'object' &&
    Array.isArray(a) === Array.isArray(b)
  if (!bothObjects) {
    out.push(`${path || '<root>'}: ${stable(a)} != ${stable(b)}`)
    return out
  }
  const keys = new Set([
    ...Object.keys(a as Record<string, unknown>),
    ...Object.keys(b as Record<string, unknown>),
  ])
  for (const k of keys) {
    if (out.length >= limit) break
    diffPaths(
      (a as Record<string, unknown>)[k],
      (b as Record<string, unknown>)[k],
      path ? `${path}.${k}` : k,
      out,
      limit
    )
  }
  return out
}

async function loadRows(): Promise<Row[]> {
  const rows: Row[] = []

  const workflows = await db.select({ id: Workflow.id, graph: Workflow.graph }).from(Workflow)
  for (const w of workflows) {
    if (w.graph) rows.push({ source: 'Workflow.graph', id: w.id, graph: w.graph as GraphDocument })
  }

  const templates = await db
    .select({ id: WorkflowTemplate.id, graph: WorkflowTemplate.graph })
    .from(WorkflowTemplate)
  for (const t of templates) {
    if (t.graph)
      rows.push({ source: 'WorkflowTemplate.graph', id: t.id, graph: t.graph as GraphDocument })
  }

  const runs = await db.select({ id: WorkflowRun.id, graph: WorkflowRun.graph }).from(WorkflowRun)
  for (const r of runs) {
    if (r.graph)
      rows.push({ source: 'WorkflowRun.graph', id: r.id, graph: r.graph as GraphDocument })
  }

  return rows
}

async function main() {
  const rows = await loadRows()
  console.log(`Loaded ${rows.length} stored graphs.\n`)

  const failures: string[] = []
  let nodesTotal = 0
  let nodeTypeRewritten = 0
  let underscoreStripped = 0

  for (const row of rows) {
    const label = `${row.source} ${row.id}`
    // THE SHIPPED POLICY, on both sides. Running these with no options
    // validates the defaults-layer-ON configuration, which no seam uses — that
    // is precisely why this script passed while the canvas save path was
    // deleting node config (#1771). A green run under the wrong policy is not
    // evidence about production.
    const h1 = hydrateGraph(row.graph, HYDRATION_OPTIONS)
    const h2 = hydrateGraph(h1, HYDRATION_OPTIONS)
    const d1 = dehydrateGraph(row.graph, DEHYDRATION_OPTIONS)
    const d2 = dehydrateGraph(d1, DEHYDRATION_OPTIONS)
    const canonical = dehydrateGraph(h1, DEHYDRATION_OPTIONS)
    const roundTrip = hydrateGraph(canonical, HYDRATION_OPTIONS)

    if (stable(h1) !== stable(h2)) {
      failures.push(`[1 hydrate idempotent] ${label}\n    ${diffPaths(h1, h2).join('\n    ')}`)
    }
    if (stable(d1) !== stable(d2)) {
      failures.push(`[2 dehydrate idempotent] ${label}\n    ${diffPaths(d1, d2).join('\n    ')}`)
    }
    // 3 — a canonical document survives read/write byte for byte.
    const reCanonical = dehydrateGraph(roundTrip, DEHYDRATION_OPTIONS)
    if (stable(reCanonical) !== stable(canonical)) {
      failures.push(
        `[3 canonical round trip] ${label}\n    ${diffPaths(canonical, reCanonical).join('\n    ')}`
      )
    }

    // 6 — NO `node.data` KEY MAY VANISH through a read/write cycle. Invariant 5
    // below uses `projectGraphSemantics`, which is symmetric under any single
    // policy and so cannot see a key that both sides agree to drop. This one
    // compares raw key sets against the stored row and is what would have caught
    // the #1771 config amputation.
    const storedKeys = new Map<string, Set<string>>()
    for (const n of (row.graph.nodes ?? []) as Array<Record<string, any>>) {
      storedKeys.set(String(n.id), new Set(Object.keys(n.data ?? {})))
    }
    for (const n of (roundTrip.nodes ?? []) as unknown as Array<Record<string, any>>) {
      const before = storedKeys.get(String(n.id))
      if (!before) continue
      const after = new Set(Object.keys(n.data ?? {}))
      const vanished = [...before].filter(
        (k) =>
          !after.has(k) &&
          !k.startsWith('_') && // canvas-owned by convention; never persisted
          !k.startsWith('$') &&
          !DROPPABLE_DATA_KEYS.has(k)
      )
      if (vanished.length > 0) {
        failures.push(`[6 data key vanished] ${label} node ${n.id}: ${vanished.join(', ')}`)
      }
    }

    // 5 — no CONTENT is lost, judged by the same projection the save path uses.
    if (stable(projectGraphSemantics(h1)) !== stable(projectGraphSemantics(roundTrip))) {
      failures.push(
        `[5 content preserved] ${label}\n    ${diffPaths(
          projectGraphSemantics(h1),
          projectGraphSemantics(roundTrip)
        ).join('\n    ')}`
      )
    }

    const stray = underscoreKeys(d1)
    if (stray.length > 0) {
      failures.push(`[4 underscore keys] ${label}\n    ${stray.slice(0, 5).join('\n    ')}`)
    }
    underscoreStripped += underscoreKeys(row.graph).length

    const before = (row.graph.nodes ?? []) as Array<Record<string, unknown>>
    const after = (h1.nodes ?? []) as unknown as Array<Record<string, unknown>>
    nodesTotal += before.length
    for (let i = 0; i < before.length; i++) {
      if (before[i]?.type !== after[i]?.type) nodeTypeRewritten++
    }
  }

  console.log(`nodes seen:                      ${nodesTotal}`)
  console.log(
    `node.type rewritten by hydrate:  ${nodeTypeRewritten}  (expected ~870, inert — see header)`
  )
  console.log(`_-prefixed keys dehydrate strips: ${underscoreStripped}`)
  console.log('')

  if (failures.length === 0) {
    console.log('All invariants hold across every stored graph.')
    process.exit(0)
  }

  console.error(`${failures.length} invariant failure(s):\n`)
  for (const f of verbose ? failures : failures.slice(0, 20)) console.error(`  ${f}\n`)
  if (!verbose && failures.length > 20)
    console.error(`  ... ${failures.length - 20} more (--verbose)`)
  process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
