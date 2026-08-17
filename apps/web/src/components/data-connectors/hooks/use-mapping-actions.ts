// apps/web/src/components/data-connectors/hooks/use-mapping-actions.ts
// The mutation orchestration for ONE mapping node — every leaf-bind / relationship-link /
// drilled-bind / formula-relocation handler, lifted out of `MappingNode` so the component
// is just resolve → view → actions → render. Each handler closes over the connector draft
// `mutations` (fanOut / setFieldMappings / removeMapping) and the precomputed `view`; the
// pure entry transforms live in `field-mapping-edits`. UI-only handlers (opening the calc
// dialog, the target-mode toggle, the suggester) stay in the component — these are the
// data edits.

import { fieldMatchesRef, type ResourceField } from '@auxx/lib/resources/client'
import {
  type FieldReference,
  fieldRefToKey,
  getFieldDefinitionId,
  isFieldPath,
  type ResourceFieldId,
} from '@auxx/types/field'
import { toastError } from '@auxx/ui/components/toast'
import { generateId } from '@auxx/utils'
import type { DraftMapping, MappingDraftMutations } from '../stores/connector-draft-store'
import {
  bareTokenNodePath,
  bindingFor,
  isBareToken,
  removeBindingForSource,
  retargetFormulaEntry,
  setEntryIdentityRole,
  toNodePath,
  upsertBinding,
} from '../ui/field-mapping-edits'
import type { IdentityRole } from '../ui/identity-role-control'
import { branchRootPath, relatedDefOf } from '../ui/mapping-node-helpers'
import type { MappingView } from '../ui/mapping-view'
import type { SourceTreeNode } from './use-source-paths'
import type { FieldMapping } from './use-stream-mutations'

type Normalize = 'email' | 'phone' | 'domain' | 'none'

interface UseMappingActionsArgs {
  streamId: string
  mapping: DraftMapping
  /** This mapping's current entries (`mapping.fieldMappings`). */
  fieldMappings: FieldMapping[]
  /** The precomputed render model — child/drilled indices the handlers read. */
  view: MappingView
  /** All mappings by id — to read another mapping's entries (drilled formulas). */
  byMappingId: Map<string, DraftMapping>
  /** The target def's fields — for the match normalizer. */
  targetFields: ResourceField[]
  mutations: MappingDraftMutations
}

/** Every data-mutation handler a mapping node binds to its rows. */
export interface MappingActions {
  patchEntry: (id: string, patch: Partial<FieldMapping>) => void
  patchEntryIn: (mappingId: string, entryId: string, patch: Partial<FieldMapping>) => void
  assignTarget: (sourcePath: string, targetRef: string) => void
  clearEntry: (id: string) => void
  retargetEntry: (id: string, newRef: string) => void
  setIdentityRole: (sourcePath: string, role: 'externalId' | 'match' | null) => void
  materializeRelatedChild: (node: SourceTreeNode, field: ResourceField, ref: FieldReference) => void
  linkRelationship: (node: SourceTreeNode, field: ResourceField, ref: FieldReference) => void
  assignDrilled: (node: SourceTreeNode, field: ResourceField, ref: FieldReference) => void
  clearDrilled: (node: SourceTreeNode) => void
  setDrilledIdentityRole: (node: SourceTreeNode, role: 'externalId' | 'match' | null) => void
  setDrilledMerge: (node: SourceTreeNode, value: string) => void
  setFormulaIdentityRole: (entryId: string, role: IdentityRole) => void
  setDrilledFormulaIdentityRole: (
    child: DraftMapping,
    entry: FieldMapping,
    role: IdentityRole
  ) => void
  drillHomeFormula: (entry: FieldMapping, ref: FieldReference) => void
  undrillFormula: (child: DraftMapping, entry: FieldMapping, targetRef: string) => void
  redrillFormula: (child: DraftMapping, entry: FieldMapping, ref: FieldReference) => void
  removeFormulaFromChild: (child: DraftMapping, entryId: string) => void
}

/**
 * Build the {@link MappingActions} for a mapping node. Not memoized (the handlers close
 * over freshly-derived `fieldMappings`/`view` each render, matching the inline closures
 * they replace); the connector draft store is the source of truth, so re-creating cheap
 * closures per render is fine.
 */
