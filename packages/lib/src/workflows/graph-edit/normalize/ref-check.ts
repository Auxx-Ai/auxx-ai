// packages/lib/src/workflows/graph-edit/normalize/ref-check.ts

/**
 * Reference validation against resolved outputs (`03-graph-edit-service.md`
 * §3 last rows + §5 tier 3): every `{{…}}` ref in a graph either resolves
 * against the declared output tree of an upstream node, or comes back as an
 * ERROR naming candidates — never a silent drop, never silently persisted
 * (this codebase already has a scar from a condition builder that dropped
 * unmatched clauses and failed open).
 *
 * Collection shapes get a *correction with a suggestion*, not a bare
 * rejection: `has_many`/`many_to_many` relations expand to a wrapper
 * (`.values[*]`, `.count`, `.isEmpty`, `.first`, `.last`), so the
 * `{{X.attachments[*]}}` a model writes every time is answered with the
 * `{{X.attachments.values[*]}}` form it should have used.
 *
 * `checkVariableRefsAgainstOutputs` is pure (outputs supplied);
 * `checkGraphRefs` composes it with the catalog's server-side
 * `resolveGraphOutputs` and is therefore SERVER-ONLY.
 */

import { err, ok, type Result } from 'neverthrow'
import { buildManifestLookup } from '../../../workflow-engine/catalog/app-manifests'
import {
  isErrorLikeHandle,
  scopeOutputsToHandle,
} from '../../../workflow-engine/catalog/error-handling'
import { buildUpstreamHandleMap } from '../../../workflow-engine/catalog/graph-vars'
import { resolveGraphOutputs } from '../../../workflow-engine/catalog/resolve-outputs'
import type { ManifestLookup } from '../../../workflow-engine/catalog/types'
import type { UnifiedVariable } from '../../../workflow-engine/types/unified-variable'
import { firstPathSegment, rewriteVariableRefs } from '../../variable-ref-rewriter'
import { closestMatches, formatNodeRef, nodeTitle } from '../refs'
import type { Issue, NodeMeta, RefCorrection, WorkflowOutputGraph } from '../types'

/** What a reference check returns: findings plus machine-applicable fixes. */
export interface RefCheckResult {
  issues: Issue[]
  corrections: RefCorrection[]
}

/** First-segment prefixes that are never node refs and are skipped entirely. */
const RESERVED_PREFIXES = new Set(['env', 'sys'])

/** Numeric accessors resolve against the declared `[*]` item — normalize for matching. */
function normalizeIndices(path: string): string {
  return path.replace(/\[-?\d+\]/g, '[*]')
}

/** Flatten a declared output tree into id → variable (walking properties/items). */
function indexTree(variables: UnifiedVariable[], into: Map<string, UnifiedVariable>): void {
  for (const variable of variables) {
    into.set(variable.id, variable)
    if (variable.properties) indexTree(Object.values(variable.properties), into)
    if (variable.items) indexTree([variable.items], into)
  }
}

/** Whether a declared variable's shape is open (no declared children to check against). */
function isOpenShape(variable: UnifiedVariable): boolean {
  const hasProperties = !!variable.properties && Object.keys(variable.properties).length > 0
  return !hasProperties && !variable.items
}

/** All prefixes of a normalized path, longest first (bracket-stripped variants included). */
function pathPrefixes(path: string): string[] {
  const prefixes: string[] = []
  let current = path
  const pushBracketStripped = (value: string) => {
    if (/\[\*\]$/.test(value)) prefixes.push(value.replace(/\[\*\]$/, ''))
  }
  pushBracketStripped(current)
  while (true) {
    const dot = current.lastIndexOf('.')
    if (dot <= 0) break
    current = current.slice(0, dot)
    prefixes.push(current)
    pushBracketStripped(current)
  }
  return prefixes
}

