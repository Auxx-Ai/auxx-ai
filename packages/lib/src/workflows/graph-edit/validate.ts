// packages/lib/src/workflows/graph-edit/validate.ts

/**
 * Graph validation (`03-graph-edit-service.md` §5), tiers 1 and 2 — pure, no
 * db/cache. Tier 3 (reference checks) lives in `normalize/ref-check.ts`; the
 * publish gate wrapper lives in `read.ts` (it loads the draft row).
 *
 * Tier 1 (structural, BLOCKING — the pipeline refuses to persist):
 *   unknown/non-authorable node types among the nodes a mutation introduced,
 *   edges to missing nodes, invalid source/target handles (checked against
 *   `manifest.connection.branches(config)` — never string-matched), trigger
 *   rules, containment integrity, connection limits, and non-loop cycles.
 *
 * Tier 2 (config, NON-blocking — a half-configured node persists, mirroring
 * the canvas): `manifest.configSchema.safeParse` + `manifest.validate`,
 * reported per field.
 *
 * One deliberate softening of §5's "exactly one trigger": ZERO triggers is a
 * warning, not an error — blocking it would make it impossible to build a
 * workflow incrementally (the first `addNode` on an empty draft has no
 * trigger yet). More than one trigger, or an edge INTO a trigger, is a hard
 * structural error — with ONE exception: an input node attaching to a trigger
 * that declares `acceptsInputNodes` (see `isInputNodePair`).
 */

import { getAuthorableManifests } from '../../workflow-engine/catalog/registry'
import {
  type ManifestLookup,
  NodeCategory,
  type NodeValidationResult,
} from '../../workflow-engine/catalog/types'
import { edgeSourceHandle, FALLBACK_BRANCH_IDS, safeBranches } from './branches'
import { formatNodeRef } from './refs'
import type { DraftGraph, GraphEdge, GraphNode, Issue } from './types'

/** The persisted node type (`data.type`; `node.type` is the renderer type). */
export function nodeType(node: GraphNode): string {
  return (node.data?.type as string | undefined) ?? node.type
}

/**
 * The non-standard handle pair an input node uses to attach to the node it
 * feeds (`form-input --input-output--> manual --input`). Not a chain link:
 * the edge runs BACKWARDS into a trigger, which is why the three rules below
 * need an exception and why edge writers must ask for these handles by name.
 */
export const INPUT_WIRING_HANDLES = { sourceHandle: 'input-output', targetHandle: 'input' } as const

/**
 * Whether this node pair is an input-provider → input-accepting wiring: the
 * canvas's own rule (`use-node-validation.ts` — source category `INPUT`,
 * target `acceptsInputNodes`), read off the same manifests. Used BOTH to judge
 * existing graphs here and to mint edges in `ops.ts`, so a writer can never
 * produce an edge this file rejects.
 *
 * **Strict on both sides, deliberately.** An uncatalogued node type is
 * read-only/informational everywhere else in `validateGraphStructure`, so
 * tolerating a missing SOURCE manifest here was tempting — and while
 * `form-input` was the one input node without a manifest, it was the only way
 * the exception could fire at all. It has one now, and "no manifest" is a
 * PERMANENT condition for app-block node types (contributed by installed apps,
 * they never get a catalog manifest) and open-ended for `webhook` /
 * `webhook-endpoint`. A tolerant predicate would therefore let an app-block
 * hang off a trigger's `input` handle forever, and let `connect_nodes` mint
 * exactly that.
 *
 * Verified before tightening (dev, 2026-08-14): every `input`-handle edge in
 * `Workflow` and `WorkflowTemplate` is `form-input --input-output--> manual`,
 * 8 edges, no exceptions — so strictness rejects nothing that exists. The
 * canvas cannot author a counterexample either; its own rule is this rule.
 *
 * **The strictness no longer carries the app-block half of that argument.**
 * Once `lookup` resolves app blocks, "no manifest" stops being permanent for
 * them — so what keeps an app block off a trigger's `input` handle is now the
 * two explicit facts its synthesized manifest states: `category` is
 * `INTEGRATION` (≠ `INPUT`) and `acceptsInputNodes` is `false`. Strictness
 * still guards the genuinely uncatalogued (`webhook`, `webhook-endpoint`).
 */
export function isInputNodePair(
  source: GraphNode,
  target: GraphNode,
  lookup: ManifestLookup
): boolean {
  return (
    lookup(nodeType(target))?.connection.acceptsInputNodes === true &&
    lookup(nodeType(source))?.category === NodeCategory.INPUT
  )
}

