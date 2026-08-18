// apps/web/src/components/data-connectors/ui/mapping-view.ts
// Pure derivation of everything `MappingNode` needs to RENDER a mapping's source
// subtree — the index-building that used to live inline in the component body. Given
// a mapping plus the shared path schema + mapping indices, it computes the relative
// source tree and partitions the mapping's children/entries into the buckets the
// renderer keys on (inline ref-link leaves, promoted branch children, drilled binds,
// formula rows, orphans). No React / no I/O, so it's unit-testable in isolation — and
// it's where the nested-child rootPath contract is enforced (a `reference` child's
// stored rootPath must be parent-RELATIVE to match its leaf node here).

import {
  absolutePrefix,
  buildSourceTree,
  type SourcePath,
  type SourceTreeNode,
  subtreeUnder,
} from '../hooks/use-source-paths'
import type { FieldMapping } from '../hooks/use-stream-mutations'
import type { DraftMapping } from '../stores/connector-draft-store'
import { bareTokenNodePath, isBareToken } from './field-mapping-edits'

/** A drilled binding/formula: the flat child that owns it + the entry itself. */
export interface DrilledEntry {
  child: DraftMapping
  entry: FieldMapping
}

/** The fully-derived render model for one {@link DraftMapping}. */
export interface MappingView {
  /** This mapping's payload-absolute prefix (root → … → self), for the calc dialog. */
  prefix: string
  /** The source subtree under {@link prefix}, nested for rendering. */
  sourceTree: SourceTreeNode[]
  /** FLAT drilled children (`rootPath: ''`) — binds across a relationship, rendered inline. */
  flatDrilledChildren: DraftMapping[]
  /** Reference children (id-only FK links) keyed by their array-normalized FK source path. */
  refChildByNodePath: Map<string, DraftMapping>
  /** Upsert children promoted as a nested branch, keyed by array-normalized branch path. */
  childByNodePath: Map<string, DraftMapping>
  /** Upsert children whose branch isn't in the current schema — appended so they stay editable. */
  orphanChildren: DraftMapping[]
  /** A leaf bound ACROSS a relationship: source path → the flat child + its binding. */
  drilledBindBySourcePath: Map<string, DrilledEntry>
  /** Computed values written across a relationship — rendered as formula rows on this mapping. */
  drilledFormulaRows: DrilledEntry[]
  /** Reverse index: source path → the bare-token binding entry on it. */
  sourceToEntry: Map<string, FieldMapping>
  /** Entries that render as their own formula row (computed, or an orphaned/half-authored entry). */
  formulaEntries: FieldMapping[]
}

/** Array-normalize a child's rootPath to the branch/leaf node path it keys on. */
function nodePathOf(rootPath: string): string {
  return rootPath.replace(/\[\]$/, '')
}

/**
 * Build the {@link MappingView} for `mapping`. Pure over the shared `sourcePaths`
 * (payload-absolute Layer-A schema) and the tree indices (`byMappingId` for the
 * parent chain, `childrenOf` for this mapping's children). Mirrors the inline logic
 * `MappingNode` used to carry, so behavior is identical — just hoisted + testable.
 */
