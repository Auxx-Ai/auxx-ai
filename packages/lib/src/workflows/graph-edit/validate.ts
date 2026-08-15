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

import { getAuthorableManifests, getManifest } from '../../workflow-engine/catalog/registry'
import { NodeCategory } from '../../workflow-engine/catalog/types'
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
 */
export function isInputNodePair(source: GraphNode, target: GraphNode): boolean {
  return (
    getManifest(nodeType(target))?.connection.acceptsInputNodes === true &&
    getManifest(nodeType(source))?.category === NodeCategory.INPUT
  )
}

/** An input-provider → input-accepting wiring on the handles it must use. */
function isInputWiring(source: GraphNode, target: GraphNode, edge: GraphEdge): boolean {
  return (
    isInputNodePair(source, target) &&
    (edge.sourceHandle ?? 'source') === INPUT_WIRING_HANDLES.sourceHandle &&
    (edge.targetHandle ?? 'target') === INPUT_WIRING_HANDLES.targetHandle
  )
}

/** Whether a node is an in-graph trigger per its catalog manifest. */
export function isTriggerNode(node: GraphNode): boolean {
  return getManifest(nodeType(node))?.triggerType !== undefined
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
  opts: { newNodeIds?: ReadonlySet<string> } = {}
): Issue[] {
  const issues: Issue[] = []
  const nodes = graph.nodes
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const ref = (id: string) => formatNodeRef(nodes, id)
  const newNodeIds = opts.newNodeIds ?? new Set<string>()
  const authorableTypes = () =>
    getAuthorableManifests()
      .map((m) => m.id)
      .sort()
      .join(', ')

  // Node types — authorable for introduced nodes, informational otherwise.
  for (const node of nodes) {
    const type = nodeType(node)
    const manifest = getManifest(type)
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
      }
    } else if (!manifest) {
      issues.push({
        severity: 'info',
        nodeRef: ref(node.id),
        message: `Node type "${type}" is not in the catalog — it is read-only to this editor.`,
      })
    }
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

    const sourceManifest = getManifest(nodeType(source))
    if (sourceManifest) {
      const branches = sourceManifest.connection.branches?.(source.data) ?? []
      const handle = edge.sourceHandle ?? 'source'
      const allowed = branches.length > 0 ? branches.map((b) => b.id) : ['source']
      if (!allowed.includes(handle) && !isInputWiring(source, target, edge)) {
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
    } else if (targetHandle !== 'target' && !isInputWiring(source, target, edge)) {
      issues.push({
        severity: 'error',
        nodeRef: ref(target.id),
        message: `Edge "${edge.id}" targets unknown handle "${targetHandle}" on ${ref(target.id)}.`,
      })
    }
  }

  // Connection limits and non-connectable nodes.
  for (const node of nodes) {
    const manifest = getManifest(nodeType(node))
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
  const triggers = nodes.filter(isTriggerNode)
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
        return !source || !isInputWiring(source, trigger, e)
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
export function validateNodeConfigs(graph: DraftGraph): Issue[] {
  const issues: Issue[] = []
  for (const node of graph.nodes) {
    const manifest = getManifest(nodeType(node))
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

/** Whether an issue list contains anything the pipeline treats as blocking. */
export function hasBlockingIssues(issues: Issue[]): boolean {
  return issues.some((issue) => issue.severity === 'error')
}