/**
 * The `blocksAuthoring` errors a manifest reports for this node's config, or
 * none. A validator crashing on half-built data must not take the pipeline
 * down — same tolerance `validateNodeConfigs` applies.
 */
function authoringBlockers(
  manifest: NonNullable<ReturnType<ManifestLookup>>,
  node: GraphNode
): NodeValidationResult['errors'] {
  try {
    return manifest.validate(node.data).errors.filter((error) => error.blocksAuthoring === true)
  } catch {
    return []
  }
}

/** An input-provider → input-accepting wiring on the handles it must use. */
function isInputWiring(
  source: GraphNode,
  target: GraphNode,
  edge: GraphEdge,
  lookup: ManifestLookup
): boolean {
  return (
    isInputNodePair(source, target, lookup) &&
    (edge.sourceHandle ?? 'source') === INPUT_WIRING_HANDLES.sourceHandle &&
    (edge.targetHandle ?? 'target') === INPUT_WIRING_HANDLES.targetHandle
  )
}

/** Whether a node is an in-graph trigger per its catalog manifest. */
export function isTriggerNode(node: GraphNode, lookup: ManifestLookup): boolean {
  return lookup(nodeType(node))?.triggerType !== undefined
}

/**
 * Forward edges for cycle detection — loop-back edges and child→own-container
 * edges excluded, mirroring the catalog's `getForwardEdges`
 * (`graph-vars.ts`), so an intentional loop never reads as a cycle.
 */
function forwardEdges(graph: DraftGraph): GraphEdge[] {
  const loopIds = new Set(graph.nodes.filter((n) => nodeType(n) === 'loop').map((n) => n.id))
  return graph.edges.filter((edge) => {
    if (edge.data?.isLoopBackEdge) return false
    if (loopIds.has(edge.target)) {
      const source = graph.nodes.find((n) => n.id === edge.source)
      if (source?.parentId === edge.target || source?.data?.loopId === edge.target) return false
    }
    return true
  })
}

/** Node ids left over after Kahn's algorithm — the members of non-loop cycles. */
function cycleMembers(graph: DraftGraph): string[] {
  const nodeIds = new Set(graph.nodes.map((n) => n.id))
  const inDegree = new Map<string, number>()
  const adjacency = new Map<string, string[]>()
  for (const id of nodeIds) {
    inDegree.set(id, 0)
    adjacency.set(id, [])
  }
  for (const edge of forwardEdges(graph)) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1)
    adjacency.get(edge.source)?.push(edge.target)
  }
  const queue = [...nodeIds].filter((id) => inDegree.get(id) === 0)
  const seen = new Set<string>()
  while (queue.length > 0) {
    const current = queue.shift()
    if (current === undefined || seen.has(current)) continue
    seen.add(current)
    for (const next of adjacency.get(current) ?? []) {
      const degree = (inDegree.get(next) ?? 1) - 1
      inDegree.set(next, degree)
      if (degree === 0) queue.push(next)
    }
  }
  return [...nodeIds].filter((id) => !seen.has(id))
}

/**
 * Tier-1 structural validation. Every issue this returns with severity
 * `error` BLOCKS the mutation.
 *
 * `newNodeIds` scopes the authorable-type check to the nodes the mutation
 * introduced or retyped: a pre-existing not-yet-migrated node (webhook, app
 * block) must not lock the whole draft against unrelated edits — those get an
 * `info` note instead.
 */
