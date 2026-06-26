// apps/web/src/components/data-connectors/ui/mapping-node.tsx
'use client'

import type { ResourceField } from '@auxx/lib/resources/client'
import { getRelatedEntityDefinitionId, type RelationshipConfig } from '@auxx/types/custom-field'
import { type FieldReference, fieldRefToKey, toResourceFieldId } from '@auxx/types/field'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { EntityIcon } from '@auxx/ui/components/icons'
import { toastError } from '@auxx/ui/components/toast'
import { SimpleTooltip } from '@auxx/ui/components/tooltip'
import { GridTreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { generateId } from '@auxx/utils'
import { ArrowRight, FunctionSquare, Loader2, Plus, Sparkles, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { ResourcePicker } from '~/components/pickers/resource-picker'
import { useResourceFields, useResourceProperty } from '~/components/resources'
import { api, type RouterOutputs } from '~/trpc/react'
import {
  absolutePrefix,
  buildSourceTree,
  leafPathsUnder,
  type SourcePath,
  type SourceTreeNode,
  subtreeUnder,
} from '../hooks/use-source-paths'
import type { FieldMapping, useStreamMutations } from '../hooks/use-stream-mutations'
import { BranchRow } from './branch-row'
import { CappedNodeList } from './capped-node-list'
import { FieldCalcDialog } from './field-calc-dialog'
import { MAPPING_COLS } from './mapping-columns'
import { MappingFieldPicker } from './mapping-field-picker'
import { MergeStrategyToggle } from './merge-strategy-toggle'
import { RelationshipLinkRow } from './relationship-link-row'
import { SourceLeafRow } from './source-leaf-row'

type Mapping = RouterOutputs['dataConnector']['listStreams'][number]['mappings'][number]

/**
 * Canonical `ResourceFieldId` for a target field — what bindings store. Prefer the
 * field's own `resourceFieldId`, else compose it from the mapping's def.
 */
function refOf(field: ResourceField, entityDefinitionId: string | null | undefined): string {
  return field.resourceFieldId ?? toResourceFieldId(entityDefinitionId ?? '', field.id)
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
 * the defined source schema. A named branch borrows its field name (`draft` →
 * "each draft"); the unnamed array ROOT (`[]`) has no schema name, so it falls
 * back to the stream's own noun (stream key `todos` → "each todo").
 */
function describeRootPath(rootPath: string, fallbackNoun?: string): string {
  if (rootPath === '') return 'whole payload'
  const seg = rootPath.replace(/\[\]$/, '').split('.').pop()
  if (seg) return `each ${recordNoun(seg)}`
  return fallbackNoun ? `each ${recordNoun(fallbackNoun)}` : 'each item'
}

/** A degenerate single-token `{path}` expression (one-click row, not a calc). */
function isBareToken(expression: string): boolean {
  return /^\{[^{}]+\}$/.test(expression.trim())
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
  mutations: ReturnType<typeof useStreamMutations>
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
  // The binding entry whose formula the dialog is editing (null = closed). Set to
  // a draft entry's id when "Add formula" appends a fresh row.
  const [calcEntryId, setCalcEntryId] = useState<string | null>(null)
  const { setMappingTarget, removeMapping, setFieldMappings, fanOut } = mutations

  // Target def display + fields, read from the resource store (the same source
  // the ResourcePicker/FieldPicker use) — no parallel projection needed.
  const resource = useResourceProperty(mapping.entityDefinitionId, ['icon', 'label'])
  const { fields: targetFields } = useResourceFields(mapping.entityDefinitionId)
  const linkMode = mapping.linkMode as 'upsert' | 'reference'
  const targetMode = mapping.targetMode as 'owned' | 'contributing'
  const fieldMappings = (mapping.fieldMappings ?? []) as FieldMapping[]

  // Find the target field a stored ref points at (label/normalize resolution).
  const fieldByRef = (ref: string | null | undefined): ResourceField | undefined =>
    ref ? targetFields.find((f) => refOf(f, mapping.entityDefinitionId) === ref) : undefined

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
  // Reference children (flat-FK links, Approach B) live on a SCALAR leaf, not a
  // branch — index them separately so a linked leaf renders in "linked" state
  // instead of being promoted to a nested MappingNode (the upsert fan-out path).
  const upsertChildren = childMappings.filter((c) => c.linkMode !== 'reference')
  const refChildByNodePath = new Map<string, Mapping>()
  for (const c of childMappings) {
    if (c.linkMode === 'reference') refChildByNodePath.set(c.rootPath.replace(/\[\]$/, ''), c)
  }
  const childByNodePath = new Map<string, Mapping>()
  for (const c of upsertChildren) childByNodePath.set(c.rootPath.replace(/\[\]$/, ''), c)
  // Children whose branch isn't in the current schema (e.g. schema regenerated)
  // would otherwise vanish — render them appended so they stay editable/removable.
  const orphanChildren = upsertChildren.filter(
    (c) => !branchPaths.has(c.rootPath.replace(/\[\]$/, ''))
  )

  // Reverse-index bare-token entries: source path → the binding entry on it.
  const sourceToEntry = new Map<string, FieldMapping>()
  for (const e of fieldMappings) {
    if (isBareToken(e.expression)) sourceToEntry.set(e.expression.replace(/^\{|\}$/g, ''), e)
  }

  // Formula rows = computed entries (a multi-source formula has no single leaf to
  // anchor on) PLUS unassigned drafts (`targetFieldRef: null`), which are persisted
  // half-authored formulas with nowhere to live on the source tree yet.
  const formulaEntries = fieldMappings.filter(
    (e) => !isBareToken(e.expression) || e.targetFieldRef == null
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
    setCalcEntryId(id)
  }

  const calcEntry = calcEntryId ? fieldMappings.find((e) => e.id === calcEntryId) : undefined

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

  return (
    <>
      <GridTreeRow
        columns={MAPPING_COLS}
        depth={depth}
        expandable
        chevronOnHover
        isOpen={open}
        onToggleOpen={() => setOpen((o) => !o)}
        icon={<EntityIcon iconId={resource?.icon ?? 'table'} size='xs' />}
        title={
          // The rootPath is fixed by the source row this mapping was created from
          // (`data` → "each data") — a static label, not a chooser.
          <span className='text-xs text-muted-foreground'>
            {describeRootPath(mapping.rootPath, streamKey)}
          </span>
        }
        cells={[
          <span key='arrow' className='flex w-full justify-center text-muted-foreground'>
            <ArrowRight className='size-3.5' />
          </span>,
          <ResourcePicker
            key='target'
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
          />,
          <div key='actions' className='flex w-full items-center justify-end gap-1 pr-1'>
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
          </div>,
        ]}>
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
              !n.isBranch && !sourceToEntry.has(n.path) && !refChildByNodePath.has(n.path)
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
                onAssign={assignTarget}
                onClear={clearEntry}
                onMergeChange={(id, value) =>
                  patchEntry(id, { mergeStrategy: value as FieldMapping['mergeStrategy'] })
                }
                onSetIdentityRole={setIdentityRole}
                onFanOutRelationship={materializeRelatedChild}
                onLinkRelationship={linkRelationship}
                onClearLink={(refChildId) => removeMapping(streamId, refChildId)}
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
                expression={e.expression}
                mergeStrategy={e.mergeStrategy ?? 'overwrite'}
                // Exclude keys other entries already bind, so a formula can't be
                // retargeted onto a field already in use.
                excludeKeys={
                  e.targetFieldRef
                    ? new Set([...usedTargetKeys].filter((k) => k !== e.targetFieldRef))
                    : usedTargetKeys
                }
                onEdit={() => setCalcEntryId(e.id)}
                onRetarget={(newKey) => retargetEntry(e.id, newKey)}
                onMergeChange={(value) =>
                  patchEntry(e.id, { mergeStrategy: value as FieldMapping['mergeStrategy'] })
                }
                onClear={() => clearEntry(e.id)}
              />
            ))}
            {mapping.entityDefinitionId != null && (
              <GridTreeRow
                columns={MAPPING_COLS}
                depth={depth + 1}
                icon={<Plus className='size-3.5 text-muted-foreground/50' />}
                // "Add formula" persists a fresh draft row (no target yet) and opens
                // the expression dialog on it — you author the formula first and pick
                // the destination field after (or leave it unassigned for later).
                title={
                  <Button
                    variant='transparent'
                    onClick={addFormula}
                    className='h-9 w-full justify-start rounded-none px-1 text-sm text-muted-foreground hover:bg-primary/5'>
                    Add formula
                  </Button>
                }
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
      </GridTreeRow>

      {/* The formula editor — opened by a formula row's source button or the
          "Add formula" row. Source paths are scoped to this mapping's subtree
          (matching the runtime). */}
      <FieldCalcDialog
        open={calcEntryId !== null}
        onOpenChange={(o) => !o && setCalcEntryId(null)}
        targetLabel={
          calcEntry?.targetFieldRef
            ? (fieldByRef(calcEntry.targetFieldRef)?.label ?? calcEntry.targetFieldRef)
            : ''
        }
        expression={calcEntry?.expression ?? ''}
        sourcePaths={leafPathsUnder(sourcePaths, prefix)}
        onSave={(expression, sourceFields) => {
          if (!calcEntryId) return
          patchEntry(calcEntryId, { expression, sourceFields })
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
  // Child-mapping recursion context (forwarded to a nested MappingNode).
  connectorId: string
  streamId: string
  streamKey: string
  sourceSchema?: Record<string, unknown> | null
  sourcePaths: SourcePath[]
  byMappingId: Map<string, Mapping>
  childrenOf: Map<string | null, Mapping[]>
  mutations: ReturnType<typeof useStreamMutations>
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
            !n.isBranch && !props.sourceToEntry.has(n.path) && !props.refChildByNodePath.has(n.path)
          }
          renderNode={(child) => (
            <SourceNode key={child.path} {...props} node={child} depth={depth + 1} />
          )}
        />
      </BranchRow>
    )
  }

  const entry = sourceToEntry.get(node.path)
  const assignedTargetKey = entry?.targetFieldRef ?? undefined
  const assignedLabel = assignedTargetKey
    ? targetFields.find((f) => refOf(f, mapping.entityDefinitionId) === assignedTargetKey)?.label
    : undefined
  // Exclude target keys bound elsewhere (keep this leaf's own key selectable).
  const excludeKeys = assignedTargetKey
    ? new Set([...usedTargetKeys].filter((k) => k !== assignedTargetKey))
    : usedTargetKeys

  // Id-only relationship link (§9.6a Case B): a `reference` child mapping on this
  // leaf path links the FK to a relationship. Independent of the scalar binding —
  // the leaf keeps its scalar cell; the link renders on its own sub-row. The stored
  // `relationshipFieldKey` is a serialized FieldReference (single-drill = the
  // relationship's `ResourceFieldId`), so resolve the field by that ref.
  const refChild = props.refChildByNodePath.get(node.path)
  const refKey = refChild?.relationshipFieldKey ?? undefined
  const linkedField = refKey
    ? targetFields.find((f) => refOf(f, mapping.entityDefinitionId) === refKey)
    : undefined
  // `linkedField` was matched on refKey, so its canonical ref IS refKey.
  const linkedFieldRef = linkedField ? refKey : undefined
  // The current identity role on this leaf (External ID anchor / secondary Match).
  const identityRole = entry?.identityRole?.kind ?? null
  // Relationships are linkable on a SCALAR FK leaf only (array fan-out is a branch
  // drill, not a leaf link), once a target def is set.
  const allowRelationships = node.type !== 'array' && !!mapping.entityDefinitionId

  return (
    <>
      <SourceLeafRow
        depth={depth}
        node={node}
        entityDefinitionId={mapping.entityDefinitionId}
        assignedLabel={assignedLabel}
        assignedTargetKey={assignedTargetKey}
        excludeKeys={excludeKeys}
        // Quick-create is available whenever a target def is set — both owned
        // (the connector provisions the def) and contributing (adding a field to
        // an existing def). The `customField.create` mutation is the backstop for
        // a def that rejects new fields.
        canCreate={!!mapping.entityDefinitionId}
        isOwned={targetMode === 'owned'}
        identityRole={identityRole}
        mergeStrategy={entry?.mergeStrategy ?? 'overwrite'}
        allowRelationships={allowRelationships}
        syncedDefIds={props.syncedDefIds}
        linkedFieldRef={linkedFieldRef}
        onAssign={(targetKey) => onAssign(node.path, targetKey)}
        onClear={() => entry && onClear(entry.id)}
        onMergeChange={(value) => entry && onMergeChange(entry.id, value)}
        onSetIdentityRole={(role) => onSetIdentityRole(node.path, role)}
        onLinkRelationship={(field, ref) => props.onLinkRelationship(node, field, ref)}
      />
      {refChild && (
        <RelationshipLinkRow
          depth={depth + 1}
          fieldLabel={linkedField?.label ?? refChild.relationshipFieldKey ?? 'relationship'}
          targetDefinitionId={refChild.entityDefinitionId}
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
  /** The def whose fields the formula can target. Null until a target def is picked. */
  entityDefinitionId: string | null
  /** Target field key this formula currently writes into (`''` if unassigned). */
  targetKey: string
  /** Resolved label for the target field. */
  label: string
  /** The calc expression (shown on the source button; click it to edit). */
  expression: string
  mergeStrategy: string
  /** Target keys bound by other entries — excluded from the retarget picker. */
  excludeKeys?: Set<string>
  onEdit: () => void
  /** Re-point the formula at a different target field key. */
  onRetarget: (newKey: string) => void
  onMergeChange: (value: string) => void
  onClear: () => void
}

/**
 * A computed target field (plan 10 §3.2) — a non-bare `fieldMappings` entry that
 * can reference many source fields, so it lives on its own row rather than on a
 * source leaf. Mirrors a leaf row: the source cell is a button (showing the calc
 * expression, or "Set formula…") that opens {@link FieldCalcDialog}; the target
 * column is a field picker (a formula produces a scalar — string-typed for the
 * compat filter). No Match toggle (no single source path to match identity on).
 */
function FormulaRow({
  depth,
  entityDefinitionId,
  targetKey,
  label,
  expression,
  mergeStrategy,
  excludeKeys,
  onEdit,
  onRetarget,
  onMergeChange,
  onClear,
}: FormulaRowProps) {
  return (
    <GridTreeRow
      columns={MAPPING_COLS}
      depth={depth}
      icon={<FunctionSquare className='size-3.5' />}
      // Source cell = a button that opens the formula dialog (shows the expression
      // when set); target column = the field it writes into.
      title={
        <Button
          variant='transparent'
          onClick={onEdit}
          className={`h-9 w-full justify-start rounded-none px-1 text-xs hover:bg-primary/5 ${
            expression ? 'font-mono' : 'text-muted-foreground'
          }`}>
          <span className='truncate'>{expression || 'Set formula…'}</span>
        </Button>
      }
      cells={[
        <span key='arrow' className='flex w-full justify-center text-muted-foreground'>
          <ArrowRight className='size-3.5' />
        </span>,
        <MappingFieldPicker
          key='target'
          entityDefinitionId={entityDefinitionId}
          // A formula has no single source type — it yields a scalar; 'string'
          // drives the (TEXT-compatible) target filter. Quick-create is off; a
          // formula targets an existing field.
          sourceType='string'
          sourcePath=''
          assignedKey={targetKey || undefined}
          assignedLabel={label}
          excludeKeys={excludeKeys}
          canCreate={false}
          onAssign={onRetarget}
          onClear={onClear}
        />,
        <div key='actions' className='flex w-full items-center justify-end gap-1 pr-1'>
          {/* Right-aligned merge badge → trash, matching the leaf/header rows. No
              Identifier — a formula has no single source path to match identity on. */}
          <MergeStrategyToggle value={mergeStrategy} onValueChange={onMergeChange} />
          <TreeRowButton variant='destructive' tooltipText='Remove formula' onClick={onClear}>
            <Trash2 />
          </TreeRowButton>
        </div>,
      ]}
    />
  )
}
