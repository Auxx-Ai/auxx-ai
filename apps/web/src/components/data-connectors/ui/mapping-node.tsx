// apps/web/src/components/data-connectors/ui/mapping-node.tsx
'use client'

import type { FieldType } from '@auxx/database/types'
import { fieldTypeOptions } from '@auxx/lib/custom-fields/types'
import { fieldMatchesRef, type ResourceField } from '@auxx/lib/resources/client'
import { mapBaseTypeToFieldType } from '@auxx/lib/workflow-engine/client'
import { getRelatedEntityDefinitionId, type RelationshipConfig } from '@auxx/types/custom-field'
import {
  type FieldReference,
  fieldRefToKey,
  getFieldDefinitionId,
  getFieldId,
  isFieldPath,
  keyToFieldRef,
  type ResourceFieldId,
  toFieldPath,
} from '@auxx/types/field'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { EntityIcon } from '@auxx/ui/components/icons'
import { toastError } from '@auxx/ui/components/toast'
import { SimpleTooltip } from '@auxx/ui/components/tooltip'
import { TreeRowButton } from '@auxx/ui/components/tree-row'
import { generateId } from '@auxx/utils'
import { FunctionSquare, Loader2, Plus, Sparkles, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { ResourcePicker } from '~/components/pickers/resource-picker'
import { useResourceFields, useResourceProperty } from '~/components/resources'
import { api } from '~/trpc/react'
import {
  absolutePrefix,
  buildSourceTree,
  leafPathsUnder,
  type SourcePath,
  type SourceTreeNode,
  subtreeUnder,
} from '../hooks/use-source-paths'
import type { FieldMapping } from '../hooks/use-stream-mutations'
import type { DraftMapping, MappingDraftMutations } from '../stores/connector-draft-store'
import { BranchRow } from './branch-row'
import { CappedNodeList } from './capped-node-list'
import { FieldCalcDialog } from './field-calc-dialog'
import {
  bareTokenSource,
  bindingFor,
  isBareToken,
  removeBindingForSource,
  retargetFormulaEntry,
  setEntryIdentityRole,
  upsertBinding,
} from './field-mapping-edits'
import { type IdentityRole, IdentityRoleControl } from './identity-role-control'
import { MappingFieldPicker } from './mapping-field-picker'
import { FieldRowActions, MappingRow } from './mapping-row'
import { RelationshipLinkRow } from './relationship-link-row'
import { SourceLeafRow } from './source-leaf-row'

// The mapping tree now renders from the connector DRAFT store (plans/data-connectors/v4),
// so a row is a `DraftMapping` (fan-out/remove are temp-id/tombstone draft edits). The UI
// reads only the common subset (id, def, link/target mode, fieldMappings, rootPath, parent,
// relationshipFieldKey), all present on `DraftMapping`.
type Mapping = DraftMapping

/**
 * The field-type icon for an applied target field — mirrors {@link FieldItem}'s
 * regular-field branch so the trigger chip matches the picker-list row. Falls back
 * to the BaseType→FieldType mapping for system fields, then a generic `circle`.
 */
function fieldIconId(field: ResourceField | undefined): string | undefined {
  if (!field) return undefined
  const fieldType =
    (field.fieldType as FieldType) ||
    (field.type ? mapBaseTypeToFieldType(field.type as any) : undefined)
  return (fieldType && fieldTypeOptions[fieldType]?.iconId) ?? 'circle'
}

/** The related def a relationship field points at, or null if it has none. */
function relatedDefOf(field: ResourceField): string | null {
  return field.relationship
    ? getRelatedEntityDefinitionId(field.relationship as RelationshipConfig)
    : null
}

/** Naive singularizer for record nouns (`todos → todo`, `line_items → line item`). */
function singularize(word: string): string {
  if (/ies$/.test(word)) return word.replace(/ies$/, 'y')
  if (/(ss|sis|us)$/.test(word)) return word // address, analysis, status
  if (/s$/.test(word)) return word.replace(/s$/, '')
  return word
}

/** A source segment → a lowercase singular noun (`line_items[]` → `line item`). */
function recordNoun(raw: string): string {
  return singularize(raw.replace(/\[\]$/, '')).replace(/[_-]+/g, ' ').toLowerCase().trim()
}

/**
 * Plain-language description of where a mapping's records come from, derived from
 * the defined source schema. An ARRAY branch fans out one record per element, so it
 * reads "each <noun>" (`drafts[]` → "each draft"); a SINGULAR object branch is one
 * record, so it reads "one <noun>" (`customer` → "one customer"). The unnamed array
 * ROOT (`[]`) has no schema name, so it falls back to the stream's own noun (stream
 * key `todos` → "each todo"). Returns the parts split so the header can style the
 * qualifier like a field's TYPE token and the noun like its LABEL (row-consistent).
 */
function describeRootPath(
  rootPath: string,
  fallbackNoun?: string
): { qualifier: string; noun: string } {
  if (rootPath === '') return { qualifier: 'whole', noun: 'payload' }
  const isArray = rootPath.endsWith('[]')
  const seg = rootPath.replace(/\[\]$/, '').split('.').pop()
  const noun = seg ? recordNoun(seg) : fallbackNoun ? recordNoun(fallbackNoun) : 'item'
  return { qualifier: isArray ? 'each' : 'one', noun }
}

/** The fan-out rootPath for a branch node — arrays keep their `[]` suffix. */
function branchRootPath(node: SourceTreeNode): string {
  return node.type === 'array' ? `${node.path}[]` : node.path
}

export interface MappingNodeProps {
  mapping: Mapping
  depth: number
  /** The connector id — for the Tier 2 `suggestMappings` call. */
  connectorId: string
  streamId: string
  /** The stream key — the record noun for the unnamed array root (`[]`). */
  streamKey: string
  /** The stream's raw source schema (Layer A) — fed to the suggester so it needn't re-fetch. */
  sourceSchema?: Record<string, unknown> | null
  /** Payload-absolute source paths (Layer A schema), shared by the whole tree. */
  sourcePaths: SourcePath[]
  /** All mappings indexed by id — for `absolutePrefix` + child lookup. */
  byMappingId: Map<string, Mapping>
  childrenOf: Map<string | null, Mapping[]>
  mutations: MappingDraftMutations
  /** Entity defs this connector already syncs — a soft hint for the link picker. */
  syncedDefIds: Set<string>
}

/**
 * One `DataConnectorMapping` rendered as the source-schema subtree it owns (plan
 * §3.3). The header carries the target def + target mode toggle; identity
 * is configured per-leaf (the "Match" toggle), not in the header. The body
 * walks the mapping's subtree (sliced by {@link absolutePrefix} — the nesting-bug
 * fix) and, at each node, either binds a leaf, offers a branch action menu, or —
 * when a child mapping exists at that branch — recurses inline as the child
 * `MappingNode`. No separate appended child block.
 */
export function MappingNode({
  mapping,
  depth,
  connectorId,
  streamId,
  streamKey,
  sourceSchema,
  sourcePaths,
  byMappingId,
  childrenOf,
  mutations,
  syncedDefIds,
}: MappingNodeProps) {
  const [open, setOpen] = useState(true)
  // The formula entry the dialog is editing (null = closed). Carries the OWNING
  // mapping id too, so the dialog can edit a drilled formula whose entry lives on a
  // flat child — not just one on this parent mapping.
  const [calcTarget, setCalcTarget] = useState<{ mappingId: string; entryId: string } | null>(null)
  const { setMappingTarget, removeMapping, setFieldMappings, fanOut } = mutations

  // Target def display + fields — resolved from the global resource store. App-owned
  // defs are installed (real) before mapping (v6), so there's no projection layer.
  const resource = useResourceProperty(mapping.entityDefinitionId, ['icon', 'label'])
  const { fields: targetFields } = useResourceFields(mapping.entityDefinitionId)
  const linkMode = mapping.linkMode as 'upsert' | 'reference'
  const targetMode = mapping.targetMode as 'owned' | 'contributing'
  const fieldMappings = (mapping.fieldMappings ?? []) as FieldMapping[]

  // Find the target field a stored ref points at (label/normalize resolution).
  const fieldByRef = (ref: string | null | undefined): ResourceField | undefined =>
    ref ? targetFields.find((f) => fieldMatchesRef(f, mapping.entityDefinitionId, ref)) : undefined

  // Persist a new entry array (the single mapping field-write surface).
  const writeEntries = (next: FieldMapping[]) => setFieldMappings(streamId, mapping.id, next)

  // Tier 2 suggester (create-sync-flow §3.2) — only offered on a root-record
  // mapping (whole payload / each item), where the suggester's record-relative
  // leaves match this mapping's subtree. Merges proposals in as editable rows,
  // skipping any source path or target field that's already bound.
  const canSuggest =
    mapping.parentMappingId == null &&
    (mapping.rootPath === '' || mapping.rootPath === '[]') &&
    mapping.entityDefinitionId != null
  const suggestMappings = api.dataConnector.suggestMappings.useMutation({
    onSuccess: (data) => {
      const boundSources = new Set(
        fieldMappings
          .filter((e) => isBareToken(e.expression))
          .map((e) => e.expression.replace(/^\{|\}$/g, ''))
      )
      const boundTargets = new Set(
        fieldMappings.map((e) => e.targetFieldRef).filter((r): r is string => r != null)
      )
      const fresh = (data.proposals as FieldMapping[]).filter((p) => {
        const src = Object.values(p.sourceFields)[0]
        return !!src && !boundSources.has(src) && !boundTargets.has(p.targetFieldRef ?? '')
      })
      if (fresh.length > 0) writeEntries([...fieldMappings, ...fresh])
    },
    onError: (e) => toastError({ title: 'Could not suggest mappings', description: e.message }),
  })
  // Patch one entry in place by its stable id (used by every per-entry mutation).
  const patchEntry = (id: string, patch: Partial<FieldMapping>) =>
    writeEntries(fieldMappings.map((e) => (e.id === id ? { ...e, ...patch } : e)))

  // Patch an entry on ANY mapping (this one or a flat child) — needed because a
  // drilled formula's entry lives on a child. Reads the target mapping's entries
  // from the shared index so the write is over its current array.
  const patchEntryIn = (mappingId: string, entryId: string, patch: Partial<FieldMapping>) => {
    const entries = (byMappingId.get(mappingId)?.fieldMappings ?? []) as FieldMapping[]
    setFieldMappings(
      streamId,
      mappingId,
      entries.map((e) => (e.id === entryId ? { ...e, ...patch } : e))
    )
  }

  // Every target field already bound by SOME entry — the pickers exclude these so
  // two entries can't fight over one field (an array allows it; the UI forbids it).
  const usedTargetKeys = new Set(
    fieldMappings.map((e) => e.targetFieldRef).filter((k): k is string => k != null)
  )

  // Slice this mapping's subtree by its FULL absolute prefix (not the bare,
  // parent-relative rootPath) so nested mappings render the correct subtree.
  const prefix = absolutePrefix(mapping, byMappingId)
  const relativeSubtree = subtreeUnder(sourcePaths, prefix)
  const sourceTree = buildSourceTree(relativeSubtree)
  const branchPaths = new Set(relativeSubtree.filter((p) => p.isBranch).map((p) => p.path))

  // Child mappings indexed by their (array-normalized) rootPath segment, so a
  // branch node at `line_items` matches a child mapping with rootPath
  // `line_items[]`.
  const childMappings = childrenOf.get(mapping.id) ?? []
  // FLAT drilled children (unified picker §2): a child that reads the SAME subtree as
  // this mapping (`rootPath: ''`) to write a related def — created by drilling a leaf's
  // target across a relationship (e.g. `email → Contact.Email`). They surface INLINE on
  // their source leaf (via `drilledBindBySourcePath`), NOT as nested nodes — so they're
  // partitioned out of the branch/ref indexing below.
  const flatDrilledChildren = childMappings.filter((c) => c.rootPath === '')
  const nonFlatChildren = childMappings.filter((c) => c.rootPath !== '')
  // Reference children (flat-FK links, Approach B) live on a SCALAR leaf, not a
  // branch — index them separately so a linked leaf renders in "linked" state
  // instead of being promoted to a nested MappingNode (the upsert fan-out path).
  const upsertChildren = nonFlatChildren.filter((c) => c.linkMode !== 'reference')
  const refChildByNodePath = new Map<string, Mapping>()
  for (const c of nonFlatChildren) {
    if (c.linkMode === 'reference') refChildByNodePath.set(c.rootPath.replace(/\[\]$/, ''), c)
  }
  const childByNodePath = new Map<string, Mapping>()
  for (const c of upsertChildren) childByNodePath.set(c.rootPath.replace(/\[\]$/, ''), c)
  // Children whose branch isn't in the current schema (e.g. schema regenerated)
  // would otherwise vanish — render them appended so they stay editable/removable.
  const orphanChildren = upsertChildren.filter(
    (c) => !branchPaths.has(c.rootPath.replace(/\[\]$/, ''))
  )

  // A leaf bound ACROSS a relationship: its binding lives on a flat drilled child, but
  // the leaf keeps its row (only the target chip reaches across). Index source path →
  // { child, entry } so the leaf renders the drilled chip + routes its controls to the
  // child mapping (unified picker §5).
  const drilledBindBySourcePath = new Map<string, { child: Mapping; entry: FieldMapping }>()
  for (const c of flatDrilledChildren) {
    for (const e of (c.fieldMappings ?? []) as FieldMapping[]) {
      if (e.targetFieldRef == null || !isBareToken(e.expression)) continue
      drilledBindBySourcePath.set(bareTokenSource(e.expression), { child: c, entry: e })
    }
  }

  // DRILLED FORMULAS (formula-drill-targets §2): a NON-bare entry on a flat child is a
  // formula whose computed value writes a related def across the relationship — the
  // formula analog of a drilled leaf bind. Bare entries on the same child are leaf
  // binds (rendered inline via `drilledBindBySourcePath`); non-bare ones surface here
  // as their own formula rows on this parent.
  const drilledFormulaRows = flatDrilledChildren.flatMap((child) =>
    ((child.fieldMappings ?? []) as FieldMapping[])
      .filter((e) => !isBareToken(e.expression))
      .map((entry) => ({ child, entry }))
  )

  // Reverse-index bare-token entries: source path → the binding entry on it.
  const sourceToEntry = new Map<string, FieldMapping>()
  for (const e of fieldMappings) {
    if (isBareToken(e.expression)) sourceToEntry.set(e.expression.replace(/^\{|\}$/g, ''), e)
  }

  // Visible leaf paths under THIS mapping's subtree — a bare-token entry on one of
  // these renders on its leaf (External-ID anchor included), so it must NOT also
  // surface as a formula row.
  const visibleLeafPaths = new Set(relativeSubtree.filter((p) => !p.isBranch).map((p) => p.path))

  // Formula rows = computed entries (a multi-source formula has no single leaf to
  // anchor on) PLUS target-less entries with nowhere to live on the source tree: a
  // half-authored formula draft, or an orphaned bare token whose source path vanished
  // (schema regenerated) — kept here so it stays editable/removable. A bare-token
  // External-ID anchor on a VISIBLE leaf renders on that leaf, never here.
  const formulaEntries = fieldMappings.filter(
    (e) =>
      !isBareToken(e.expression) ||
      (e.targetFieldRef == null && !visibleLeafPaths.has(bareTokenSource(e.expression)))
  )

  const assignTarget = (sourcePath: string, targetRef: string) => {
    // Drop any prior bare-token entry bound to this source (1 source → 1 target),
    // then append a fresh entry with a stable id.
    const next = fieldMappings.filter(
      (e) => !(isBareToken(e.expression) && e.expression.replace(/^\{|\}$/g, '') === sourcePath)
    )
    next.push({
      id: generateId(),
      targetFieldRef: targetRef,
      expression: `{${sourcePath}}`,
      sourceFields: { [sourcePath]: sourcePath },
    })
    writeEntries(next)
  }
  const clearEntry = (id: string) => writeEntries(fieldMappings.filter((e) => e.id !== id))

  // Re-point a formula at a different target field. Identity is the entry id, so
  // this is a single field set — merge/match ride along, no re-key.
  const retargetEntry = (id: string, newRef: string) => patchEntry(id, { targetFieldRef: newRef })

  // Normalizer for a match key, derived from the target field's storage type so
  // the role stays one-click (no normalize selector).
  const deriveNormalize = (targetRef: string): 'email' | 'phone' | 'domain' | 'none' => {
    const ft = fieldByRef(targetRef)?.fieldType
    if (ft === 'EMAIL') return 'email'
    if (ft === 'PHONE_INTL') return 'phone'
    if (ft === 'URL') return 'domain'
    return 'none'
  }

  // Set / clear a leaf's identity role (relationship-linking v3 §9.4). External ID
  // is the primary upstream key (radio — picking it elsewhere moves it) and can live
  // on an UNMAPPED leaf (an entry with no target). Match is a secondary key and
  // needs a bound target. Clearing a role on an External-ID-only entry drops the
  // entry entirely (it only existed to carry the role).
  const setIdentityRole = (sourcePath: string, role: 'externalId' | 'match' | null) => {
    let next = fieldMappings
    // Radio: a single primary External ID per mapping — clear it elsewhere first.
    if (role === 'externalId') {
      next = next.map((e) =>
        e.identityRole?.kind === 'externalId' ? { ...e, identityRole: undefined } : e
      )
    }
    const idx = next.findIndex(
      (e) => isBareToken(e.expression) && e.expression.replace(/^\{|\}$/g, '') === sourcePath
    )
    if (idx === -1) {
      // No entry on this leaf yet — External ID creates an unmapped (target-less) one.
      if (role == null) return
      next = [
        ...next,
        {
          id: generateId(),
          targetFieldRef: null,
          expression: `{${sourcePath}}`,
          sourceFields: { [sourcePath]: sourcePath },
          identityRole:
            role === 'externalId' ? { kind: 'externalId' } : { kind: 'match', normalize: 'none' },
        },
      ]
    } else {
      const e = next[idx]!
      if (role == null && e.targetFieldRef == null) {
        next = next.filter((_, i) => i !== idx)
      } else {
        const identityRole =
          role == null
            ? undefined
            : role === 'externalId'
              ? ({ kind: 'externalId' } as const)
              : ({ kind: 'match', normalize: deriveNormalize(e.targetFieldRef ?? '') } as const)
        next = next.map((x, i) => (i === idx ? { ...x, identityRole } : x))
      }
    }
    writeEntries(next)
  }

  // Append a persisted draft formula (no target yet) and open the dialog on it.
  const addFormula = () => {
    const id = generateId()
    writeEntries([...fieldMappings, { id, targetFieldRef: null, expression: '', sourceFields: {} }])
    setCalcTarget({ mappingId: mapping.id, entryId: id })
  }

  // The formula being edited may live on this parent OR a flat child — resolve it
  // from the shared index by the dialog's owning mapping id.
  const calcEntry = calcTarget
    ? ((byMappingId.get(calcTarget.mappingId)?.fieldMappings ?? []) as FieldMapping[]).find(
        (e) => e.id === calcTarget.entryId
      )
    : undefined

  const toggleTargetMode = () =>
    setMappingTarget(streamId, {
      mappingId: mapping.id,
      entityDefinitionId: mapping.entityDefinitionId,
      targetMode: targetMode === 'owned' ? 'contributing' : 'owned',
      linkMode,
    })

  // Materialize a child mapping at a branch by DRILLING a relationship off this
  // mapping's def (relationship-linking v3 §11.1 — the core inversion). The related
  // def is DERIVED from the drilled relationship (never freely picked), the edge is
  // the drilled `FieldReference`, and the mode is forced `contributing` — so a null
  // `relationshipFieldKey` and an owned-on-system-def footgun are both unrepresentable.
  const materializeRelatedChild = (
    node: SourceTreeNode,
    field: ResourceField,
    ref: FieldReference
  ) => {
    const relatedDefId = relatedDefOf(field)
    if (!relatedDefId) return
    fanOut(streamId, {
      parentMappingId: mapping.id,
      rootPath: branchRootPath(node),
      linkMode: 'upsert', // server derives reference vs upsert from the field bindings
      targetMode: 'contributing',
      entityDefinitionId: relatedDefId,
      relationshipFieldKey: fieldRefToKey(ref),
    })
  }

  // Link a flat-FK SCALAR leaf to an existing relationship by drilling it (the
  // id-only reference case, §9.6a Case B). Desugars to a child mapping rooted at the
  // FK path whose ONLY binding is the FK marked External ID — so the runtime derives
  // `reference` and anchors the lazy link on that id (no frozen target pointer). A
  // prior link on the same leaf is replaced.
  const linkRelationship = (node: SourceTreeNode, field: ResourceField, ref: FieldReference) => {
    const relatedDefId = relatedDefOf(field)
    if (!relatedDefId) return
    const prior = refChildByNodePath.get(node.path)
    if (prior) removeMapping(streamId, prior.id)
    fanOut(streamId, {
      parentMappingId: mapping.id,
      rootPath: node.path,
      linkMode: 'reference',
      targetMode: 'contributing',
      entityDefinitionId: relatedDefId,
      relationshipFieldKey: fieldRefToKey(ref),
      // Ship the anchor atomically: the FK value IS the related record's external id.
      fieldMappings: [
        {
          id: generateId(),
          targetFieldRef: null,
          expression: '{source}',
          sourceFields: {},
          identityRole: { kind: 'externalId' },
        },
      ],
    })
  }

  // Bind a leaf ACROSS a relationship (unified picker §2/§4): drill the target graph to
  // a field on a related def — e.g. `email → Contact.Email`. Desugars to a FLAT
  // contributing child mapping (`rootPath ''` reads THIS mapping's subtree,
  // map-record.ts:285) carrying the binding, reusing one child per drilled
  // relationship. v1 is single-hop (a 2-segment FieldPath).
  const assignDrilled = (node: SourceTreeNode, _field: ResourceField, ref: FieldReference) => {
    if (!isFieldPath(ref) || ref.length !== 2) {
      toastError({
        title: 'Multi-hop links not supported yet',
        description: 'Pick a field one relationship away from this record.',
      })
      return
    }
    const rel = ref[0] // the drilled relationship, e.g. "order:contact"
    const targetRef = ref[1] // the bound field on the related def, e.g. "contact:email"
    const relatedDefId = getFieldDefinitionId(targetRef)
    const relKey = fieldRefToKey(rel)
    // Drop any prior DIRECT binding on this source — it now writes the related record.
    if (sourceToEntry.has(node.path)) {
      writeEntries(removeBindingForSource(fieldMappings, node.path))
    }
    const existing = flatDrilledChildren.find((c) => c.relationshipFieldKey === relKey)
    if (existing) {
      setFieldMappings(
        streamId,
        existing.id,
        upsertBinding((existing.fieldMappings ?? []) as FieldMapping[], node.path, targetRef)
      )
      return
    }
    fanOut(streamId, {
      parentMappingId: mapping.id,
      rootPath: '', // flat: reads THIS mapping's subtree
      linkMode: 'upsert', // server derives reference vs upsert from the bindings
      targetMode: 'contributing',
      entityDefinitionId: relatedDefId,
      relationshipFieldKey: relKey,
      fieldMappings: [bindingFor(node.path, targetRef)],
    })
  }

  // Clear a drilled binding — drop it from the flat child, removing the child entirely
  // once it carries no bindings (it existed only for drilled binds).
  const clearDrilled = (node: SourceTreeNode) => {
    const drilled = drilledBindBySourcePath.get(node.path)
    if (!drilled) return
    const remaining = removeBindingForSource(
      (drilled.child.fieldMappings ?? []) as FieldMapping[],
      node.path
    )
    if (remaining.length === 0) removeMapping(streamId, drilled.child.id)
    else setFieldMappings(streamId, drilled.child.id, remaining)
  }

  // Identity role on a drilled leaf → patch the flat child's binding (External ID is a
  // radio WITHIN that child — the related record's own key).
  const setDrilledIdentityRole = (node: SourceTreeNode, role: 'externalId' | 'match' | null) => {
    const drilled = drilledBindBySourcePath.get(node.path)
    if (!drilled) return
    setFieldMappings(
      streamId,
      drilled.child.id,
      setEntryIdentityRole(
        (drilled.child.fieldMappings ?? []) as FieldMapping[],
        drilled.entry.id,
        role,
        deriveNormalize(drilled.entry.targetFieldRef ?? '')
      )
    )
  }

  // Merge strategy on a drilled leaf → patch the flat child's binding.
  const setDrilledMerge = (node: SourceTreeNode, value: string) => {
    const drilled = drilledBindBySourcePath.get(node.path)
    if (!drilled) return
    setFieldMappings(
      streamId,
      drilled.child.id,
      ((drilled.child.fieldMappings ?? []) as FieldMapping[]).map((e) =>
        e.id === drilled.entry.id
          ? { ...e, mergeStrategy: value as FieldMapping['mergeStrategy'] }
          : e
      )
    )
  }

  // ── Formula drill-across-relationship (formula-drill-targets §3) ──────────────
  // A formula entry's "home" is either THIS parent mapping (a root-scalar target) or a
  // flat child (a target a relationship away). Picking a target moves the entry to its
  // desired home, preserving the expression. The flat child is REUSED per relationship
  // (shared with drilled leaf binds) and GC'd when its last entry leaves.

  // v1 drills are single-hop — a 2-segment FieldPath. Returns [rel, targetRef] or null
  // (after toasting) for a root scalar / deeper path.
  const asSingleHop = (ref: FieldReference): [ResourceFieldId, ResourceFieldId] | null => {
    if (!isFieldPath(ref) || ref.length !== 2) {
      toastError({
        title: 'Multi-hop links not supported yet',
        description: 'Pick a field one relationship away from this record.',
      })
      return null
    }
    return [ref[0], ref[1]]
  }

  // Upsert a (re-homed) formula entry into the flat child for `rel`, creating it if
  // absent. The entry already carries its far-field target + expression.
  const upsertFormulaIntoRelChild = (rel: ResourceFieldId, entry: FieldMapping) => {
    const relKey = fieldRefToKey(rel)
    const relatedDefId = getFieldDefinitionId(entry.targetFieldRef as ResourceFieldId)
    const existing = flatDrilledChildren.find((c) => c.relationshipFieldKey === relKey)
    if (existing) {
      const next = [
        ...((existing.fieldMappings ?? []) as FieldMapping[]).filter((e) => e.id !== entry.id),
        entry,
      ]
      setFieldMappings(streamId, existing.id, next)
      return
    }
    fanOut(streamId, {
      parentMappingId: mapping.id,
      rootPath: '', // flat: reads THIS mapping's subtree
      linkMode: 'upsert', // server derives reference vs upsert from the bindings
      targetMode: 'contributing',
      entityDefinitionId: relatedDefId,
      relationshipFieldKey: relKey,
      fieldMappings: [entry],
    })
  }

  // Drop a formula entry from a flat child, GC'ing the child when nothing remains.
  const removeFormulaFromChild = (child: Mapping, entryId: string) => {
    const remaining = ((child.fieldMappings ?? []) as FieldMapping[]).filter(
      (e) => e.id !== entryId
    )
    if (remaining.length === 0) removeMapping(streamId, child.id)
    else setFieldMappings(streamId, child.id, remaining)
  }

  // A HOME formula gains a drilled target → move it onto the relationship's flat child.
  const drillHomeFormula = (entry: FieldMapping, ref: FieldReference) => {
    const hop = asSingleHop(ref)
    if (!hop) return
    writeEntries(fieldMappings.filter((e) => e.id !== entry.id))
    upsertFormulaIntoRelChild(hop[0], retargetFormulaEntry(entry, hop[1]))
  }

  // A DRILLED formula is retargeted to a ROOT scalar → move it back to this parent.
  const undrillFormula = (child: Mapping, entry: FieldMapping, targetRef: string) => {
    removeFormulaFromChild(child, entry.id)
    writeEntries([...fieldMappings, retargetFormulaEntry(entry, targetRef)])
  }

  // A DRILLED formula gains another drilled target → retarget in place when the
  // relationship is unchanged, else move it to the new relationship's child.
  const redrillFormula = (child: Mapping, entry: FieldMapping, ref: FieldReference) => {
    const hop = asSingleHop(ref)
    if (!hop) return
    if (child.relationshipFieldKey === fieldRefToKey(hop[0])) {
      patchEntryIn(child.id, entry.id, { targetFieldRef: hop[1] })
      return
    }
    removeFormulaFromChild(child, entry.id)
    upsertFormulaIntoRelChild(hop[0], retargetFormulaEntry(entry, hop[1]))
  }

  // Identity role on a HOME formula (formula-drill-targets §5.1) — keyed by ENTRY ID,
  // since a formula has no single source path. External ID stays a radio WITHIN this
  // mapping (the record's own key); the runtime evaluates the expression as the key,
  // so a composite/computed External ID works with no engine change.
  const setFormulaIdentityRole = (entryId: string, role: IdentityRole) => {
    const entry = fieldMappings.find((e) => e.id === entryId)
    writeEntries(
      setEntryIdentityRole(
        fieldMappings,
        entryId,
        role,
        deriveNormalize(entry?.targetFieldRef ?? '')
      )
    )
  }

  // Identity role on a DRILLED formula → patch the flat child's entry (External ID is a
  // radio WITHIN that child — the related record's own key).
  const setDrilledFormulaIdentityRole = (
    child: Mapping,
    entry: FieldMapping,
    role: IdentityRole
  ) => {
    setFieldMappings(
      streamId,
      child.id,
      setEntryIdentityRole(
        (child.fieldMappings ?? []) as FieldMapping[],
        entry.id,
        role,
        deriveNormalize(entry.targetFieldRef ?? '')
      )
    )
  }

  return (
    <>
      <MappingRow
        depth={depth}
        expandable
        chevronOnHover
        isOpen={open}
        onToggleOpen={() => setOpen((o) => !o)}
        icon={<EntityIcon iconId={resource?.icon ?? 'table'} size='xs' />}
        title={
          // The rootPath is fixed by the source row this mapping was created from
          // (`data` → "each data") — a static label, not a chooser. Styled to match a
          // source leaf: qualifier reads like the TYPE token, noun like the field LABEL.
          (() => {
            const { qualifier, noun } = describeRootPath(mapping.rootPath, streamKey)
            return (
              <span className='flex items-center gap-1.5'>
                <span className='text-[10px] uppercase text-muted-foreground/60'>{qualifier}</span>
                <span className='font-mono text-sm'>{noun}</span>
              </span>
            )
          })()
        }
        arrow='filled'
        target={
          <ResourcePicker
            value={mapping.entityDefinitionId ? [mapping.entityDefinitionId] : []}
            onChange={() => {}}
            entityDefinedOnly
            emptyLabel='Target def…'
            onSelectSingle={(entityDefinitionId) =>
              setMappingTarget(streamId, {
                mappingId: mapping.id,
                entityDefinitionId,
                targetMode,
                linkMode,
              })
            }
            triggerProps={{ className: 'h-9 w-full justify-between rounded-none px-2 text-xs' }}
          />
        }
        actions={
          <>
            <SimpleTooltip
              side='left'
              delayDuration={500}
              content={
                targetMode === 'owned'
                  ? 'Owned — connector manages this def (archive on orphan). Click to switch to contributing.'
                  : 'Contributing — writes into a pre-existing def per-field, never archives. Click to switch to owned.'
              }>
              <button
                type='button'
                onClick={toggleTargetMode}
                className='inline-flex shrink-0 items-center'>
                <Badge
                  variant={targetMode === 'owned' ? 'violet' : 'amber'}
                  size='xs'
                  className='cursor-pointer'>
                  {targetMode}
                </Badge>
              </button>
            </SimpleTooltip>
            {canSuggest && (
              <TreeRowButton
                persistent
                tooltipText='Suggest field mappings from the source'
                disabled={suggestMappings.isPending}
                onClick={() =>
                  suggestMappings.mutate({
                    id: connectorId,
                    streamKey: streamKey || undefined,
                    entityDefinitionId: mapping.entityDefinitionId!,
                    sourceSchema: sourceSchema ?? undefined,
                  })
                }>
                {suggestMappings.isPending ? <Loader2 className='animate-spin' /> : <Sparkles />}
              </TreeRowButton>
            )}
            {/* Every mapping is removable now — no auto-seeded spine. Deleting a
              mapping drops back to the passive source row it was created from. */}
            <TreeRowButton
              variant='destructive'
              tooltipText='Remove mapping'
              onClick={() => removeMapping(streamId, mapping.id)}>
              <Trash2 />
            </TreeRowButton>
          </>
        }>
        {sourceTree.length === 0 ? (
          <div
            style={{ paddingLeft: `${(depth + 1) * 1.5}rem` }}
            className='px-1 py-1 text-[11px] text-muted-foreground'>
            No source schema yet — generate or edit the schema above to map fields.
          </div>
        ) : (
          <CappedNodeList
            nodes={sourceTree}
            childDepth={depth + 1}
            isCappable={(n) =>
              !n.isBranch &&
              !sourceToEntry.has(n.path) &&
              !refChildByNodePath.has(n.path) &&
              !drilledBindBySourcePath.has(n.path)
            }
            renderNode={(node) => (
              <SourceNode
                key={node.path}
                node={node}
                depth={depth + 1}
                mapping={mapping}
                targetMode={targetMode}
                targetFields={targetFields}
                sourceToEntry={sourceToEntry}
                usedTargetKeys={usedTargetKeys}
                childByNodePath={childByNodePath}
                refChildByNodePath={refChildByNodePath}
                drilledBindBySourcePath={drilledBindBySourcePath}
                onAssign={assignTarget}
                onClear={clearEntry}
                onMergeChange={(id, value) =>
                  patchEntry(id, { mergeStrategy: value as FieldMapping['mergeStrategy'] })
                }
                onSetIdentityRole={setIdentityRole}
                onFanOutRelationship={materializeRelatedChild}
                onLinkRelationship={linkRelationship}
                onClearLink={(refChildId) => removeMapping(streamId, refChildId)}
                onAssignDrilled={assignDrilled}
                onClearDrilled={clearDrilled}
                onSetDrilledIdentityRole={setDrilledIdentityRole}
                onDrilledMergeChange={setDrilledMerge}
                // Child-mapping recursion context.
                connectorId={connectorId}
                streamId={streamId}
                streamKey={streamKey}
                sourceSchema={sourceSchema}
                sourcePaths={sourcePaths}
                byMappingId={byMappingId}
                childrenOf={childrenOf}
                mutations={mutations}
                syncedDefIds={syncedDefIds}
              />
            )}
          />
        )}

        {/* Formula rows — one per non-bare field mapping (a computed target field),
          plus an add row. Reference-mode mappings only link, so no formulas. */}
        {linkMode !== 'reference' && (
          <>
            {formulaEntries.map((e) => (
              <FormulaRow
                key={e.id}
                depth={depth + 1}
                entityDefinitionId={mapping.entityDefinitionId}
                targetKey={e.targetFieldRef ?? ''}
                label={
                  e.targetFieldRef ? (fieldByRef(e.targetFieldRef)?.label ?? e.targetFieldRef) : ''
                }
                iconId={e.targetFieldRef ? fieldIconId(fieldByRef(e.targetFieldRef)) : undefined}
                expression={e.expression}
                mergeStrategy={e.mergeStrategy ?? 'overwrite'}
                // Drilling is offered once a target def is set (formula-drill-targets §4).
                allowRelationships={mapping.entityDefinitionId != null}
                // Exclude keys other entries already bind, so a formula can't be
                // retargeted onto a field already in use.
                excludeKeys={
                  e.targetFieldRef
                    ? new Set([...usedTargetKeys].filter((k) => k !== e.targetFieldRef))
                    : usedTargetKeys
                }
                identityRole={e.identityRole?.kind ?? null}
                canMatch={e.targetFieldRef != null}
                onSetIdentityRole={(role) => setFormulaIdentityRole(e.id, role)}
                onEdit={() => setCalcTarget({ mappingId: mapping.id, entryId: e.id })}
                onRetarget={(newKey) => retargetEntry(e.id, newKey)}
                onDrilledAssign={(ref) => drillHomeFormula(e, ref)}
                onMergeChange={(value) =>
                  patchEntry(e.id, { mergeStrategy: value as FieldMapping['mergeStrategy'] })
                }
                onClear={() => clearEntry(e.id)}
              />
            ))}
            {/* Drilled formulas — a computed value written across a relationship; its
              entry lives on a flat child, but it renders here as a formula row whose
              chip reaches across ("Contact › Full name"). */}
            {drilledFormulaRows.map(({ child, entry }) => (
              <DrilledFormulaRow
                key={entry.id}
                depth={depth + 1}
                parentEntityDefinitionId={mapping.entityDefinitionId}
                child={child}
                entry={entry}
                excludeKeys={usedTargetKeys}
                onSetIdentityRole={(role) => setDrilledFormulaIdentityRole(child, entry, role)}
                onEdit={() => setCalcTarget({ mappingId: child.id, entryId: entry.id })}
                onRetargetRoot={(newKey) => undrillFormula(child, entry, newKey)}
                onDrilledAssign={(ref) => redrillFormula(child, entry, ref)}
                onMergeChange={(value) =>
                  patchEntryIn(child.id, entry.id, {
                    mergeStrategy: value as FieldMapping['mergeStrategy'],
                  })
                }
                onClear={() => removeFormulaFromChild(child, entry.id)}
              />
            ))}
            {mapping.entityDefinitionId != null && (
              <MappingRow
                depth={depth + 1}
                icon={<Plus className='size-3.5 text-muted-foreground/50' />}
                // "Add formula" persists a fresh draft row (no target yet) and opens
                // the expression dialog on it — you author the formula first and pick
                // the destination field after (or leave it unassigned for later). The
                // WHOLE row is the click target (onToggleOpen drives the row onClick),
                // and the label reads like a field (font-mono text-sm, foreground).
                onToggleOpen={addFormula}
                title={<span className='font-mono text-sm'>Add formula</span>}
              />
            )}
          </>
        )}

        {/* Child mappings whose branch isn't in the current schema — appended so
          they don't silently disappear (and stay removable). */}
        {orphanChildren.map((child) => (
          <MappingNode
            key={child.id}
            mapping={child}
            depth={depth + 1}
            connectorId={connectorId}
            streamId={streamId}
            sourceSchema={sourceSchema}
            sourcePaths={sourcePaths}
            byMappingId={byMappingId}
            childrenOf={childrenOf}
            mutations={mutations}
            streamKey={streamKey}
            syncedDefIds={syncedDefIds}
          />
        ))}
      </MappingRow>

      {/* The formula editor — opened by a formula row's source button or the
          "Add formula" row. Source paths are scoped to this mapping's subtree
          (matching the runtime); a drilled formula's flat child reads the SAME
          subtree (`rootPath ''`), so the same paths apply. */}
      <FieldCalcDialog
        open={calcTarget !== null}
        onOpenChange={(o) => !o && setCalcTarget(null)}
        targetLabel={
          calcEntry?.targetFieldRef
            ? (fieldByRef(calcEntry.targetFieldRef)?.label ?? calcEntry.targetFieldRef)
            : ''
        }
        expression={calcEntry?.expression ?? ''}
        sourcePaths={leafPathsUnder(sourcePaths, prefix)}
        onSave={(expression, sourceFields) => {
          if (!calcTarget) return
          patchEntryIn(calcTarget.mappingId, calcTarget.entryId, { expression, sourceFields })
        }}
      />
    </>
  )
}

// ── Recursive source-subtree node ──────────────────────────────────────────────

interface SourceNodeProps {
  node: SourceTreeNode
  depth: number
  /** The enclosing mapping (binding target for leaves under it). */
  mapping: Mapping
  targetMode: 'owned' | 'contributing'
  targetFields: ResourceField[]
  /** Reverse index: source path → the bare-token binding entry on it. */
  sourceToEntry: Map<string, FieldMapping>
  /** Every target key bound by some entry — leaf pickers exclude the rest. */
  usedTargetKeys: Set<string>
  childByNodePath: Map<string, Mapping>
  /** Reference children (id-only links) keyed by FK source path. */
  refChildByNodePath: Map<string, Mapping>
  /** Leaves bound ACROSS a relationship: source path → the flat child + its binding. */
  drilledBindBySourcePath: Map<string, { child: Mapping; entry: FieldMapping }>
  onAssign: (sourcePath: string, targetKey: string) => void
  /** Per-entry mutations operate on the binding's stable id. */
  onClear: (entryId: string) => void
  onMergeChange: (entryId: string, value: string) => void
  /** Set / clear a leaf's identity role (External ID anchor or secondary Match). */
  onSetIdentityRole: (sourcePath: string, role: 'externalId' | 'match' | null) => void
  /** Drill a relationship off the parent def to fan a branch out into its own mapping. */
  onFanOutRelationship: (node: SourceTreeNode, field: ResourceField, ref: FieldReference) => void
  /** Link a flat-FK leaf to an existing relationship (id-only reference). */
  onLinkRelationship: (node: SourceTreeNode, field: ResourceField, ref: FieldReference) => void
  /** Remove an id-only link (delete its reference child mapping). */
  onClearLink: (refChildId: string) => void
  /** Bind a leaf ACROSS a relationship — a drilled `FieldPath` (unified picker §2). */
  onAssignDrilled: (node: SourceTreeNode, field: ResourceField, ref: FieldReference) => void
  /** Clear a leaf's drilled binding (and its flat child if now empty). */
  onClearDrilled: (node: SourceTreeNode) => void
  /** Set / clear a drilled leaf's identity role (routes to the flat child's binding). */
  onSetDrilledIdentityRole: (node: SourceTreeNode, role: 'externalId' | 'match' | null) => void
  /** Change a drilled leaf's merge strategy (routes to the flat child's binding). */
  onDrilledMergeChange: (node: SourceTreeNode, value: string) => void
  // Child-mapping recursion context (forwarded to a nested MappingNode).
  connectorId: string
  streamId: string
  streamKey: string
  sourceSchema?: Record<string, unknown> | null
  sourcePaths: SourcePath[]
  byMappingId: Map<string, Mapping>
  childrenOf: Map<string | null, Mapping[]>
  mutations: MappingDraftMutations
  syncedDefIds: Set<string>
}

/**
 * One node of a mapping's source subtree (plan §3.3). Resolves to one of three
 * renders: a promoted child `MappingNode` (a child mapping exists at this
 * branch), an un-promoted {@link BranchRow} (object/array container + action
 * menu), or a {@link SourceLeafRow} (scalar / array-of-scalars binding).
 */
function SourceNode(props: SourceNodeProps) {
  const {
    node,
    depth,
    mapping,
    targetMode,
    targetFields,
    sourceToEntry,
    usedTargetKeys,
    childByNodePath,
    onAssign,
    onClear,
    onMergeChange,
    onSetIdentityRole,
    onFanOutRelationship,
  } = props
  const [open, setOpen] = useState(true)

  // Drilled-binding context — a leaf bound ACROSS a relationship (its value writes a
  // related record). Resolve the related def's label + the bound field's label for the
  // chip ("Contact › Email"). Hooks run unconditionally (null def when not drilled) so
  // order stays stable across the branch/leaf early returns below.
  const drilled = !node.isBranch ? props.drilledBindBySourcePath.get(node.path) : undefined
  const drilledDefId = drilled?.child.entityDefinitionId ?? null
  const drilledDef = useResourceProperty(drilledDefId, ['label'])
  const { fields: drilledDefFields } = useResourceFields(drilledDefId)
  // Reference-link target def — resolved here (before the early returns). Hooks run
  // unconditionally; `refChild` is a leaf-only concern (null on a branch).
  const refChild = !node.isBranch ? props.refChildByNodePath.get(node.path) : undefined
  const refChildResource = useResourceProperty(refChild?.entityDefinitionId ?? null, [
    'label',
    'icon',
  ])

  // A child mapping at this branch → render it inline (promoted state).
  const childMapping = node.isBranch ? childByNodePath.get(node.path) : undefined
  if (childMapping) {
    return (
      <MappingNode
        mapping={childMapping}
        depth={depth}
        connectorId={props.connectorId}
        streamId={props.streamId}
        streamKey={props.streamKey}
        sourceSchema={props.sourceSchema}
        sourcePaths={props.sourcePaths}
        byMappingId={props.byMappingId}
        childrenOf={props.childrenOf}
        mutations={props.mutations}
        syncedDefIds={props.syncedDefIds}
      />
    )
  }

  if (node.isBranch) {
    return (
      <BranchRow
        depth={depth}
        node={node}
        isOpen={open}
        onToggleOpen={() => setOpen((o) => !o)}
        // A branch INSIDE a mapping fans out by drilling a relationship off the
        // parent def (§11.1) — the related def is derived, never freely picked.
        parentEntityDefinitionId={mapping.entityDefinitionId}
        onFanOutRelationship={(field, ref) => onFanOutRelationship(node, field, ref)}>
        <CappedNodeList
          nodes={node.children}
          childDepth={depth + 1}
          isCappable={(n) =>
            !n.isBranch &&
            !props.sourceToEntry.has(n.path) &&
            !props.refChildByNodePath.has(n.path) &&
            !props.drilledBindBySourcePath.has(n.path)
          }
          renderNode={(child) => (
            <SourceNode key={child.path} {...props} node={child} depth={depth + 1} />
          )}
        />
      </BranchRow>
    )
  }

  const directEntry = sourceToEntry.get(node.path)
  const assignedTargetKey = directEntry?.targetFieldRef ?? undefined
  const assignedField = assignedTargetKey
    ? targetFields.find((f) => fieldMatchesRef(f, mapping.entityDefinitionId, assignedTargetKey))
    : undefined
  const assignedLabel = assignedField?.label
  const assignedIconId = fieldIconId(assignedField)
  // Exclude target keys bound elsewhere (keep this leaf's own key selectable).
  const excludeKeys = assignedTargetKey
    ? new Set([...usedTargetKeys].filter((k) => k !== assignedTargetKey))
    : usedTargetKeys

  // A drilled binding (this leaf's value writes a related def, via a flat child) — the
  // chip reaches across the relationship ("Contact › Email") and the controls route to
  // the child. Direct and drilled are mutually exclusive on one leaf.
  let drilledLabel: string | undefined
  let drilledRef: FieldReference | undefined
  let drilledIconId: string | undefined
  if (drilled?.entry.targetFieldRef) {
    const drilledRefStr = drilled.entry.targetFieldRef
    const drilledField = drilledDefFields.find((f) =>
      fieldMatchesRef(f, drilledDefId, drilledRefStr)
    )
    const fieldLabel =
      drilledField?.label ?? getFieldId(drilled.entry.targetFieldRef as ResourceFieldId)
    drilledLabel = `${drilledDef?.label ?? 'Related'} › ${fieldLabel}`
    drilledIconId = fieldIconId(drilledField)
    const relRef = keyToFieldRef(drilled.child.relationshipFieldKey ?? '')
    const relSegs = isFieldPath(relRef) ? relRef : [relRef as ResourceFieldId]
    drilledRef = toFieldPath([...relSegs, drilled.entry.targetFieldRef as ResourceFieldId])
  }

  // Id-only relationship link (§9.6a Case B): a `reference` child mapping on this
  // leaf path links the FK to a relationship. Independent of the scalar binding —
  // the leaf keeps its scalar cell; the link renders on its own sub-row. The stored
  // `relationshipFieldKey` is a serialized FieldReference (single-drill = the
  // relationship's `ResourceFieldId`), so resolve the field by that ref. (`refChild` +
  // its resolved def are hoisted above for rules-of-hooks.)
  const refKey = refChild?.relationshipFieldKey ?? undefined
  const linkedField = refKey
    ? targetFields.find((f) => fieldMatchesRef(f, mapping.entityDefinitionId, refKey))
    : undefined
  // `linkedField` was matched on refKey, so its canonical ref IS refKey.
  const linkedFieldRef = linkedField ? refKey : undefined
  // The active binding (drilled child's entry, else the direct entry) drives the
  // identity-role + merge controls.
  const activeEntry = drilled?.entry ?? directEntry
  const identityRole = activeEntry?.identityRole?.kind ?? null
  // Relationships are linkable/drillable on a SCALAR leaf only (array fan-out is a
  // branch drill), once a target def is set.
  const allowRelationships = node.type !== 'array' && !!mapping.entityDefinitionId

  return (
    <>
      <SourceLeafRow
        depth={depth}
        node={node}
        entityDefinitionId={mapping.entityDefinitionId}
        assignedLabel={assignedLabel}
        assignedIconId={drilledIconId ?? assignedIconId}
        assignedTargetKey={assignedTargetKey}
        excludeKeys={excludeKeys}
        // Quick-create is available whenever there's a real target def (the
        // `customField.create` mutation mints the field).
        canCreate={!!mapping.entityDefinitionId}
        isOwned={targetMode === 'owned'}
        identityRole={identityRole}
        mergeStrategy={activeEntry?.mergeStrategy ?? 'overwrite'}
        allowRelationships={allowRelationships}
        linkedFieldRef={linkedFieldRef}
        drilledLabel={drilledLabel}
        drilledRef={drilledRef}
        onAssign={(targetKey) => onAssign(node.path, targetKey)}
        onDrilledAssign={(field, ref) => props.onAssignDrilled(node, field, ref)}
        onClear={() =>
          drilled ? props.onClearDrilled(node) : directEntry && onClear(directEntry.id)
        }
        onMergeChange={(value) =>
          drilled
            ? props.onDrilledMergeChange(node, value)
            : directEntry && onMergeChange(directEntry.id, value)
        }
        onSetIdentityRole={(role) =>
          drilled ? props.onSetDrilledIdentityRole(node, role) : onSetIdentityRole(node.path, role)
        }
        onLinkRelationship={(field, ref) => props.onLinkRelationship(node, field, ref)}
      />
      {refChild && (
        <RelationshipLinkRow
          depth={depth + 1}
          fieldLabel={linkedField?.label ?? refChild.relationshipFieldKey ?? 'relationship'}
          targetLabel={refChildResource?.label}
          targetIcon={refChildResource?.icon}
          viaPath={node.path}
          onClear={() => props.onClearLink(refChild.id)}
        />
      )}
    </>
  )
}

// ── Formula row (a computed target field) ──────────────────────────────────────

interface FormulaRowProps {
  depth: number
  /** The def the picker drills/binds FROM. Null until a target def is picked. */
  entityDefinitionId: string | null
  /** Target field key this formula currently writes into (`''` if unassigned). */
  targetKey: string
  /** Resolved label for the target field. */
  label: string
  /** Resolved icon id for the target field (for the picker chip). */
  iconId?: string
  /** The calc expression (shown on the source button; click it to edit). */
  expression: string
  mergeStrategy: string
  /** Target keys bound by other entries — excluded from the retarget picker. */
  excludeKeys?: Set<string>
  /** Show relationships in the picker so the formula can drill ACROSS one (§4). */
  allowRelationships?: boolean
  /** Chip text when bound across a relationship ("Contact › Full name"). */
  drilledLabel?: string
  /** The drilled `FieldPath`, for the picker's selected check on the far field. */
  drilledRef?: FieldReference
  /** This formula's identity role (External ID / Match), keyed by entry id (§5.1). */
  identityRole?: IdentityRole
  /** Offer the "Match existing" option — needs a bound target to compare against. */
  canMatch?: boolean
  onEdit: () => void
  /** Re-point the formula at a different ROOT target field key. */
  onRetarget: (newKey: string) => void
  /** The picker drilled to a far field — bind the computed value across the relationship. */
  onDrilledAssign?: (ref: FieldReference) => void
  /** Set / clear this formula's identity role. Absent → no identifier control. */
  onSetIdentityRole?: (role: IdentityRole) => void
  onMergeChange: (value: string) => void
  onClear: () => void
}

/**
 * A computed target field (plan 10 §3.2) — a non-bare `fieldMappings` entry that
 * can reference many source fields, so it lives on its own row rather than on a
 * source leaf. Mirrors a leaf row: the source cell is a button (showing the calc
 * expression, or "Set formula…") that opens {@link FieldCalcDialog}; the target
 * column is a field picker (a formula produces a scalar — string-typed for the
 * compat filter). With {@link allowRelationships} the picker can drill ACROSS a
 * relationship to write a related def (formula-drill-targets §4). The identity
 * control (keyed by entry id) marks the computed value as the record's External ID
 * or a Match key (§5.1) — the runtime evaluates the expression as the key.
 */
function FormulaRow({
  depth,
  entityDefinitionId,
  targetKey,
  label,
  iconId,
  expression,
  mergeStrategy,
  excludeKeys,
  allowRelationships,
  drilledLabel,
  drilledRef,
  identityRole,
  canMatch,
  onEdit,
  onRetarget,
  onDrilledAssign,
  onSetIdentityRole,
  onMergeChange,
  onClear,
}: FormulaRowProps) {
  return (
    <MappingRow
      depth={depth}
      icon={<FunctionSquare className='size-3.5' />}
      // Source cell = a button that opens the formula dialog (shows the expression
      // when set), trailed by the identity key icon; target column = the field it
      // writes into.
      title={
        <span className='flex w-full items-center gap-1'>
          <Button
            variant='transparent'
            onClick={onEdit}
            className={`h-9 min-w-0 flex-1 justify-start rounded-none px-1 text-xs hover:bg-primary/5 ${
              expression ? 'font-mono' : 'text-muted-foreground'
            }`}>
            <span className='truncate'>{expression || 'Set formula…'}</span>
          </Button>
          {onSetIdentityRole && (
            <IdentityRoleControl
              role={identityRole ?? null}
              canMatch={!!canMatch}
              onChange={onSetIdentityRole}
            />
          )}
        </span>
      }
      arrow='filled'
      target={
        <MappingFieldPicker
          entityDefinitionId={entityDefinitionId}
          // A formula has no single source type — it yields a scalar; 'string'
          // drives the (TEXT-compatible) target filter. Quick-create is off; a
          // formula targets an existing field.
          sourceType='string'
          sourcePath=''
          assignedKey={targetKey || undefined}
          // Drilled chip wins; else the field label, or undefined (not '') so the
          // picker falls back to its "Apply field…" placeholder.
          assignedLabel={drilledLabel ?? (label || undefined)}
          assignedIconId={iconId}
          drilledRef={drilledRef}
          excludeKeys={excludeKeys}
          canCreate={false}
          allowRelationships={allowRelationships}
          onAssign={onRetarget}
          // The picker hands back (field, ref); a formula only needs the path.
          onDrilledAssign={onDrilledAssign ? (_field, ref) => onDrilledAssign(ref) : undefined}
          onClear={onClear}
        />
      }
      // Right-aligned merge → trash, matching the leaf/header rows. No Identifier —
      // a formula has no single source path to match identity on.
      actions={
        <FieldRowActions
          mergeStrategy={mergeStrategy}
          onMergeChange={onMergeChange}
          onClear={onClear}
          clearTooltip='Remove formula'
        />
      }
    />
  )
}

/**
 * A formula bound ACROSS a relationship (formula-drill-targets §4): its entry lives
 * on a flat child mapping, but it renders as a {@link FormulaRow} on the parent whose
 * picker roots at the PARENT def (so it offers the same drill) and whose chip reaches
 * across to "Def › Field". Resolves that chip + the far field's icon from the child's
 * def. Controls route to the child's entry via the handlers from the parent.
 */
function DrilledFormulaRow({
  depth,
  parentEntityDefinitionId,
  child,
  entry,
  excludeKeys,
  onSetIdentityRole,
  onEdit,
  onRetargetRoot,
  onDrilledAssign,
  onMergeChange,
  onClear,
}: {
  depth: number
  parentEntityDefinitionId: string | null
  child: Mapping
  entry: FieldMapping
  excludeKeys?: Set<string>
  onSetIdentityRole: (role: IdentityRole) => void
  onEdit: () => void
  onRetargetRoot: (newKey: string) => void
  onDrilledAssign: (ref: FieldReference) => void
  onMergeChange: (value: string) => void
  onClear: () => void
}) {
  const def = useResourceProperty(child.entityDefinitionId, ['label'])
  const { fields } = useResourceFields(child.entityDefinitionId)
  const targetRef = (entry.targetFieldRef ?? null) as ResourceFieldId | null
  const farField = targetRef
    ? fields.find((f) => fieldMatchesRef(f, child.entityDefinitionId, targetRef))
    : undefined
  const fieldLabel = targetRef ? (farField?.label ?? getFieldId(targetRef)) : ''
  const drilledLabel = `${def?.label ?? 'Related'} › ${fieldLabel}`
  // Rebuild the drilled FieldPath ([rel…, targetRef]) for the picker's selected check.
  const relRef = keyToFieldRef(child.relationshipFieldKey ?? '')
  const relSegs = isFieldPath(relRef) ? relRef : [relRef as ResourceFieldId]
  const drilledRef = targetRef ? toFieldPath([...relSegs, targetRef]) : undefined

  return (
    <FormulaRow
      depth={depth}
      // Root the picker at the PARENT def so it offers the same drill.
      entityDefinitionId={parentEntityDefinitionId}
      targetKey={targetRef ?? ''}
      label={fieldLabel}
      iconId={fieldIconId(farField)}
      expression={entry.expression}
      mergeStrategy={entry.mergeStrategy ?? 'overwrite'}
      excludeKeys={excludeKeys}
      allowRelationships={parentEntityDefinitionId != null}
      drilledLabel={drilledLabel}
      drilledRef={drilledRef}
      // External ID here keys the RELATED record (a radio within the flat child).
      identityRole={entry.identityRole?.kind ?? null}
      canMatch={targetRef != null}
      onSetIdentityRole={onSetIdentityRole}
      onEdit={onEdit}
      onRetarget={onRetargetRoot}
      onDrilledAssign={onDrilledAssign}
      onMergeChange={onMergeChange}
      onClear={onClear}
    />
  )
}
