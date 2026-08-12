// apps/web/src/components/workflow/parity/builder-engine-parity.test.ts

import { describe, expect, it } from 'vitest'
import type { UnifiedVariable } from '~/components/workflow/types/variable-types'
import {
  EXTRACTION_BLIND_SPOTS,
  KNOWN_BROKEN_CONFIG_KEYS,
  KNOWN_BROKEN_FAILURE_PATH_WRITES,
  KNOWN_BROKEN_OUTPUT_VARIABLES,
} from './contract-drift-allowlist'
import {
  advertisedPath,
  builderDeclaredKeys,
  isPathWritten,
  readEngineContracts,
} from './engine-contract'
import { BUILDER_NODE_DEFINITIONS, CONFIG_VARIANTS } from './node-definitions'

// ═══════════════════════════════════════════════════════════════════════════
// 🔴 THE BUILDER HALF OF THE BUILDER↔ENGINE PARITY SUITE
//
// Modelled on `packages/lib/src/mail-query/__tests__/condition-query-builder.test.ts:377`
// — at audit time the only assertion in the repo that "everything the UI offers
// actually dispatches", and the only condition surface that had not drifted.
//
// The workflow builder and the workflow engine agree on two contracts, and
// neither is expressed in a type:
//
//   1. OUTPUT VARIABLES. The builder's `outputVariables(config, nodeId, ctx)`
//      is what the variable picker offers downstream nodes. The engine makes a
//      value addressable ONLY by calling `setNodeVariable(nodeId, path, value)`.
//      A path the picker offers that the engine never writes resolves to `''`
//      (or `undefined`) at run time — no error, no warning, just a branch that
//      never fires or an email with a hole in it.
//
//   2. CONFIG KEYS. The panel writes `node.data.<key>`; the processor reads it.
//      A rename on one side is a silent no-op on the other — the audit's
//      `data.assigneeId` vs `data.assignee` and `config.logic` findings.
//
// This half lives in `apps/web` and not beside the engine because the
// declarations it reads are here: `nodes/core/*/schema.ts`. `packages/lib` is
// dependency tier 3 and must never import from tier 5. The engine's side is
// therefore read STATICALLY — see `engine-contract.ts` for exactly what that
// extraction can and cannot see.
//
// The OPERATOR third of the suite lives in `packages/lib`, where both sides
// already are: `src/workflow-engine/nodes/condition-nodes/operator-parity.test.ts`.
//
// ── Expect this to fail loudly, and read `contract-drift-allowlist.ts` ──────
// It was landed against a codebase that had already drifted. The allowlist is
// the point: it makes the drift a written-down list with reasons instead of an
// invisible class of bug, and it fails on a STALE entry too, so a fix forces
// its own line to be deleted.
// ═══════════════════════════════════════════════════════════════════════════

const ENGINE = readEngineContracts()
const NODE_ID = 'n1'

/** The context an `outputVariables` function receives on a cold builder load. */
const outputVariableContext = {
  resource: undefined,
  allResources: [],
  resolveVariable: () => undefined,
}

/**
 * Flatten a picker variable tree into the paths a downstream node can type.
 *
 * `UnifiedVariable` nests through `properties` (objects) and `items` (arrays),
 * and every node in that tree carries its own full-path `id` — those nested ids
 * are exactly what the picker inserts, so each one is a contract claim.
 */
function flatten(variables: UnifiedVariable[], into = new Set<string>()): Set<string> {
  for (const variable of variables) {
    if (variable?.id) into.add(variable.id)
    if (variable?.properties) flatten(Object.values(variable.properties), into)
    if (variable?.items) flatten([variable.items], into)
  }
  return into
}

/** Configs to evaluate a node's `outputVariables` under. */
function configsFor(nodeType: string, defaultData: Record<string, unknown>) {
  return [
    { label: 'default config', data: defaultData },
    ...(CONFIG_VARIANTS[nodeType] ?? []).map((variant) => ({
      label: variant.label,
      data: { ...defaultData, ...variant.data },
    })),
  ]
}

/**
 * The keys the builder can persist for a node type.
 *
 * Panels write whole objects through `useNodeCrud`, so there is no per-key
 * "writer" to grep for. The surface is therefore the union of everything that
 * declares the shape: the zod schema, the seeded defaults, and the node's own
 * `types.ts` interface. A key in none of the three is a key nothing on the
 * builder side can produce.
 */