/** Whether a normalized path resolves against the declared id index. */
function pathResolves(candidate: string, idMap: Map<string, UnifiedVariable>): boolean {
  if (idMap.has(candidate)) return true
  for (const prefix of pathPrefixes(candidate)) {
    const variable = idMap.get(prefix)
    if (!variable) continue
    // Longest declared prefix decides: an open shape (e.g. a bare `record`
    // object) accepts any deeper path — the runtime navigates raw JSON there;
    // a declared shape with children means the next segment simply missed.
    return isOpenShape(variable)
  }
  return false
}

/** The deepest declared prefix of a path, for candidate naming. */
function deepestDeclaredPrefix(
  candidate: string,
  idMap: Map<string, UnifiedVariable>
): { prefix: string; variable: UnifiedVariable } | null {
  for (const prefix of pathPrefixes(candidate)) {
    const variable = idMap.get(prefix)
    if (variable) return { prefix, variable }
  }
  return null
}

/**
 * Collection-shape correction: try inserting `.values` before bracket
 * accessors (each one alone, then all at once) and return the first variant
 * that resolves. Applied to the raw path so the original accessor (`[0]`,
 * `[-1]`) is preserved in the suggestion.
 */
function collectionCorrection(rawPath: string, idMap: Map<string, UnifiedVariable>): string | null {
  const bracketOffsets: number[] = []
  for (const match of rawPath.matchAll(/\[(?:\*|-?\d+)\]/g)) {
    // Skip brackets already preceded by `.values`.
    if (!rawPath.slice(0, match.index).endsWith('.values')) bracketOffsets.push(match.index)
  }
  if (bracketOffsets.length === 0) return null

  const variants: string[] = bracketOffsets.map(
    (offset) => `${rawPath.slice(0, offset)}.values${rawPath.slice(offset)}`
  )
  if (bracketOffsets.length > 1) {
    let combined = ''
    let last = 0
    for (const offset of bracketOffsets) {
      combined += `${rawPath.slice(last, offset)}.values`
      last = offset
    }
    variants.push(combined + rawPath.slice(last))
  }

  for (const variant of variants) {
    if (pathResolves(normalizeIndices(variant), idMap)) return variant
  }
  return null
}

/**
 * One source node's declared outputs, indexed in the three shapes it can
 * answer in depending on which handle the asking consumer arrived on.
 */
interface ScopedIdMaps {
  /** Everything `resolveOutputs` declared — the union across handles. */
  unscoped: Map<string, UnifiedVariable>
  /** What survives on the failure door (`failOutputs`). */
  onFail: Map<string, UnifiedVariable>
  /** What survives on `source` (`failureOnlyOutputs` subtracted under `fail`). */
  onSource: Map<string, UnifiedVariable>
}

/** A branch-scope finding: how loud, and what to say. */
interface ScopeIssue {
  severity: 'warning' | 'info'
  message: (ref: string, sourceRef: string, consumerRef: string) => string
}

/**
 * Does `candidate` survive on the handles this consumer is reachable on?
 *
 * **Union over paths, not intersection.** A variable is offered if SOME path to
 * the consumer carries it. Intersection is the "guaranteed present" rule and is
 * the wrong one here: it breaks the legitimate one-node-handles-both-outcomes
 * pattern, it can be empty at a fan-in, and the two failure modes are
 * asymmetric — an over-offered variable interpolates to `''` with a WARN, while
 * an under-offered one is a finding on a correct edit. When uncertain, be wrong
 * in the soft direction.
 *
 * Three outcomes:
 * - resolves on every reachable handle → `null`, nothing to say;
 * - resolves on NO reachable handle → `warning`, it will be empty at run time;
 * - resolves on some but not all (`union − intersection`) → `info`. This is the
 *   JOIN case, and it is the one an author most needs: a node fed by both a
 *   `source` and a `fail` branch legitimately sees the union, but half those
 *   runs took the other path.
 *
 * Never `error`: the run-time consequence is an empty string, not a crash, and
 * the blocking tier only reads `severity === 'error'`. Availability is also
 * non-monotonic — deleting one incoming edge at a join can narrow it and turn
 * already-saved refs into findings the author never touched — which must never
 * refuse a write.
 */