export function computeMappingView(
  mapping: DraftMapping,
  sourcePaths: SourcePath[],
  byMappingId: Map<string, DraftMapping>,
  childrenOf: Map<string | null, DraftMapping[]>
): MappingView {
  const fieldMappings = (mapping.fieldMappings ?? []) as FieldMapping[]

  // Slice this mapping's subtree by its FULL absolute prefix (not the bare,
  // parent-relative rootPath) so nested mappings render the correct subtree.
  const prefix = absolutePrefix(mapping, byMappingId)
  const relativeSubtree = subtreeUnder(sourcePaths, prefix)
  const sourceTree = buildSourceTree(relativeSubtree)
  const branchPaths = new Set(relativeSubtree.filter((p) => p.isBranch).map((p) => p.path))

  // FLAT drilled children (unified picker §2): a child reading the SAME subtree
  // (`rootPath: ''`) to write a related def via a drilled relationship. They surface
  // INLINE on their source leaf, NOT as nested nodes — partition them out.
  const childMappings = childrenOf.get(mapping.id) ?? []
  const flatDrilledChildren = childMappings.filter((c) => c.rootPath === '')
  const nonFlatChildren = childMappings.filter((c) => c.rootPath !== '')

  // Reference children (flat-FK links) live on a SCALAR leaf, not a branch — index them
  // separately so a linked leaf renders in "linked" state instead of being promoted to a
  // nested MappingNode (the upsert fan-out path). NB: a child's stored rootPath is
  // parent-RELATIVE (`product_id`, not `line_items[].product_id`), so it matches the leaf
  // node path under this mapping's subtree.
  const upsertChildren = nonFlatChildren.filter((c) => c.linkMode !== 'reference')
  const refChildByNodePath = new Map<string, DraftMapping>()
  for (const c of nonFlatChildren) {
    if (c.linkMode === 'reference') refChildByNodePath.set(nodePathOf(c.rootPath), c)
  }
  const childByNodePath = new Map<string, DraftMapping>()
  for (const c of upsertChildren) childByNodePath.set(nodePathOf(c.rootPath), c)
  // Children whose branch isn't in the current schema (e.g. schema regenerated) would
  // otherwise vanish — render them appended so they stay editable/removable.
  const orphanChildren = upsertChildren.filter((c) => !branchPaths.has(nodePathOf(c.rootPath)))

  // A leaf bound ACROSS a relationship: its binding lives on a flat drilled child, but
  // the leaf keeps its row (only the target chip reaches across).
  const drilledBindBySourcePath = new Map<string, DrilledEntry>()
  for (const c of flatDrilledChildren) {
    for (const e of (c.fieldMappings ?? []) as FieldMapping[]) {
      if (e.targetFieldRef == null || !isBareToken(e.expression)) continue
      drilledBindBySourcePath.set(bareTokenNodePath(e.expression), { child: c, entry: e })
    }
  }

  // DRILLED FORMULAS: a NON-bare entry on a flat child is a formula whose computed value
  // writes a related def across the relationship. Bare entries are leaf binds (inline via
  // `drilledBindBySourcePath`); non-bare ones surface as formula rows on this parent.
  const drilledFormulaRows = flatDrilledChildren.flatMap((child) =>
    ((child.fieldMappings ?? []) as FieldMapping[])
      .filter((e) => !isBareToken(e.expression))
      .map((entry) => ({ child, entry }))
  )

  // Reverse-index bare-token entries: NODE path → the binding entry on it. Keyed in
  // node space so an indexed binding (`emails[0].value` — the only form the runtime
  // resolves) renders on its `emails[].value` leaf instead of vanishing.
  const sourceToEntry = new Map<string, FieldMapping>()
  for (const e of fieldMappings) {
    if (isBareToken(e.expression)) sourceToEntry.set(bareTokenNodePath(e.expression), e)
  }

  // Visible leaf paths under THIS subtree — a bare-token entry on one renders on its leaf,
  // so it must NOT also surface as a formula row.
  const visibleLeafPaths = new Set(relativeSubtree.filter((p) => !p.isBranch).map((p) => p.path))

  // Formula rows = computed entries (no single leaf to anchor on) PLUS target-less entries
  // with nowhere to live on the source tree (a half-authored draft, or an orphaned bare
  // token whose source path vanished). A bare-token anchor on a VISIBLE leaf renders on
  // that leaf, never here.
  const formulaEntries = fieldMappings.filter(
    (e) =>
      !isBareToken(e.expression) ||
      (e.targetFieldRef == null && !visibleLeafPaths.has(bareTokenNodePath(e.expression)))
  )

  return {
    prefix,
    sourceTree,
    flatDrilledChildren,
    refChildByNodePath,
    childByNodePath,
    orphanChildren,
    drilledBindBySourcePath,
    drilledFormulaRows,
    sourceToEntry,
    formulaEntries,
  }
}