function builderDataKeys(
  definition: { schema?: unknown; defaultData?: Record<string, unknown> },
  builderDir: string
): Set<string> {
  const schema = definition.schema as
    | { shape?: Record<string, unknown>; _def?: { shape?: Record<string, unknown> } }
    | undefined
  const shape = schema?.shape ?? schema?._def?.shape ?? {}
  return new Set([
    ...Object.keys(shape),
    ...Object.keys(definition.defaultData ?? {}),
    ...builderDeclaredKeys(builderDir),
  ])
}

// ───────────────────────────────────────────────────────────────────────────
// Allowlist plumbing — the same discipline as the operator half.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Diff the observed failure set against the allowlist and fail on EITHER side.
 *
 * - A failure not in the allowlist is new drift.
 * - An allowlist entry that no longer fails is stale: the bug is fixed and the
 *   line has to go, or the list grows forever and stops meaning anything.
 *
 * Set `WORKFLOW_PARITY_PRINT_ALLOWLIST=1` to print the current failure set as a
 * copy-pasteable object literal — see the header of `contract-drift-allowlist.ts`.
 */
function assertAgainstAllowlist(
  observed: Map<string, string>,
  /**
   * The entry-key prefix this assertion owns. The allowlist maps are shared
   * (`EXTRACTION_BLIND_SPOTS` carries entries for several assertions), so
   * without this filter every assertion would report the other assertions'
   * entries as `unexpectedPasses`.
   */
  prefix: string,
  ...allowlists: Array<Record<string, string>>
) {
  const merged = Object.assign({}, ...allowlists) as Record<string, string>
  const allowed = Object.fromEntries(
    Object.entries(merged).filter(([key]) => key.startsWith(prefix))
  )

  if (process.env.WORKFLOW_PARITY_PRINT_ALLOWLIST) {
    const literal = Array.from(observed.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, detail]) => `  ${JSON.stringify(key)}: ${JSON.stringify(detail)},`)
      .join('\n')
    console.log(`\n// regenerated allowlist entries\n{\n${literal}\n}\n`)
  }

  const unexpectedFailures = Array.from(observed.entries())
    .filter(([key]) => !(key in allowed))
    .map(([key, detail]) => `${key} — ${detail}`)
    .sort()
  const unexpectedPasses = Object.keys(allowed)
    .filter((key) => !observed.has(key))
    .sort()

  // Keyed so a failure names the exact entries rather than printing two sets.
  expect({ unexpectedFailures, unexpectedPasses }).toEqual({
    unexpectedFailures: [],
    unexpectedPasses: [],
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// 0. THE READER ITSELF
//
// The parity assertions are only as good as what `engine-contract.ts` can see,
// and a blind spot there does not fail — it MIS-CLASSIFIES, which is worse. The
// reader shipped blind to `setNodeVariables` (the bulk writer, execution-context
// .ts:282) and so reported four nodes as "advertises but never writes" when they
// publish everything correctly. That reads as a burn-down item and sends someone
// to fix what is already fixed.
//
// These pin the three payload shapes the bulk writer is called with.
// ═══════════════════════════════════════════════════════════════════════════

describe('engine reader — resolves the bulk setNodeVariables writer', () => {
  it('reads an inline object literal, including quoted dotted keys', () => {
    // `manual.ts` publishes `'file.id'` / `'file.filename'` as QUOTED keys.
    // Those are real advertised paths, so a parser that only accepts bare
    // identifiers loses them.
    const manual = ENGINE.get('manual')
    expect(manual?.writes).toEqual(
      expect.arrayContaining(['files', 'file', 'file.id', 'fileCount'])
    )
  })

  it('resolves a payload identifier one hop back to its const object literal', () => {
    // `loop.ts`: `const output = { totalIterations, completedIterations, … }`
    // then `setNodeVariables(node.nodeId, output)` some lines later.
    const loop = ENGINE.get('loop')
    expect(loop?.writes).toEqual(expect.arrayContaining(['totalIterations', 'completedIterations']))
  })

  it('records an unreadable payload rather than guessing at its keys', () => {
    // A spread (`...this.buildResultOutputs(…)`), a function call
    // (`buildApprovalDecisionVariables(…)`, now in core/pause-resume.ts) and a
    // parameter (`publishWaitOutputs(node, cm, output)`) are all unknowable.
    // They must surface as gaps, so their findings are filed as blind spots
    // instead of drift.
    expect(ENGINE.get('loop')?.unresolvedBulkWrites.join(' ')).toContain('spread')
    expect(ENGINE.get('wait')?.unresolvedBulkWrites).not.toEqual([])
    expect(ENGINE.get('human-confirmation')?.unresolvedBulkWrites).not.toEqual([])
  })
})

describe('engine reader — attributes a .data read to the right node and the right file', () => {
  it('separates a read of a FOREIGN node pulled out of the graph', () => {
    // `manual.ts` reads `inputType` / `typeOptions` off the connected FORM-INPUT
    // node it fetches from `sys.workflow.graph.nodes`. Scored against `manual`'s
    // own panel — which declares neither — they read as drift, and two of them
    // were filed that way. They belong to form-input, which does declare them.
    const manual = ENGINE.get('manual')
    expect(manual?.dataReads).not.toContain('inputType')
    expect(Object.keys(manual?.foreignDataReads ?? {}).sort()).toEqual(['inputType', 'typeOptions'])
    // The binding is carried so the NOTE can name it.
    expect(manual?.foreignDataReads.inputType).toContain('nodes.find(')
  })

  it('names the ancestor file a read came from', () => {
    // The ancestor walk itself: `AIProcessorV2` and `TextClassifierProcessor`
    // both extend `BaseAiNodeProcessor`, and neither writes `text` in its own
    // file.
    expect(ENGINE.get('ai')?.writes).toContain('text')
    expect(ENGINE.get('text-classifier')?.writes).toContain('text')

    // The same walk unions the ancestors' READS in, which is how ONE legacy
    // `outputVariable` read on `base-ai-node.ts` was reported twice — once as
    // `config:ai.outputVariable`, once as `config:text-classifier.outputVariable`
    // — and chased by two people, the second of whom could only ever have fixed
    // it in the first's file. Every inherited read now names the file it lives
    // in. Empty today (the AI base reads only `model`, which both subclasses
    // read themselves); this pins the shape, not the count.
    for (const [nodeType, contract] of ENGINE) {
      for (const [key, file] of Object.entries(contract.inheritedDataReads)) {
        expect(`${nodeType}.${key} -> ${file}`).toMatch(/\.ts$/)
        expect(contract.files).not.toContain(file)
      }
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 1. OUTPUT VARIABLES
// ═══════════════════════════════════════════════════════════════════════════

describe('output variables — every path the picker offers is one the engine writes', () => {
  it('has an engine processor for every node type in the palette', () => {
    // A node with no REGISTERED processor fails at the node itself
    // (`No processor found for node type: …`), so its variables are moot. Split
    // out from the path check so the failure names the real cause.
    const observed = new Map<string, string>()
    for (const { nodeType } of BUILDER_NODE_DEFINITIONS) {
      const contract = ENGINE.get(nodeType)
      if (!contract) observed.set(`processor:${nodeType}`, 'no engine processor declares this type')
      else if (!contract.registered) {
        observed.set(
          `processor:${nodeType}`,
          `processor exists (${contract.files.join(', ')}) but is not registered in initializeWithDefaults`
        )
      }
    }
    assertAgainstAllowlist(
      observed,
      'processor:',
      KNOWN_BROKEN_OUTPUT_VARIABLES,
      EXTRACTION_BLIND_SPOTS
    )
  })

  it('writes every advertised path via setNodeVariable', () => {
    const observed = new Map<string, string>()

    for (const { nodeType, definition } of BUILDER_NODE_DEFINITIONS) {
      const contract = ENGINE.get(nodeType)
      // Covered by the processor assertion above; nothing to say about paths.
      if (!contract) continue

      for (const config of configsFor(nodeType, definition.defaultData ?? {})) {
        let advertised: Set<string>
        try {
          advertised = flatten(
            definition.outputVariables(config.data, NODE_ID, outputVariableContext) ?? []
          )
        } catch (error) {
          observed.set(
            `variable:${nodeType}:<threw>`,
            `outputVariables threw under ${config.label}: ${(error as Error).message}`
          )
          continue
        }

        for (const id of advertised) {
          const path = advertisedPath(id, NODE_ID)
          if (isPathWritten(path, contract.writes)) continue
          // Name the unresolvable bulk payloads in the detail. Whoever
          // regenerates the allowlist has to decide "real drift" vs "blind
          // spot", and a node with an unreadable `setNodeVariables` payload may
          // well write this path — that is a blind spot, not a bug to fix.
          const blindSpot = contract.unresolvedBulkWrites.length
            ? ` — NOTE: unresolvable bulk setNodeVariables payload(s) here: ${contract.unresolvedBulkWrites.join('; ')}`
            : ''
          observed.set(
            `variable:${nodeType}.${path}`,
            `advertised under ${config.label}; no setNodeVariable(s) writes it (${contract.files.join(', ')})${blindSpot}`
          )
        }
      }
    }

    assertAgainstAllowlist(
      observed,
      'variable:',
      KNOWN_BROKEN_OUTPUT_VARIABLES,
      EXTRACTION_BLIND_SPOTS
    )
  })

  it('does not advertise a path the engine writes only on the failure branch', () => {
    // A write whose every call site sits inside an `else` block fires only when
    // the guarded case FAILED — the inverse of what the variable's name
    // promises. `find.ts`'s label-keyed `<node>.<label>` shipped this way: it
    // was set only when the lookup returned null.
    const observed = new Map<string, string>()

    for (const { nodeType, definition } of BUILDER_NODE_DEFINITIONS) {
      const contract = ENGINE.get(nodeType)
      if (!contract || contract.failurePathOnlyWrites.length === 0) continue

      for (const config of configsFor(nodeType, definition.defaultData ?? {})) {
        let advertised: Set<string>
        try {
          advertised = flatten(
            definition.outputVariables(config.data, NODE_ID, outputVariableContext) ?? []
          )
        } catch {
          continue // reported by the previous assertion
        }

        for (const id of advertised) {
          const path = advertisedPath(id, NODE_ID)
          if (!isPathWritten(path, contract.failurePathOnlyWrites)) continue
          observed.set(
            `failure-path:${nodeType}.${path}`,
            `every setNodeVariable call site for this path is inside an else block (${contract.files.join(', ')})`
          )
        }
      }
    }

    assertAgainstAllowlist(
      observed,
      'failure-path:',
      KNOWN_BROKEN_FAILURE_PATH_WRITES,
      EXTRACTION_BLIND_SPOTS
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. CONFIG KEYS
// ═══════════════════════════════════════════════════════════════════════════

describe('config keys — every node.data key the engine reads has a builder writer', () => {
  it('declares every key the processor reads', () => {
    // Floor, not ceiling: only TOP-LEVEL `node.data.<key>` reads are visible to
    // the extraction. A key read through a helper's parameter
    // (`executeFilter(list, node.data.filterConfig)` → `config.logic`) is not
    // seen, so a green run here does not prove the nested config is wired.
    const observed = new Map<string, string>()

    for (const { nodeType, definition, dir } of BUILDER_NODE_DEFINITIONS) {
      const contract = ENGINE.get(nodeType)
      if (!contract) continue

      const writable = builderDataKeys(definition, dir)
      const reads = [...contract.dataReads, ...Object.keys(contract.foreignDataReads)]
      for (const key of reads) {
        if (writable.has(key)) continue

        // Two NOTEs, both about ATTRIBUTION rather than about the read itself.
        // Whoever regenerates the allowlist decides "drift" vs "blind spot", and
        // both of these have already produced a wrong decision once.
        const notes: string[] = []
        const foreign = contract.foreignDataReads[key]
        if (foreign) {
          notes.push(
            `NOTE: this read goes through \`${foreign}\` — a node taken OUT of the graph, so it may target a FOREIGN node whose own panel declares the key. Open the source before filing it as ${nodeType} drift.`
          )
        }
        const ancestor = contract.inheritedDataReads[key]
        if (ancestor) {
          notes.push(
            `NOTE: INHERITED read — it lives in \`${ancestor}\`, not in this node's own processor. Every subclass of that base reports it separately; fix it once, there.`
          )
        }

        observed.set(
          `config:${nodeType}.${key}`,
          `engine reads node.data.${key} but the builder schema/defaults never declare it (${contract.files.join(', ')})${notes.length ? ` — ${notes.join(' ')}` : ''}`
        )
      }
    }

    assertAgainstAllowlist(observed, 'config:', KNOWN_BROKEN_CONFIG_KEYS, EXTRACTION_BLIND_SPOTS)
  })
})
