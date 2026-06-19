// apps/web/src/components/data-connectors/ui/mapping-node.tsx
'use client'

import type { ResourceField } from '@auxx/lib/resources/client'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import TreeRow, { TreeRowButton } from '@auxx/ui/components/tree-row'
import { Fingerprint, Hash, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { ResourcePicker } from '~/components/pickers/resource-picker'
import { useResourceFields, useResourceProperty } from '~/components/resources'
import type { RouterOutputs } from '~/trpc/react'
import {
  absolutePrefix,
  buildSourceTree,
  leafPathsUnder,
  type SourcePath,
  type SourceTreeNode,
  subtreeUnder,
} from '../hooks/use-source-paths'
import type { useStreamMutations } from '../hooks/use-stream-mutations'
import { BranchRow } from './branch-row'
import { SourceLeafRow } from './source-leaf-row'

/** Sentinel for the whole-payload root (`''`) — Radix Select forbids empty values. */
const ROOT_SENTINEL = '__root__'

type Mapping = RouterOutputs['dataConnector']['listStreams'][number]['mappings'][number]

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
  streamId: string
  /** The stream key — the record noun for the unnamed array root (`[]`). */
  streamKey: string
  /** Payload-absolute source paths (Layer A schema), shared by the whole tree. */
  sourcePaths: SourcePath[]
  /** Root-mapping rootPath choices (only meaningful for the root). */
  rootCandidates: string[]
  /** All mappings indexed by id — for `absolutePrefix` + child lookup. */
  byMappingId: Map<string, Mapping>
  childrenOf: Map<string | null, Mapping[]>
  mutations: ReturnType<typeof useStreamMutations>
  onPromoteField: (mappingId: string, fieldKey: string) => void
}

/**
 * One `DataConnectorMapping` rendered as the source-schema subtree it owns (plan
 * §3.3). The header carries the target def + identity + mode toggles; the body
 * walks the mapping's subtree (sliced by {@link absolutePrefix} — the nesting-bug
 * fix) and, at each node, either binds a leaf, offers a branch action menu, or —
 * when a child mapping exists at that branch — recurses inline as the child
 * `MappingNode`. No separate appended child block.
 */