export function validateGraphStructure(
  graph: DraftGraph,
  opts: { lookup: ManifestLookup; newNodeIds?: ReadonlySet<string> }
): Issue[] {
  const issues: Issue[] = []
  const nodes = graph.nodes
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const ref = (id: string) => formatNodeRef(nodes, id)
  const { lookup } = opts
  const newNodeIds = opts.newNodeIds ?? new Set<string>()
  const authorableTypes = () =>
    getAuthorableManifests()
      .map((m) => m.id)
      .sort()
      .join(', ')

  // Node types — an INTRODUCED node must be authorable; an existing one that
  // has no manifest is merely read-only, which `GraphSummary.readOnlyNodes`
  // states once instead of an issue per node per read.
  for (const node of nodes) {
    const type = nodeType(node)
    const manifest = lookup(type)
    if (newNodeIds.has(node.id)) {
      if (!manifest) {
        issues.push({
          severity: 'error',
          nodeRef: ref(node.id),
          message: `Unknown node type "${type}". Authorable types: ${authorableTypes()}.`,
        })
      } else if (manifest.agent?.authorable !== true) {
        issues.push({
          severity: 'error',
          nodeRef: ref(node.id),
          message: `Node type "${type}" cannot be authored here. Authorable types: ${authorableTypes()}.`,
        })
      } else {
        // The type exists and may be authored — but the CONFIG can still name
        // something that does not, and only the manifest knows its own
        // vocabulary. `blocksAuthoring` is how a validator says "this is
        // malformed, not merely unusable"; everything else it reports stays
        // tier-2 and lands non-blocking through `validateNodeConfigs`.
        //
        // Deliberately scoped to `newNodeIds`, the same asymmetry the type
        // check above uses: a node the caller just wrote must fail the write,
        // while a pre-existing one that drifted (an app upgrade dropped its
        // operation) must never make the whole workflow uneditable.
        for (const error of authoringBlockers(manifest, node)) {
          issues.push({
            severity: 'error',
            nodeRef: ref(node.id),
            ...(error.field ? { field: error.field } : {}),
            message: error.message,
          })
        }
      }
    }
    // A node with no manifest that the caller did NOT introduce is simply
    // read-only. That is reported once on `GraphSummary.readOnlyNodes`, not as
    // an issue per node per read — it is never actionable, and repeating it
    // buries the issues that are.
  }

  // Containment — parentId must name an existing loop node.
  for (const node of nodes) {
    if (!node.parentId) continue
    const parent = nodeById.get(node.parentId)
    if (!parent) {
      issues.push({
        severity: 'error',
        nodeRef: ref(node.id),
        message: `Node ${ref(node.id)} has parentId "${node.parentId}", which matches no node.`,
      })
    } else if (nodeType(parent) !== 'loop') {
      issues.push({
        severity: 'error',
        nodeRef: ref(node.id),
        message: `Node ${ref(node.id)} is contained in ${ref(parent.id)}, which is not a loop.`,
      })
    }
  }

  // Edges — endpoints must exist, handles must be ones the manifest declares.
  for (const edge of graph.edges) {
    const source = nodeById.get(edge.source)
    const target = nodeById.get(edge.target)
    if (!source || !target) {
      issues.push({
        severity: 'error',
        message: `Edge "${edge.id}" connects ${source ? ref(edge.source) : `missing node "${edge.source}"`} → ${
          target ? ref(edge.target) : `missing node "${edge.target}"`
        }.`,
      })
      continue
    }

    const sourceManifest = lookup(nodeType(source))
    if (sourceManifest) {
      // `safeBranches`, not a bare call: the derivation is a function of
      // agent-authored config and this runs inside `readDraft`, so a throw here
      // used to take out `get_workflow`/`get_node`/`validate_workflow` and every
      // mutation at once (plan 21 §2.5).
      const branches = safeBranches(sourceManifest, source.data)
      const handle = edgeSourceHandle(edge)
      const allowed = branches.length > 0 ? branches.map((b) => b.id) : ['source']
      if (!allowed.includes(handle) && !isInputWiring(source, target, edge, lookup)) {
        issues.push({
          severity: 'error',
          nodeRef: ref(source.id),
          message:
            `Edge "${edge.id}" leaves ${ref(source.id)} on handle "${handle}", which the node does ` +
            `not expose. Valid handles: ${allowed.join(', ')}.`,
        })
      }
    }

    const targetHandle = edge.targetHandle ?? 'target'
    if (targetHandle === 'loop-back') {
      if (nodeType(target) !== 'loop') {
        issues.push({
          severity: 'error',
          nodeRef: ref(target.id),
          message: `Edge "${edge.id}" targets handle "loop-back" on ${ref(target.id)}, which is not a loop.`,
        })
      }
    } else if (targetHandle !== 'target' && !isInputWiring(source, target, edge, lookup)) {
      issues.push({
        severity: 'error',
        nodeRef: ref(target.id),
        message: `Edge "${edge.id}" targets unknown handle "${targetHandle}" on ${ref(target.id)}.`,
      })
    }
  }

  // Connection limits and non-connectable nodes.
  for (const node of nodes) {
    const manifest = lookup(nodeType(node))
    if (!manifest) continue
    const incoming = graph.edges.filter((e) => e.target === node.id)
    const outgoing = graph.edges.filter((e) => e.source === node.id)
    if (manifest.connection.canConnect === false && incoming.length + outgoing.length > 0) {
      issues.push({
        severity: 'error',
        nodeRef: ref(node.id),
        message: `Node type "${nodeType(node)}" cannot be connected to other nodes.`,
      })
    }
    const maxIn = manifest.connection.maxIncomingConnections
    if (maxIn !== undefined && incoming.length > maxIn) {
      issues.push({
        severity: 'error',
        nodeRef: ref(node.id),
        message: `Node ${ref(node.id)} has ${incoming.length} incoming connections (max ${maxIn}).`,
      })
    }
    const maxOut = manifest.connection.maxOutgoingConnections
    if (maxOut !== undefined && outgoing.length > maxOut) {
      issues.push({
        severity: 'error',
        nodeRef: ref(node.id),
        message: `Node ${ref(node.id)} has ${outgoing.length} outgoing connections (max ${maxOut}).`,
      })
    }
  }

  // Trigger rules — at most one; none is a warning (a draft under construction);
  // an edge INTO a trigger is structural corruption.
  const triggers = nodes.filter((node) => isTriggerNode(node, lookup))
  if (triggers.length === 0 && nodes.length > 0) {
    issues.push({
      severity: 'warning',
      message: 'The workflow has no trigger node yet — it cannot run until one is added.',
    })
  } else if (triggers.length > 1) {
    issues.push({
      severity: 'error',
      message:
        `The workflow has ${triggers.length} trigger nodes — only one is allowed: ` +
        `${triggers.map((t) => ref(t.id)).join(', ')}. Delete the extras or use setTrigger.`,
    })
  }
  for (const trigger of triggers) {
    // Input wiring is the one legal edge INTO a trigger — a form-input node
    // attaches its field definition to the manual trigger on `input`.
    const incoming = graph.edges.filter((e) => e.target === trigger.id)
    if (
      incoming.some((e) => {
        const source = nodeById.get(e.source)
        return !source || !isInputWiring(source, trigger, e, lookup)
      })
    ) {
      issues.push({
        severity: 'error',
        nodeRef: ref(trigger.id),
        message: `Trigger ${ref(trigger.id)} has incoming connections — triggers start the workflow and take no input.`,
      })
    }
  }

  // Loop structure — at most one loop-start edge per loop (the engine's
  // validateLoopStructure throws on more); children with none is a warning.
  for (const loop of nodes.filter((n) => nodeType(n) === 'loop')) {
    const loopStarts = graph.edges.filter(
      (e) => e.source === loop.id && e.sourceHandle === 'loop-start'
    )
    if (loopStarts.length > 1) {
      issues.push({
        severity: 'error',
        nodeRef: ref(loop.id),
        message: `Loop ${ref(loop.id)} has ${loopStarts.length} loop-start connections — exactly one is allowed.`,
      })
    }
    const children = nodes.filter((n) => n.parentId === loop.id)
    if (children.length > 0 && loopStarts.length === 0) {
      issues.push({
        severity: 'warning',
        nodeRef: ref(loop.id),
        message: `Loop ${ref(loop.id)} has body nodes but no loop-start connection — the body will never run.`,
      })
    }
  }

  // Non-loop cycles.
  const cyclic = cycleMembers(graph)
  if (cyclic.length > 0) {
    issues.push({
      severity: 'error',
      message: `The graph has a cycle (outside loop containers) through: ${cyclic
        .map(ref)
        .join(', ')}. Remove one of the connections.`,
    })
  }

  return issues
}