function scopeIssue(params: {
  handles: Set<string> | undefined
  maps: ScopedIdMaps
  candidate: string
}): ScopeIssue | null {
  const { handles, maps, candidate } = params
  if (!handles || handles.size === 0) return null

  let resolvesOnSome = false
  let resolvesOnAll = true
  for (const handle of handles) {
    const scoped = isErrorLikeHandle(handle) ? maps.onFail : maps.onSource
    // An empty scoped map means "this handle writes nothing", which is a real
    // answer — unlike an empty UNSCOPED map, which means "unverifiable" and is
    // already handled by the caller's guard.
    if (pathResolves(candidate, scoped)) resolvesOnSome = true
    else resolvesOnAll = false
  }

  if (resolvesOnAll) return null

  if (!resolvesOnSome) {
    return {
      severity: 'warning',
      message: (ref, sourceRef, consumerRef) =>
        `"{{${ref}}}" reads an output ${sourceRef} does not produce on the branch ` +
        `${consumerRef} is reachable from — it will be empty at run time. ` +
        'Read it on the other branch, or reference an output that path writes.',
    }
  }

  return {
    severity: 'info',
    message: (ref, sourceRef, consumerRef) =>
      `"{{${ref}}}" is path-conditional: ${consumerRef} is reachable from more than one of ` +
      `${sourceRef}'s branches, and only some of them write this output. It resolves on the ` +
      'runs that took those paths and is empty on the rest.',
  }
}

/** Extract every variable ref a node reads: manifest extractor first, generic walk otherwise. */
function extractNodeRefs(node: NodeMeta, nodeIds: Set<string>, lookup: ManifestLookup): string[] {
  const manifest = lookup(node.data?.type ?? node.type)
  if (manifest?.extractVariables) {
    try {
      return manifest.extractVariables(node.data)
    } catch {
      // Fall through to the generic walk — a half-configured node must not
      // crash the check.
    }
  }
  const refs = new Set<string>()
  rewriteVariableRefs(structuredClone(node.data), nodeIds, (path) => {
    const trimmed = path.trim()
    if (trimmed) refs.add(trimmed)
    return path
  })
  return Array.from(refs)
}

/** Container ancestry (`parentId` chain + `data.loopId`) — loop children may read their container. */
function containerAncestors(node: NodeMeta, nodeById: Map<string, NodeMeta>): Set<string> {
  const ancestors = new Set<string>()
  const loopId = node.data?.loopId
  if (typeof loopId === 'string') ancestors.add(loopId)
  let current: NodeMeta | undefined = node
  while (current?.parentId && !ancestors.has(current.parentId)) {
    ancestors.add(current.parentId)
    current = nodeById.get(current.parentId)
  }
  return ancestors
}

/**
 * Validate every variable reference in `graph` against the supplied declared
 * outputs (`resolveGraphOutputs` shape). Pure — no cache, no db.
 *
 * Checks per ref, in order:
 * 1. the referenced node exists (else: error naming closest titles/ids);
 * 2. it is upstream of the consumer, or a container ancestor (else: error —
 *    the ref a model gets wrong constantly is one that *exists* but is not
 *    reachable);
 * 3. the path resolves in the declared output tree — numeric accessors match
 *    their `[*]` declaration, undeclared-child ("open") objects accept any
 *    deeper path, collection misuse gets a `.values[*]` suggestion, anything
 *    else gets "did you mean" candidates from the declared siblings;
 * 4. it survives BRANCH SCOPING — a path that resolves against the node's full
 *    declared tree but not on the handles the consumer is reachable from is a
 *    `warning` (empty at run time), and one that resolves on some reachable
 *    handles but not all is an `info` (path-conditional). See {@link scopeIssue}.
 *
 * Nodes whose declared outputs are empty (not-yet-migrated types) skip checks 3
 * and 4 — an empty declaration proves nothing either way.
 *
 * Checks 1–3 keep `severity: 'error'` and stay in the blocking tier. Check 4
 * never blocks: over-offering degrades to an empty string, and refusing an edit
 * over it would make a legitimate fan-in unauthorable.
 *
 * SUGGESTIONS AND CORRECTIONS ARE COMPUTED AGAINST THE UNSCOPED TREE. Scope
 * decides the *finding*; a "did you mean" generated from a scoped sibling set
 * would rewrite a correct ref into a different, wrong variable — and
 * `corrections` is machine-applicable.
 */