export function MappingNode({
  mapping,
  depth,
  streamId,
  streamKey,
  sourcePaths,
  rootCandidates,
  byMappingId,
  childrenOf,
  mutations,
  onPromoteField,
}: MappingNodeProps) {
  const [open, setOpen] = useState(true)
  const {
    setMappingTarget,
    setRootPath,
    removeMapping,
    setFieldMappings,
    setMergeStrategies,
    setIdentityStrategy,
    fanOut,
  } = mutations

  // Target def display + fields, read from the resource store (the same source
  // the ResourcePicker/FieldPicker use) — no parallel projection needed.
  const resource = useResourceProperty(mapping.entityDefinitionId, ['icon', 'label'])
  const { fields: targetFields } = useResourceFields(mapping.entityDefinitionId)
  const linkMode = mapping.linkMode as 'upsert' | 'reference'
  const targetMode = mapping.targetMode as 'owned' | 'contributing'
  const fieldMappings = (mapping.fieldMappings ?? {}) as Record<
    string,
    { expression: string; sourceFields: Record<string, string> }
  >
  const mergeStrategies = (mapping.mergeStrategies ?? {}) as Record<string, string>

  // Slice this mapping's subtree by its FULL absolute prefix (not the bare,
  // parent-relative rootPath) so nested mappings render the correct subtree.
  const prefix = absolutePrefix(mapping, byMappingId)
  const leaves = leafPathsUnder(sourcePaths, prefix)
  const relativeSubtree = subtreeUnder(sourcePaths, prefix)
  const sourceTree = buildSourceTree(relativeSubtree)
  const branchPaths = new Set(relativeSubtree.filter((p) => p.isBranch).map((p) => p.path))

  // Child mappings indexed by their (array-normalized) rootPath segment, so a
  // branch node at `line_items` matches a child mapping with rootPath
  // `line_items[]`.
  const childMappings = childrenOf.get(mapping.id) ?? []
  const childByNodePath = new Map<string, Mapping>()
  for (const c of childMappings) childByNodePath.set(c.rootPath.replace(/\[\]$/, ''), c)
  // Children whose branch isn't in the current schema (e.g. schema regenerated)
  // would otherwise vanish — render them appended so they stay editable/removable.
  const orphanChildren = childMappings.filter(
    (c) => !branchPaths.has(c.rootPath.replace(/\[\]$/, ''))
  )

  // Reverse-index bare-token field mappings: source path → target field key.
  const sourceToTarget = new Map<string, string>()
  for (const [targetKey, fm] of Object.entries(fieldMappings)) {
    if (isBareToken(fm.expression))
      sourceToTarget.set(fm.expression.replace(/^\{|\}$/g, ''), targetKey)
  }

  const assignTarget = (sourcePath: string, targetKey: string) => {
    const next = { ...fieldMappings }
    // Drop any prior target bound to this source (1 source → 1 target).
    for (const [k, fm] of Object.entries(next)) {
      if (isBareToken(fm.expression) && fm.expression.replace(/^\{|\}$/g, '') === sourcePath) {
        delete next[k]
      }
    }
    next[targetKey] = { expression: `{${sourcePath}}`, sourceFields: { [sourcePath]: sourcePath } }
    setFieldMappings(streamId, mapping.id, next)
  }
  const clearTarget = (targetKey: string) => {
    const next = { ...fieldMappings }
    delete next[targetKey]
    setFieldMappings(streamId, mapping.id, next)
  }

  const toggleLinkMode = () =>
    setMappingTarget(streamId, {
      mappingId: mapping.id,
      entityDefinitionId: mapping.entityDefinitionId,
      targetMode,
      linkMode: linkMode === 'upsert' ? 'reference' : 'upsert',
    })
  const toggleTargetMode = () =>
    setMappingTarget(streamId, {
      mappingId: mapping.id,
      entityDefinitionId: mapping.entityDefinitionId,
      targetMode: targetMode === 'owned' ? 'contributing' : 'owned',
      linkMode,
    })

  // Materialize a child mapping at a branch (fan out / reference).
  const materializeChild = (
    node: SourceTreeNode,
    childLinkMode: 'upsert' | 'reference',
    entityDefinitionId: string
  ) =>
    fanOut(streamId, {
      parentMappingId: mapping.id,
      rootPath: branchRootPath(node),
      linkMode: childLinkMode,
      // Fan-out defaults to an owned def; reference links an existing one.
      targetMode: childLinkMode === 'reference' ? 'contributing' : 'owned',
      entityDefinitionId,
      identityStrategy: { kind: 'connectorExternalId' },
      // relationshipFieldKey left null until provisioning wires the parent
      // relation field (plan §8.1).
      relationshipFieldKey: null,
    })

  return (
    <TreeRow
      depth={depth}
      expandable
      isOpen={open}
      onToggleOpen={() => setOpen((o) => !o)}
      icon={<EntityIcon iconId={resource?.icon ?? 'table'} size='xs' />}
      title={
        <span className='flex items-center gap-1.5'>
          {mapping.parentMappingId === null && rootCandidates.length > 1 ? (
            <Select
              value={mapping.rootPath || ROOT_SENTINEL}
              onValueChange={(v) =>
                setRootPath(streamId, mapping.id, v === ROOT_SENTINEL ? '' : v)
              }>
              <SelectTrigger size='sm' className='h-6 min-w-[120px] text-xs'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {rootCandidates.map((p) => (
                  <SelectItem key={p || ROOT_SENTINEL} value={p || ROOT_SENTINEL}>
                    {describeRootPath(p, streamKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className='text-xs text-muted-foreground'>
              {describeRootPath(mapping.rootPath, streamKey)}
            </span>
          )}
          <span className='text-muted-foreground'>→</span>
          <ResourcePicker
            value={mapping.entityDefinitionId ? [mapping.entityDefinitionId] : []}
            onChange={() => {}}
            emptyLabel='Target def…'
            onSelectSingle={(entityDefinitionId) =>
              setMappingTarget(streamId, {
                mappingId: mapping.id,
                entityDefinitionId,
                targetMode,
                linkMode,
              })
            }
            triggerProps={{ variant: 'outline', className: 'h-6 min-w-[120px] text-xs' }}
          />
        </span>
      }
      trailing={
        <div className='flex items-center gap-1'>
          <IdentityChip
            mapping={mapping}
            leaves={leaves}
            fields={targetFields}
            onSave={(identityStrategy) =>
              setIdentityStrategy(streamId, mapping.id, identityStrategy)
            }
          />
          <TreeRowButton
            variant={linkMode}
            tooltipText={
              linkMode === 'upsert'
                ? 'Upsert — create/update the record. Click to switch to reference (link only).'
                : 'Reference — link only, no writes. Click to switch to upsert.'
            }
            onClick={toggleLinkMode}>
            <span className='px-1 text-[10px] font-medium'>{linkMode}</span>
          </TreeRowButton>
          <TreeRowButton
            variant={targetMode}
            tooltipText={
              targetMode === 'owned'
                ? 'Owned — connector manages this def (archive on orphan). Click to switch to contributing.'
                : 'Contributing — writes into a pre-existing def per-field, never archives. Click to switch to owned.'
            }
            onClick={toggleTargetMode}>
            <span className='px-1 text-[10px] font-medium'>{targetMode}</span>
          </TreeRowButton>
          {/* The root mapping is the stream's spine (seeded on create) — it can't
              be removed (delete the stream instead). Only fan-out children are. */}
          {mapping.parentMappingId !== null && (
            <TreeRowButton
              variant='destructive'
              tooltipText='Remove mapping'
              onClick={() => removeMapping(streamId, mapping.id)}>
              <Trash2 />
            </TreeRowButton>
          )}
        </div>
      }>
      {linkMode === 'reference' ? (
        <ReferenceRow depth={depth + 1} label={resource?.label} leaves={leaves} />
      ) : sourceTree.length === 0 ? (
        <div
          style={{ paddingLeft: `${(depth + 1) * 1.5}rem` }}
          className='px-1 py-1 text-[11px] text-muted-foreground'>
          No source schema yet — generate or edit the schema above to map fields.
        </div>
      ) : (
        sourceTree.map((node) => (
          <SourceNode
            key={node.path}
            node={node}
            depth={depth + 1}
            mapping={mapping}
            targetMode={targetMode}
            targetFields={targetFields}
            sourceToTarget={sourceToTarget}
            mergeStrategies={mergeStrategies}
            childByNodePath={childByNodePath}
            onAssign={assignTarget}
            onClear={clearTarget}
            onMergeChange={(targetKey, value) =>
              setMergeStrategies(streamId, mapping.id, { ...mergeStrategies, [targetKey]: value })
            }
            onPromote={(targetKey) => onPromoteField(mapping.id, targetKey)}
            onFanOut={materializeChild}
            // Child-mapping recursion context.
            streamId={streamId}
            streamKey={streamKey}
            sourcePaths={sourcePaths}
            rootCandidates={rootCandidates}
            byMappingId={byMappingId}
            childrenOf={childrenOf}
            mutations={mutations}
            onPromoteField={onPromoteField}
          />
        ))
      )}

      {/* Child mappings whose branch isn't in the current schema — appended so
          they don't silently disappear (and stay removable). */}
      {linkMode !== 'reference' &&
        orphanChildren.map((child) => (
          <MappingNode
            key={child.id}
            mapping={child}
            depth={depth + 1}
            streamId={streamId}
            sourcePaths={sourcePaths}
            rootCandidates={rootCandidates}
            byMappingId={byMappingId}
            childrenOf={childrenOf}
            mutations={mutations}
            onPromoteField={onPromoteField}
            streamKey={streamKey}
          />
        ))}
    </TreeRow>
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
  sourceToTarget: Map<string, string>
  mergeStrategies: Record<string, string>
  childByNodePath: Map<string, Mapping>
  onAssign: (sourcePath: string, targetKey: string) => void
  onClear: (targetKey: string) => void
  onMergeChange: (targetKey: string, value: string) => void
  onPromote: (targetKey: string) => void
  onFanOut: (
    node: SourceTreeNode,
    linkMode: 'upsert' | 'reference',
    entityDefinitionId: string
  ) => void
  // Child-mapping recursion context (forwarded to a nested MappingNode).
  streamId: string
  streamKey: string
  sourcePaths: SourcePath[]
  rootCandidates: string[]
  byMappingId: Map<string, Mapping>
  childrenOf: Map<string | null, Mapping[]>
  mutations: ReturnType<typeof useStreamMutations>
  onPromoteField: (mappingId: string, fieldKey: string) => void
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
    sourceToTarget,
    mergeStrategies,
    childByNodePath,
    onAssign,
    onClear,
    onMergeChange,
    onPromote,
    onFanOut,
  } = props
  const [open, setOpen] = useState(true)

  // A child mapping at this branch → render it inline (promoted state).
  const childMapping = node.isBranch ? childByNodePath.get(node.path) : undefined
  if (childMapping) {
    return (
      <MappingNode
        mapping={childMapping}
        depth={depth}
        streamId={props.streamId}
        streamKey={props.streamKey}
        sourcePaths={props.sourcePaths}
        rootCandidates={props.rootCandidates}
        byMappingId={props.byMappingId}
        childrenOf={props.childrenOf}
        mutations={props.mutations}
        onPromoteField={props.onPromoteField}
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
        onFanOut={(entityDefinitionId) => onFanOut(node, 'upsert', entityDefinitionId)}
        onReference={(entityDefinitionId) => onFanOut(node, 'reference', entityDefinitionId)}>
        {node.children.map((child) => (
          <SourceNode key={child.path} {...props} node={child} depth={depth + 1} />
        ))}
      </BranchRow>
    )
  }

  const assignedTargetKey = sourceToTarget.get(node.path)
  const assignedLabel = assignedTargetKey
    ? targetFields.find((f) => f.key === assignedTargetKey)?.label
    : undefined
  return (
    <SourceLeafRow
      depth={depth}
      node={node}
      entityDefinitionId={mapping.entityDefinitionId}
      assignedLabel={assignedLabel}
      assignedTargetKey={assignedTargetKey}
      canCreate={targetMode === 'owned'}
      mergeStrategy={
        assignedTargetKey ? (mergeStrategies[assignedTargetKey] ?? 'overwrite') : 'overwrite'
      }
      onAssign={(targetKey) => onAssign(node.path, targetKey)}
      onClear={() => assignedTargetKey && onClear(assignedTargetKey)}
      onMergeChange={(value) => assignedTargetKey && onMergeChange(assignedTargetKey, value)}
      onPromote={() => assignedTargetKey && onPromote(assignedTargetKey)}
    />
  )
}

// ── Shared sub-components ───────────────────────────────────────────────────────

function ReferenceRow({
  depth,
  label,
  leaves,
}: {
  depth: number
  label: string | undefined
  leaves: SourcePath[]
}) {
  // Reference rows resolve inline (no drill): "→ resolve [Resource] by [{source.id}]".
  const sourceId = leaves[0]?.path ?? 'id'
  return (
    <TreeRow
      depth={depth}
      icon={<Hash className='size-3.5' />}
      title={
        <span className='text-sm text-muted-foreground'>
          → resolve <span className='font-medium text-foreground'>{label ?? 'record'}</span> by{' '}
          <span className='font-mono text-xs'>{`{${sourceId}}`}</span>
        </span>
      }
      secondary='if-unresolved: skip'
    />
  )
}

function IdentityChip({
  mapping,
  leaves,
  fields,
  onSave,
}: {
  mapping: Mapping
  leaves: SourcePath[]
  fields: ResourceField[]
  onSave: (
    identityStrategy:
      | { kind: 'connectorExternalId' }
      | {
          kind: 'matchField'
          connectorFieldKey: string
          targetFieldId: string
          normalize?: 'email' | 'phone' | 'domain' | 'none'
        }
      | { kind: 'manualReview' }
  ) => void
}) {
  const identity = mapping.identityStrategy as {
    kind: string
    connectorFieldKey?: string
    targetFieldId?: string
    normalize?: 'email' | 'phone' | 'domain' | 'none'
  }

  // matchField pairs a SOURCE field (relative leaf) with a TARGET field to match
  // against — identifier fields first, else any field.
  const identifierFields = fields.filter((f) => f.isIdentifier)
  const targetFields = identifierFields.length > 0 ? identifierFields : fields

  const label =
    identity.kind === 'matchField'
      ? `id: ${identity.connectorFieldKey || 'field'}`
      : identity.kind === 'connectorExternalId'
        ? 'id: external'
        : identity.kind === 'manualReview'
          ? 'id: review'
          : 'id'

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type='button'
          className='inline-flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-primary-50'>
          <Fingerprint className='size-3' />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align='end' className='w-72'>
        <div className='flex flex-col gap-3'>
          <div className='text-xs font-medium uppercase text-muted-foreground'>Identity</div>
          <Select
            value={identity.kind}
            onValueChange={(kind) => {
              if (kind === 'connectorExternalId') onSave({ kind: 'connectorExternalId' })
              else if (kind === 'manualReview') onSave({ kind: 'manualReview' })
              else if (kind === 'matchField') {
                onSave({
                  kind: 'matchField',
                  connectorFieldKey: leaves[0]?.path ?? '',
                  targetFieldId: targetFields[0]?.id ?? '',
                  normalize: 'none',
                })
              }
            }}>
            <SelectTrigger size='sm'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='matchField'>Match a field</SelectItem>
              <SelectItem value='connectorExternalId'>By connector id</SelectItem>
              <SelectItem value='manualReview'>Manual review</SelectItem>
            </SelectContent>
          </Select>

          {identity.kind === 'matchField' && (
            <>
              <div className='flex flex-col gap-2'>
                <span className='text-xs text-muted-foreground'>Source field</span>
                <Select
                  value={identity.connectorFieldKey ?? ''}
                  onValueChange={(connectorFieldKey) =>
                    onSave({
                      kind: 'matchField',
                      connectorFieldKey,
                      targetFieldId: identity.targetFieldId ?? targetFields[0]?.id ?? '',
                      normalize: identity.normalize ?? 'none',
                    })
                  }>
                  <SelectTrigger size='sm'>
                    <SelectValue placeholder='Source field…' />
                  </SelectTrigger>
                  <SelectContent>
                    {leaves.map((p) => (
                      <SelectItem key={p.path} value={p.path}>
                        {p.path}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className='flex flex-col gap-2'>
                <span className='text-xs text-muted-foreground'>Target field</span>
                <Select
                  value={identity.targetFieldId ?? ''}
                  onValueChange={(targetFieldId) =>
                    onSave({
                      kind: 'matchField',
                      connectorFieldKey: identity.connectorFieldKey ?? leaves[0]?.path ?? '',
                      targetFieldId,
                      normalize: identity.normalize ?? 'none',
                    })
                  }>
                  <SelectTrigger size='sm'>
                    <SelectValue placeholder='Target field…' />
                  </SelectTrigger>
                  <SelectContent>
                    {targetFields.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