/**
 * Tier-2 config validation — `configSchema.safeParse` plus the manifest's own
 * `validate`, per node, per field. Never blocks: a half-configured node is a
 * legitimate draft state. Validator warnings map to `warning` severity.
 */
export function validateNodeConfigs(graph: DraftGraph, lookup: ManifestLookup): Issue[] {
  const issues: Issue[] = []
  for (const node of graph.nodes) {
    const manifest = lookup(nodeType(node))
    if (!manifest) continue
    const ref = formatNodeRef(graph.nodes, node.id)

    const parsed = manifest.configSchema.safeParse(node.data)
    if (!parsed.success) {
      for (const zodIssue of parsed.error.issues) {
        issues.push({
          severity: 'warning',
          nodeRef: ref,
          field: zodIssue.path.join('.') || undefined,
          message: zodIssue.message,
        })
      }
    }

    try {
      const result = manifest.validate(node.data)
      if (!result.isValid || result.errors.length > 0) {
        for (const error of result.errors) {
          issues.push({
            severity: error.type === 'warning' ? 'warning' : 'error',
            nodeRef: ref,
            field: error.field,
            message: error.message,
          })
        }
      }
    } catch {
      // A validator crashing on half-built data must not take the pipeline down.
    }
  }
  return issues
}

/**
 * Node types with NO plain `source` handle — every way out is a branch, so an
 * unwired one is a dead end rather than a merely unfinished path.
 */
