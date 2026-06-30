// apps/web/src/components/data-connectors/ui/mapping-node.tsx
'use client'

import { fieldMatchesRef, type ResourceField } from '@auxx/lib/resources/client'
import {
  type FieldReference,
  getFieldId,
  isFieldPath,
  keyToFieldRef,
  type ResourceFieldId,
  toFieldPath,
} from '@auxx/types/field'
import { Badge } from '@auxx/ui/components/badge'
import { EntityIcon } from '@auxx/ui/components/icons'
import { toastError } from '@auxx/ui/components/toast'
import { SimpleTooltip } from '@auxx/ui/components/tooltip'
import { TreeRowButton } from '@auxx/ui/components/tree-row'
import { generateId } from '@auxx/utils'
import { Loader2, Plus, Sparkles, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { ResourcePicker } from '~/components/pickers/resource-picker'
import { useResourceFields, useResourceProperty } from '~/components/resources'
import { api } from '~/trpc/react'
import { useMappingActions } from '../hooks/use-mapping-actions'
import { leafPathsUnder, type SourcePath, type SourceTreeNode } from '../hooks/use-source-paths'
import type { FieldMapping } from '../hooks/use-stream-mutations'
import type { DraftMapping, MappingDraftMutations } from '../stores/connector-draft-store'
import { BranchRow } from './branch-row'
import { CappedNodeList } from './capped-node-list'
import { FieldCalcDialog } from './field-calc-dialog'
import { isBareToken } from './field-mapping-edits'
import { DrilledFormulaRow, FormulaRow } from './formula-row'
import { describeRootPath, fieldIconId } from './mapping-node-helpers'
import { MappingRow } from './mapping-row'
import { computeMappingView } from './mapping-view'
import { RelationshipLinkRow } from './relationship-link-row'
import { SourceLeafRow } from './source-leaf-row'

// The mapping tree renders from the connector DRAFT store (plans/data-connectors/v4),
// so a row is a `DraftMapping` (fan-out/remove are temp-id/tombstone draft edits). The UI
// reads only the common subset (id, def, link/target mode, fieldMappings, rootPath, parent,
// relationshipFieldKey), all present on `DraftMapping`.
type Mapping = DraftMapping

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
 * One `DataConnectorMapping` rendered as the source-schema subtree it owns (plan §3.3).
 * The header carries the target def + target mode toggle; identity is configured per-leaf
 * (the "Match" toggle), not in the header. The render model (which leaves bind, which
 * branches promote to child mappings, which entries are formulas) is derived by
 * {@link computeMappingView}; every data edit routes through {@link useMappingActions}. The
 * body walks the mapping's subtree and, at each node, binds a leaf, offers a branch action,
 * or recurses inline as the child `MappingNode`.
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
  // The formula entry the dialog is editing (null = closed). Carries the OWNING mapping id
  // too, so the dialog can edit a drilled formula whose entry lives on a flat child.
  const [calcTarget, setCalcTarget] = useState<{ mappingId: string; entryId: string } | null>(null)
  const { setMappingTarget, removeMapping, setFieldMappings } = mutations

  // Target def display + fields — resolved from the global resource store. App-owned defs
  // are installed (real) before mapping (v6), so there's no projection layer.
  const resource = useResourceProperty(mapping.entityDefinitionId, ['icon', 'label'])
  const { fields: targetFields } = useResourceFields(mapping.entityDefinitionId)
  const linkMode = mapping.linkMode as 'upsert' | 'reference'
  const targetMode = mapping.targetMode as 'owned' | 'contributing'
  const fieldMappings = (mapping.fieldMappings ?? []) as FieldMapping[]

  // Find the target field a stored ref points at (label/normalize resolution).
  const fieldByRef = (ref: string | null | undefined): ResourceField | undefined =>
    ref ? targetFields.find((f) => fieldMatchesRef(f, mapping.entityDefinitionId, ref)) : undefined

  // The derived render model + every data-mutation handler.
  const view = computeMappingView(mapping, sourcePaths, byMappingId, childrenOf)
  const actions = useMappingActions({
    streamId,
    mapping,
    fieldMappings,
    view,
    byMappingId,
    targetFields,
    mutations,
  })

  // Persist a new entry array (used by the suggester merge + add-formula draft).
  const writeEntries = (next: FieldMapping[]) => setFieldMappings(streamId, mapping.id, next)

  // Every target field already bound by SOME entry — the pickers exclude these so two
  // entries can't fight over one field (an array allows it; the UI forbids it).
  const usedTargetKeys = new Set(
    fieldMappings.map((e) => e.targetFieldRef).filter((k): k is string => k != null)
  )

  // Tier 2 suggester (create-sync-flow §3.2) — only offered on a root-record mapping (whole
  // payload / each item), where the suggester's record-relative leaves match this mapping's
  // subtree. Merges proposals in as editable rows, skipping any source path or target field
  // that's already bound.
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

  // Append a persisted draft formula (no target yet) and open the dialog on it.
  const addFormula = () => {
    const id = generateId()
    writeEntries([...fieldMappings, { id, targetFieldRef: null, expression: '', sourceFields: {} }])
    setCalcTarget({ mappingId: mapping.id, entryId: id })
  }

  // The formula being edited may live on this parent OR a flat child — resolve it from the
  // shared index by the dialog's owning mapping id.
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
        {view.sourceTree.length === 0 ? (
          <div
            style={{ paddingLeft: `${(depth + 1) * 1.5}rem` }}
            className='px-1 py-1 text-[11px] text-muted-foreground'>
            No source schema yet — generate or edit the schema above to map fields.
          </div>
        ) : (
          <CappedNodeList
            nodes={view.sourceTree}
            childDepth={depth + 1}
            isCappable={(n) =>
              !n.isBranch &&
              !view.sourceToEntry.has(n.path) &&
              !view.refChildByNodePath.has(n.path) &&
              !view.drilledBindBySourcePath.has(n.path)
            }
            renderNode={(node) => (
              <SourceNode
                key={node.path}
                node={node}
                depth={depth + 1}
                mapping={mapping}
                targetMode={targetMode}
                targetFields={targetFields}
                sourceToEntry={view.sourceToEntry}
                usedTargetKeys={usedTargetKeys}
                childByNodePath={view.childByNodePath}
                refChildByNodePath={view.refChildByNodePath}
                drilledBindBySourcePath={view.drilledBindBySourcePath}
                onAssign={actions.assignTarget}
                onClear={actions.clearEntry}
                onMergeChange={(id, value) =>
                  actions.patchEntry(id, { mergeStrategy: value as FieldMapping['mergeStrategy'] })
                }
                onSetIdentityRole={actions.setIdentityRole}
                onFanOutRelationship={actions.materializeRelatedChild}
                onLinkRelationship={actions.linkRelationship}
                onClearLink={(refChildId) => removeMapping(streamId, refChildId)}
                onAssignDrilled={actions.assignDrilled}
                onClearDrilled={actions.clearDrilled}
                onSetDrilledIdentityRole={actions.setDrilledIdentityRole}
                onDrilledMergeChange={actions.setDrilledMerge}
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

        {/* Formula rows — one per non-bare field mapping (a computed target field), plus an
          add row. Reference-mode mappings only link, so no formulas. */}
        {linkMode !== 'reference' && (
          <>
            {view.formulaEntries.map((e) => (
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
                // Exclude keys other entries already bind, so a formula can't be retargeted
                // onto a field already in use.
                excludeKeys={
                  e.targetFieldRef
                    ? new Set([...usedTargetKeys].filter((k) => k !== e.targetFieldRef))
                    : usedTargetKeys
                }
                identityRole={e.identityRole?.kind ?? null}
                canMatch={e.targetFieldRef != null}
                ownedWrite={targetMode === 'owned'}
                onSetIdentityRole={(role) => actions.setFormulaIdentityRole(e.id, role)}
                onEdit={() => setCalcTarget({ mappingId: mapping.id, entryId: e.id })}
                onRetarget={(newKey) => actions.retargetEntry(e.id, newKey)}
                onDrilledAssign={(ref) => actions.drillHomeFormula(e, ref)}
                onMergeChange={(value) =>
                  actions.patchEntry(e.id, {
                    mergeStrategy: value as FieldMapping['mergeStrategy'],
                  })
                }
                onClear={() => actions.clearEntry(e.id)}
              />
            ))}
            {/* Drilled formulas — a computed value written across a relationship; its entry
              lives on a flat child, but it renders here as a formula row whose chip reaches
              across ("Contact › Full name"). */}
            {view.drilledFormulaRows.map(({ child, entry }) => (
              <DrilledFormulaRow
                key={entry.id}
                depth={depth + 1}
                parentEntityDefinitionId={mapping.entityDefinitionId}
                child={child}
                entry={entry}
                excludeKeys={usedTargetKeys}
                ownedWrite={targetMode === 'owned'}
                onSetIdentityRole={(role) =>
                  actions.setDrilledFormulaIdentityRole(child, entry, role)
                }
                onEdit={() => setCalcTarget({ mappingId: child.id, entryId: entry.id })}
                onRetargetRoot={(newKey) => actions.undrillFormula(child, entry, newKey)}
                onDrilledAssign={(ref) => actions.redrillFormula(child, entry, ref)}
                onMergeChange={(value) =>
                  actions.patchEntryIn(child.id, entry.id, {
                    mergeStrategy: value as FieldMapping['mergeStrategy'],
                  })
                }
                onClear={() => actions.removeFormulaFromChild(child, entry.id)}
              />
            ))}
            {mapping.entityDefinitionId != null && (
              <MappingRow
                depth={depth + 1}
                icon={<Plus className='size-3.5 text-muted-foreground/50' />}
                // "Add formula" persists a fresh draft row (no target yet) and opens the
                // expression dialog on it — you author the formula first and pick the
                // destination field after (or leave it unassigned for later). The WHOLE row
                // is the click target, and the label reads like a field.
                onToggleOpen={addFormula}
                title={<span className='font-mono text-sm'>Add formula</span>}
              />
            )}
          </>
        )}

        {/* Child mappings whose branch isn't in the current schema — appended so they don't
          silently disappear (and stay removable). */}
        {view.orphanChildren.map((child) => (
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

      {/* The formula editor — opened by a formula row's source button or the "Add formula"
          row. Source paths are scoped to this mapping's subtree (matching the runtime); a
          drilled formula's flat child reads the SAME subtree (`rootPath ''`), so the same
          paths apply. */}
      <FieldCalcDialog
        open={calcTarget !== null}
        onOpenChange={(o) => !o && setCalcTarget(null)}
        targetLabel={
          calcEntry?.targetFieldRef
            ? (fieldByRef(calcEntry.targetFieldRef)?.label ?? calcEntry.targetFieldRef)
            : ''
        }
        expression={calcEntry?.expression ?? ''}
        sourcePaths={leafPathsUnder(sourcePaths, view.prefix)}
        onSave={(expression, sourceFields) => {
          if (!calcTarget) return
          actions.patchEntryIn(calcTarget.mappingId, calcTarget.entryId, {
            expression,
            sourceFields,
          })
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
 * One node of a mapping's source subtree (plan §3.3). Resolves to one of three renders: a
 * promoted child `MappingNode` (a child mapping exists at this branch), an un-promoted
 * {@link BranchRow} (object/array container + action menu), or a {@link SourceLeafRow}
 * (scalar / array-of-scalars binding).
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

  // Drilled-binding context — a leaf bound ACROSS a relationship (its value writes a related
  // record). Resolve the related def's label + the bound field's label for the chip
  // ("Contact › Email"). Hooks run unconditionally (null def when not drilled) so order
  // stays stable across the branch/leaf early returns below.
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
        // A branch INSIDE a mapping fans out by drilling a relationship off the parent def
        // (§11.1) — the related def is derived, never freely picked.
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

  // A drilled binding (this leaf's value writes a related def, via a flat child) — the chip
  // reaches across the relationship ("Contact › Email") and the controls route to the child.
  // Direct and drilled are mutually exclusive on one leaf.
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

  // Id-only relationship link (§9.6a Case B): a `reference` child mapping on this leaf path
  // links the FK to a relationship. Independent of the scalar binding — the leaf keeps its
  // scalar cell; the link renders on its own sub-row. The stored `relationshipFieldKey` is a
  // serialized FieldReference (single-drill = the relationship's `ResourceFieldId`), so
  // resolve the field by that ref.
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
  // Relationships are linkable/drillable on a SCALAR leaf only (array fan-out is a branch
  // drill), once a target def is set.
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