export function useMappingActions({
  streamId,
  mapping,
  fieldMappings,
  view,
  byMappingId,
  targetFields,
  mutations,
}: UseMappingActionsArgs): MappingActions {
  const { setFieldMappings, fanOut, removeMapping } = mutations
  const { flatDrilledChildren, refChildByNodePath, drilledBindBySourcePath, sourceToEntry } = view

  // Persist a new entry array (the single mapping field-write surface).
  const writeEntries = (next: FieldMapping[]) => setFieldMappings(streamId, mapping.id, next)

  const fieldByRef = (ref: string | null | undefined): ResourceField | undefined =>
    ref ? targetFields.find((f) => fieldMatchesRef(f, mapping.entityDefinitionId, ref)) : undefined

  // Normalizer for a match key, derived from the target field's storage type so the role
  // stays one-click (no normalize selector).
  const deriveNormalize = (targetRef: string): Normalize => {
    const ft = fieldByRef(targetRef)?.fieldType
    if (ft === 'EMAIL') return 'email'
    if (ft === 'PHONE_INTL') return 'phone'
    if (ft === 'URL') return 'domain'
    return 'none'
  }

  // Patch one entry in place by its stable id (used by every per-entry mutation).
  const patchEntry = (id: string, patch: Partial<FieldMapping>) =>
    writeEntries(fieldMappings.map((e) => (e.id === id ? { ...e, ...patch } : e)))

  // Patch an entry on ANY mapping (this one or a flat child) — a drilled formula's entry
  // lives on a child. Reads the target mapping's entries from the shared index.
  const patchEntryIn = (mappingId: string, entryId: string, patch: Partial<FieldMapping>) => {
    const entries = (byMappingId.get(mappingId)?.fieldMappings ?? []) as FieldMapping[]
    setFieldMappings(
      streamId,
      mappingId,
      entries.map((e) => (e.id === entryId ? { ...e, ...patch } : e))
    )
  }

  // `sourcePath` is the tree's NODE path. Both halves go through the shared edits
  // module so the stored expression carries the BINDING form (`emails[0].value`) the
  // runtime can resolve — writing the node form verbatim, as this used to, produced a
  // binding that looked right in the builder and resolved to `undefined` at sync.
  const assignTarget = (sourcePath: string, targetRef: string) => {
    writeEntries(upsertBinding(fieldMappings, sourcePath, targetRef))
  }

  const clearEntry = (id: string) => writeEntries(fieldMappings.filter((e) => e.id !== id))

  // Re-point a formula at a different target field. Identity is the entry id, so this is a
  // single field set — merge/match ride along, no re-key.
  const retargetEntry = (id: string, newRef: string) => patchEntry(id, { targetFieldRef: newRef })

  // Set / clear a leaf's identity role (relationship-linking v3 §9.4). External ID is the
  // primary upstream key (radio — picking it elsewhere moves it) and can live on an
  // UNMAPPED leaf. Match is secondary and needs a bound target. Clearing a role on an
  // External-ID-only entry drops the entry entirely (it only existed to carry the role).
  const setIdentityRole = (sourcePath: string, role: 'externalId' | 'match' | null) => {
    let next = fieldMappings
    if (role === 'externalId') {
      next = next.map((e) =>
        e.identityRole?.kind === 'externalId' ? { ...e, identityRole: undefined } : e
      )
    }
    // Matched in NODE space, minted in BINDING space — same contract as `assignTarget`.
    const nodePath = toNodePath(sourcePath)
    const idx = next.findIndex(
      (e) => isBareToken(e.expression) && bareTokenNodePath(e.expression) === nodePath
    )
    if (idx === -1) {
      if (role == null) return
      next = [
        ...next,
        {
          ...bindingFor(sourcePath, null),
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

  // Materialize a child mapping at a branch by DRILLING a relationship off this mapping's
  // def (relationship-linking v3 §11.1 — the core inversion). The related def is DERIVED
  // from the drilled relationship, the edge is the drilled `FieldReference`, the mode is
  // forced `contributing` — so a null `relationshipFieldKey` and an owned-on-system-def
  // footgun are both unrepresentable.
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

  // Link a flat-FK SCALAR leaf to an existing relationship by drilling it (the id-only
  // reference case, §9.6a Case B). Desugars to a child mapping rooted at the FK path whose
  // ONLY binding is the FK marked External ID — so the runtime derives `reference` and
  // anchors the lazy link on that id (no frozen target pointer). A prior link on the same
  // leaf is replaced.
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

  // Narrow a `FieldReference` to exactly `[relationship, target]`. `FieldPath` is
  // `[ResourceFieldId, ...ResourceFieldId[]]`, so a `length === 2` check alone leaves the
  // second segment optional to the compiler — destructure and test it to get both segments
  // as defined values. Toasts + returns null on a multi-hop (or non-path) ref.
  const asSingleHop = (ref: FieldReference): [ResourceFieldId, ResourceFieldId] | null => {
    if (isFieldPath(ref) && ref.length === 2) {
      const [rel, targetRef] = ref
      if (targetRef) return [rel, targetRef]
    }
    toastError({
      title: 'Multi-hop links not supported yet',
      description: 'Pick a field one relationship away from this record.',
    })
    return null
  }

  // Bind a leaf ACROSS a relationship (unified picker §2/§4): drill the target graph to a
  // field on a related def — e.g. `email → Contact.Email`. Desugars to a FLAT contributing
  // child mapping (`rootPath ''` reads THIS mapping's subtree), reusing one child per
  // drilled relationship. v1 is single-hop (a 2-segment FieldPath).
  const assignDrilled = (node: SourceTreeNode, _field: ResourceField, ref: FieldReference) => {
    const hop = asSingleHop(ref)
    if (!hop) return
    const [rel, targetRef] = hop
    const relatedDefId = getFieldDefinitionId(targetRef)
    const relKey = fieldRefToKey(rel)
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

  // Clear a drilled binding — drop it from the flat child, removing the child entirely once
  // it carries no bindings (it existed only for drilled binds).
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
  // A formula entry's "home" is either THIS parent mapping (a root-scalar target) or a flat
  // child (a target a relationship away). Picking a target moves the entry to its desired
  // home, preserving the expression. The flat child is REUSED per relationship (shared with
  // drilled leaf binds) and GC'd when its last entry leaves.

  // Upsert a (re-homed) formula entry into the flat child for `rel`, creating it if absent.
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
      linkMode: 'upsert',
      targetMode: 'contributing',
      entityDefinitionId: relatedDefId,
      relationshipFieldKey: relKey,
      fieldMappings: [entry],
    })
  }

  // Drop a formula entry from a flat child, GC'ing the child when nothing remains.
  const removeFormulaFromChild = (child: DraftMapping, entryId: string) => {
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
  const undrillFormula = (child: DraftMapping, entry: FieldMapping, targetRef: string) => {
    removeFormulaFromChild(child, entry.id)
    writeEntries([...fieldMappings, retargetFormulaEntry(entry, targetRef)])
  }

  // A DRILLED formula gains another drilled target → retarget in place when the
  // relationship is unchanged, else move it to the new relationship's child.
  const redrillFormula = (child: DraftMapping, entry: FieldMapping, ref: FieldReference) => {
    const hop = asSingleHop(ref)
    if (!hop) return
    if (child.relationshipFieldKey === fieldRefToKey(hop[0])) {
      patchEntryIn(child.id, entry.id, { targetFieldRef: hop[1] })
      return
    }
    removeFormulaFromChild(child, entry.id)
    upsertFormulaIntoRelChild(hop[0], retargetFormulaEntry(entry, hop[1]))
  }

  // Identity role on a HOME formula (formula-drill-targets §5.1) — keyed by ENTRY ID, since
  // a formula has no single source path. External ID stays a radio WITHIN this mapping (the
  // record's own key); the runtime evaluates the expression as the key, so a
  // composite/computed External ID works with no engine change.
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

  // Identity role on a DRILLED formula → patch the flat child's entry.
  const setDrilledFormulaIdentityRole = (
    child: DraftMapping,
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

  return {
    patchEntry,
    patchEntryIn,
    assignTarget,
    clearEntry,
    retargetEntry,
    setIdentityRole,
    materializeRelatedChild,
    linkRelationship,
    assignDrilled,
    clearDrilled,
    setDrilledIdentityRole,
    setDrilledMerge,
    setFormulaIdentityRole,
    setDrilledFormulaIdentityRole,
    drillHomeFormula,
    undrillFormula,
    redrillFormula,
    removeFormulaFromChild,
  }
}