const NO_DEFAULT_OUTPUT_TYPES = new Set(['human-confirmation'])

/** `"Name" (id)` / `"id"` — how an unwired-branch issue names the branch. */
function describeBranchRef(branch: { id: string; name: string }): string {
  return branch.name ? `"${branch.name}" (${branch.id})` : `"${branch.id}"`
}

/**
 * Tier-2, non-blocking: a branching node with a branch nothing is wired to.
 *
 * The logged 2026-08-18 turn finished with `publishable: true` and one whole
 * carrier branch never connected, and NOTHING said so — there was no
 * unwired-branch check in the structural tier, the config tier or the publish
 * gate (plan 21 §7.6). This is that backstop: it surfaces on every mutation
 * result and in `validate_workflow`, before the agent writes its summary.
 *
 * Three deliberate exclusions:
 *  - **Fallback branches** (`false`/`default`/`unmatched`) are silent. Leaving
 *    "nothing matched" unwired is the normal shape of an if-else, not an
 *    oversight, and warning on it would fire on nearly every branching node in
 *    every workflow.
 *  - **The plain `source` handle** is silent for the same reason: a terminal
 *    node is a legitimate end of a graph, and `source` is an output, not a
 *    branch anybody chose.
 *  - **`fail` branches** (`kind === 'fail'`) are silent, for exactly the ELSE
 *    reason. An unwired fail branch means *"let it fail"* — the run dies, which
 *    is the legitimate default behaviour of every node that has no failure
 *    policy at all. #1766 made http's `defaultData()` write
 *    `error_strategy: 'fail'`, so from that commit every newly created http
 *    node rendered a fail branch and immediately warned "has nothing wired" on
 *    its own defaults. That was pure noise. Keyed on `kind`, not on the id
 *    string, because the id is a per-manifest choice and the kind is the
 *    contract (`NodeBranch.kind`, `catalog/types.ts`).
 *
 * Severity is `warning` — a half-built branch is a legitimate intermediate
 * state and blocking it would break incremental building. The one `error` is a
 * node with no default output to fall through to (`human-confirmation`, whose
 * three outcome handles are the only way out), where an unwired
 * branch means the run dead-ends. It is still tier 2 and still NON-blocking:
 * `runGraphMutation` blocks on the structural tier, not on this one, so a
 * half-wired approval never refuses the next edit.
 */
export function validateBranchWiring(graph: DraftGraph, lookup: ManifestLookup): Issue[] {
  const issues: Issue[] = []
  for (const node of graph.nodes) {
    const manifest = lookup(nodeType(node))
    if (!manifest) continue
    const branches = safeBranches(manifest, node.data)
    if (branches.length < 2) continue // not a branching node for authoring purposes
    const deadEnd = NO_DEFAULT_OUTPUT_TYPES.has(nodeType(node))
    const ref = formatNodeRef(graph.nodes, node.id)

    for (const branch of branches) {
      if (branch.kind === 'fail') continue
      if (FALLBACK_BRANCH_IDS.has(branch.id) || branch.id === 'source') continue
      const wired = graph.edges.some(
        (edge) => edge.source === node.id && edgeSourceHandle(edge) === branch.id
      )
      if (wired) continue
      issues.push({
        severity: deadEnd ? 'error' : 'warning',
        nodeRef: ref,
        field: 'branches',
        message: deadEnd
          ? `Branch ${describeBranchRef(branch)} has nothing wired and ${ref} has no default ` +
            'output — the run dead-ends when this branch is taken.'
          : `Branch ${describeBranchRef(branch)} has nothing wired — nothing runs when this ` +
            `branch is taken. Connect it with connect_nodes(from: "${ref}", branch: "${branch.id}", to: …).`,
      })
    }
  }
  return issues
}

/** Whether an issue list contains anything the pipeline treats as blocking. */
export function hasBlockingIssues(issues: Issue[]): boolean {
  return issues.some((issue) => issue.severity === 'error')
}