export function checkVariableRefsAgainstOutputs(params: {
  graph: WorkflowOutputGraph
  outputs: Map<string, UnifiedVariable[]>
  lookup: ManifestLookup
}): RefCheckResult {
  const { graph, outputs, lookup } = params
  const issues: Issue[] = []
  const corrections: RefCorrection[] = []

  const nodeIds = new Set(graph.nodes.map((n) => n.id))
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]))
  const handleMap = buildUpstreamHandleMap(graph.edges, graph.nodes)

  /**
   * Declared-output indexes per source node, in the three shapes a source can
   * answer in. NOT per (consumer, source) pair: scoping depends only on WHICH
   * HANDLES the consumer is reachable on, and there are three answers total —
   * so a per-pair cache would be O(V²) maps for no benefit.
   */
  const idMapsByNode = new Map<string, ScopedIdMaps>()
  const scopedIdMaps = (source: NodeMeta): ScopedIdMaps => {
    let maps = idMapsByNode.get(source.id)
    if (!maps) {
      const declared = outputs.get(source.id) ?? []
      const errorHandling = lookup(source.data?.type ?? source.type)?.errorHandling
      const index = (vars: UnifiedVariable[]) => {
        const idMap = new Map<string, UnifiedVariable>()
        indexTree(vars, idMap)
        return idMap
      }
      maps = {
        unscoped: index(declared),
        onFail: index(
          scopeOutputsToHandle(errorHandling, source.data, source.id, 'fail', declared)
        ),
        onSource: index(
          scopeOutputsToHandle(errorHandling, source.data, source.id, 'source', declared)
        ),
      }
      idMapsByNode.set(source.id, maps)
    }
    return maps
  }

  for (const consumer of graph.nodes) {
    const consumerRef = formatNodeRef(graph.nodes, consumer.id)
    const ancestorHandles = handleMap.get(consumer.id) ?? new Map<string, Set<string>>()
    const upstream = new Set(ancestorHandles.keys())
    const containers = containerAncestors(consumer, nodeById)

    for (const rawPath of extractNodeRefs(consumer, nodeIds, lookup)) {
      const head = firstPathSegment(rawPath)
      if (!head || RESERVED_PREFIXES.has(head)) continue
      // A head-only string carries no output path to validate — and bare
      // node-id strings in node data (`data.id`, loop ids, …) are data, not
      // references, so treating them as refs would flood every node with
      // self-reference noise.
      if (rawPath === head) continue

      const source = nodeById.get(head)
      if (!source) {
        const titles = graph.nodes.map(nodeTitle).filter(Boolean)
        const near = closestMatches(head, [...titles, ...nodeIds])
        issues.push({
          severity: 'error',
          nodeRef: consumerRef,
          ref: rawPath,
          message:
            `Reference "{{${rawPath}}}" points at unknown node "${head}".` +
            (near.length > 0 ? ` Did you mean ${near.map((t) => `"${t}"`).join(' or ')}?` : ''),
        })
        continue
      }

      if (source.id !== consumer.id && !upstream.has(source.id) && !containers.has(source.id)) {
        issues.push({
          severity: 'error',
          nodeRef: consumerRef,
          ref: rawPath,
          message:
            `Reference "{{${rawPath}}}" reads node ${formatNodeRef(graph.nodes, source.id)}, ` +
            `which is not upstream of ${consumerRef} — a node can only read outputs of nodes ` +
            'that run before it. Connect them, or reference an upstream node instead.',
        })
        continue
      }
      if (source.id === consumer.id) {
        issues.push({
          severity: 'error',
          nodeRef: consumerRef,
          ref: rawPath,
          message: `Reference "{{${rawPath}}}" reads the node's own output — a node cannot reference itself.`,
        })
        continue
      }

      const maps = scopedIdMaps(source)
      const idMap = maps.unscoped
      // THE TRAP: guard on the UNSCOPED map. An empty *scoped* map and an empty
      // *declared* map mean opposite things — with http's old `failOutputs: []`
      // the scoped map is empty, and testing that here would silently skip
      // every check on the fail branch instead of reporting anything.
      if (idMap.size === 0) continue // nothing declared (not-yet-migrated) — unverifiable

      const candidate = normalizeIndices(rawPath)
      if (pathResolves(candidate, idMap)) {
        // Resolves against the full declared tree. Now: does it resolve on the
        // handles this consumer is actually reachable on?
        const scoped = scopeIssue({
          handles: ancestorHandles.get(source.id),
          maps,
          candidate,
        })
        if (scoped) {
          issues.push({
            severity: scoped.severity,
            nodeRef: consumerRef,
            ref: rawPath,
            message: scoped.message(rawPath, formatNodeRef(graph.nodes, source.id), consumerRef),
          })
        }
        continue
      }

      const corrected = collectionCorrection(rawPath, idMap)
      if (corrected) {
        issues.push({
          severity: 'error',
          nodeRef: consumerRef,
          ref: rawPath,
          suggestion: corrected,
          message:
            `"{{${rawPath}}}" — this field is a collection wrapper, not a bare array. ` +
            `Use "{{${corrected}}}" (collections also expose .count, .isEmpty, .first, .last).`,
        })
        corrections.push({ nodeId: consumer.id, from: rawPath, to: corrected })
        continue
      }

      const declared = deepestDeclaredPrefix(candidate, idMap)
      const parentPrefix = declared?.prefix ?? head
      const parent = declared?.variable
      const available = parent?.properties
        ? Object.keys(parent.properties)
        : Array.from(idMap.keys())
            .filter((id) => id.startsWith(`${head}.`) && !id.slice(head.length + 1).includes('.'))
            .map((id) => id.slice(head.length + 1))
      const missing = candidate.slice(parentPrefix.length).replace(/^\./, '')
      const missingSegment = firstPathSegment(missing) || missing
      const near = closestMatches(missingSegment, available)
      issues.push({
        severity: 'error',
        nodeRef: consumerRef,
        ref: rawPath,
        ...(near.length === 1
          ? {
              suggestion:
                parentPrefix +
                (parentPrefix ? '.' : '') +
                near[0] +
                missing.slice(missingSegment.length),
            }
          : {}),
        message:
          `No output "${missingSegment}" on node ${formatNodeRef(graph.nodes, source.id)}` +
          (near.length > 0
            ? `; did you mean ${near.map((n) => `"${n}"`).join(' or ')}?`
            : available.length > 0
              ? `. Available: ${available.slice(0, 8).join(', ')}${available.length > 8 ? ', …' : ''}.`
              : '.'),
      })
    }
  }

  return { issues, corrections }
}

/**
 * SERVER-ONLY convenience: resolve the graph's declared outputs through the
 * catalog (`resolveGraphOutputs`, org-cache-backed) and run
 * {@link checkVariableRefsAgainstOutputs} over them.
 */
export async function checkGraphRefs(
  orgId: string,
  params: { graph: WorkflowOutputGraph }
): Promise<Result<RefCheckResult, Error>> {
  const outputs = await resolveGraphOutputs(orgId, { graph: params.graph })
  if (outputs.isErr()) return err(outputs.error)
  return ok(
    checkVariableRefsAgainstOutputs({
      graph: params.graph,
      outputs: outputs.value,
      lookup: await buildManifestLookup(orgId),
    })
  )
}
