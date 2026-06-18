// apps/web/src/components/data-connectors/ui/mapping-tree.tsx
'use client'

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
import { Braces, Fingerprint, FunctionSquare, Hash, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '~/trpc/react'
import {
  buildSourceTree,
  lastSegment,
  leafPathsUnder,
  rootPathCandidates,
  type SourcePath,
  type SourceTreeNode,
  subtreeUnder,
} from '../hooks/use-source-paths'
import { useStreamMutations } from '../hooks/use-stream-mutations'
import { type TargetDef, type TargetField, useTargetDefs } from '../hooks/use-target-defs'

/** Sentinel for the whole-payload root (`''`) — Radix Select forbids empty values. */
const ROOT_SENTINEL = '__root__'

/** Plain-language description of where a mapping's records come from. */
function describeRootPath(p: string): string {
  if (p === '') return 'whole payload'
  const seg = p.replace(/\[\]$/, '').split('.').pop()
  return seg ? `each ${seg}` : 'each item'
}

type Mapping = NonNullable<
  ReturnType<typeof api.dataConnector.listMappings.useQuery>['data']
>[number]

const MERGE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'overwrite', label: 'overwrite' },
  { value: 'fill_blank', label: 'fill-blank' },
  { value: 'connector_owned_only', label: 'owned-only' },
  { value: 'manual_review', label: 'review' },
  { value: 'ignore', label: 'ignore' },
]

interface MappingTreeProps {
  connectorId: string
  streamId: string
  sourcePaths: SourcePath[]
  /** Promote a value row to the calc drill (the `field` panel). */
  onPromoteField: (mappingId: string, fieldKey: string) => void
}

/**
 * Layer B — the mapping fan-out tree (05 §4). One `TreeRow` tree keyed by source
 * subtree (`rootPath`), parent→child via `parentMappingId`. Mapping rows carry
 * persistent colour-coded mode toggles (link mode · target mode) + an identity
 * chip; value rows carry inline source + merge pickers and a hover `ƒ` promote.
 */
export function MappingTree({
  connectorId,
  streamId,
  sourcePaths,
  onPromoteField,
}: MappingTreeProps) {
  const { defs, byId } = useTargetDefs()
  const mappings = api.dataConnector.listMappings.useQuery({ streamId })
  const rows = mappings.data ?? []

  // Optimistic mapping mutations (instant toggles) with rollback — no refetch.
  const mutations = useStreamMutations(connectorId)
  const { setRootPath } = mutations

  // Valid root-path choices for the root mapping, derived from the source schema.
  const rootCandidates = useMemo(() => rootPathCandidates(sourcePaths), [sourcePaths])

  // Self-heal: the root mapping's rootPath is dictated by the schema root type, so
  // a stored value that isn't a valid candidate (e.g. `''` against an array root)
  // is corrected to the derived default. Guarded on a loaded schema so we never
  // clobber a real value while the schema is still fetching.
  useEffect(() => {
    if (sourcePaths.length === 0 || rootCandidates.length === 0) return
    for (const m of rows) {
      if (m.parentMappingId === null && !rootCandidates.includes(m.rootPath)) {
        setRootPath(streamId, m.id, rootCandidates[0])
      }
    }
  }, [rows, rootCandidates, sourcePaths, streamId, setRootPath])

  // Build the parent→children tree from parentMappingId.
  const childrenOf = useMemo(() => {
    const map = new Map<string | null, Mapping[]>()
    for (const m of rows) {
      const key = m.parentMappingId ?? null
      const list = map.get(key) ?? []
      list.push(m)
      map.set(key, list)
    }
    return map
  }, [rows])

  if (mappings.isLoading) {
    return <div className='px-3 py-2 text-xs text-muted-foreground'>Loading mappings…</div>
  }
  if (rows.length === 0) {
    return (
      <div className='px-3 py-2 text-xs text-muted-foreground'>
        No mappings yet. Generate a schema and the connector seeds mappings, or add one.
      </div>
    )
  }

  const roots = childrenOf.get(null) ?? []
  return (
    <div className='flex flex-col py-1'>
      {roots.map((m) => (
        <MappingNode
          key={m.id}
          mapping={m}
          depth={0}
          streamId={streamId}
          sourcePaths={sourcePaths}
          rootCandidates={rootCandidates}
          childrenOf={childrenOf}
          defs={defs}
          byId={byId}
          mutations={mutations}
          onPromoteField={onPromoteField}
        />
      ))}
    </div>
  )
}

// ── Mapping node (one per DataConnectorMapping; recurses for child mappings) ────

interface MappingNodeProps {
  mapping: Mapping
  depth: number
  streamId: string
  sourcePaths: SourcePath[]
  rootCandidates: string[]
  childrenOf: Map<string | null, Mapping[]>
  defs: TargetDef[]
  byId: Map<string, TargetDef>
  mutations: ReturnType<typeof useStreamMutations>
  onPromoteField: (mappingId: string, fieldKey: string) => void
}

/**
 * A single mapping: an expandable/collapsible `TreeRow` (target def + mode
 * toggles + identity) whose children are the source-schema hierarchy and any
 * nested child mappings — both rendered in the `children` slot so the tree shows
 * real containment + connector lines.
 */
function MappingNode({
  mapping,
  depth,
  streamId,
  sourcePaths,
  rootCandidates,
  childrenOf,
  defs,
  byId,
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
  } = mutations

  const def = byId.get(mapping.entityDefinitionId)
  const linkMode = mapping.linkMode as 'upsert' | 'reference'
  const targetMode = mapping.targetMode as 'owned' | 'contributing'
  const fieldMappings = (mapping.fieldMappings ?? {}) as Record<
    string,
    { expression: string; sourceFields: Record<string, string> }
  >
  const mergeStrategies = (mapping.mergeStrategies ?? {}) as Record<string, string>
  const leaves = leafPathsUnder(sourcePaths, mapping.rootPath)
  const childMappings = childrenOf.get(mapping.id) ?? []

  // The children ARE the source-schema hierarchy under this mapping's rootPath,
  // nested into a real tree. Each leaf gets a target field "applied" to it; a
  // source maps to at most one target, so reverse-index the bare-token mappings.
  const sourceTree = useMemo(
    () => buildSourceTree(subtreeUnder(sourcePaths, mapping.rootPath)),
    [sourcePaths, mapping.rootPath]
  )
  const sourceToTarget = useMemo(() => {
    const map = new Map<string, string>()
    for (const [targetKey, fm] of Object.entries(fieldMappings)) {
      if (isBareToken(fm.expression)) map.set(fm.expression.replace(/^\{|\}$/g, ''), targetKey)
    }
    return map
  }, [fieldMappings])

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

  return (
    <TreeRow
      depth={depth}
      expandable
      isOpen={open}
      onToggleOpen={() => setOpen((o) => !o)}
      icon={<EntityIcon iconId={def?.icon ?? 'table'} size='xs' />}
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
                    {describeRootPath(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className='text-xs text-muted-foreground'>
              {describeRootPath(mapping.rootPath)}
            </span>
          )}
          <span className='text-muted-foreground'>→</span>
          <TargetDefCombobox
            defs={defs}
            value={mapping.entityDefinitionId}
            onChange={(entityDefinitionId) =>
              setMappingTarget(streamId, {
                mappingId: mapping.id,
                entityDefinitionId,
                targetMode,
                linkMode,
              })
            }
          />
        </span>
      }
      trailing={
        <div className='flex items-center gap-1'>
          <IdentityChip
            mapping={mapping}
            leaves={leaves}
            def={def}
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
          <TreeRowButton
            variant='destructive'
            tooltipText='Remove mapping'
            onClick={() => removeMapping(streamId, mapping.id)}>
            <Trash2 />
          </TreeRowButton>
        </div>
      }>
      {/* Reference: a single resolve row. Upsert: the source-schema hierarchy,
          each leaf with a target field applied to it. */}
      {linkMode === 'reference' ? (
        <ReferenceRow depth={depth + 1} mapping={mapping} def={def} leaves={leaves} />
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
            targetFields={def?.fields ?? []}
            sourceToTarget={sourceToTarget}
            mergeStrategies={mergeStrategies}
            onAssign={assignTarget}
            onClear={clearTarget}
            onMergeChange={(targetKey, value) =>
              setMergeStrategies(streamId, mapping.id, { ...mergeStrategies, [targetKey]: value })
            }
            onPromote={(targetKey) => onPromoteField(mapping.id, targetKey)}
          />
        ))
      )}

      {/* Nested child mappings (relations / fan-out collections). */}
      {childMappings.map((child) => (
        <MappingNode
          key={child.id}
          mapping={child}
          depth={depth + 1}
          streamId={streamId}
          sourcePaths={sourcePaths}
          rootCandidates={rootCandidates}
          childrenOf={childrenOf}
          defs={defs}
          byId={byId}
          mutations={mutations}
          onPromoteField={onPromoteField}
        />
      ))}
    </TreeRow>
  )
}

// ── Sub-rows ──────────────────────────────────────────────────────────────────

interface SourceNodeProps {
  node: SourceTreeNode
  depth: number
  targetFields: TargetField[]
  sourceToTarget: Map<string, string>
  mergeStrategies: Record<string, string>
  onAssign: (sourcePath: string, targetKey: string) => void
  onClear: (targetKey: string) => void
  onMergeChange: (targetKey: string, value: string) => void
  onPromote: (targetKey: string) => void
}

/**
 * One node of the source hierarchy. Object/array branches are expandable
 * `TreeRow`s holding their fields; scalar leaves are {@link SourceLeafRow}s with
 * a target-field picker. Recurses so nesting collapses at any level.
 */
function SourceNode(props: SourceNodeProps) {
  const {
    node,
    depth,
    targetFields,
    sourceToTarget,
    mergeStrategies,
    onAssign,
    onClear,
    onMergeChange,
    onPromote,
  } = props
  const [open, setOpen] = useState(true)

  if (node.isBranch) {
    return (
      <TreeRow
        depth={depth}
        expandable
        isOpen={open}
        onToggleOpen={() => setOpen((o) => !o)}
        icon={<Braces className='size-3.5 text-muted-foreground/60' />}
        title={
          <span className='flex items-center gap-1.5 text-sm text-muted-foreground'>
            <span className='font-mono'>{lastSegment(node.path)}</span>
            <span className='text-[10px] uppercase opacity-60'>{node.type}</span>
          </span>
        }>
        {node.children.map((child) => (
          <SourceNode key={child.path} {...props} node={child} depth={depth + 1} />
        ))}
      </TreeRow>
    )
  }

  const assignedTargetKey = sourceToTarget.get(node.path)
  return (
    <SourceLeafRow
      depth={depth}
      node={node}
      targetFields={targetFields}
      assignedTargetKey={assignedTargetKey}
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

/**
 * A source-schema leaf. The label is the source field; the trailing picker
 * "applies" a target field to it. Once applied, the merge picker + `ƒ` (calc)
 * promote + clear appear. A source value maps to at most one target field.
 */
function SourceLeafRow({
  depth,
  node,
  targetFields,
  assignedTargetKey,
  mergeStrategy,
  onAssign,
  onClear,
  onMergeChange,
  onPromote,
}: {
  depth: number
  node: SourcePath
  targetFields: TargetField[]
  assignedTargetKey: string | undefined
  mergeStrategy: string
  onAssign: (targetKey: string) => void
  onClear: () => void
  onMergeChange: (value: string) => void
  onPromote: () => void
}) {
  const isMapped = !!assignedTargetKey
  return (
    <TreeRow
      depth={depth}
      icon={<Hash className={isMapped ? 'size-3.5' : 'size-3.5 text-muted-foreground/50'} />}
      title={
        <span className='flex items-center gap-1.5'>
          <span className={`font-mono text-sm ${isMapped ? '' : 'text-muted-foreground'}`}>
            {lastSegment(node.path)}
          </span>
          <span className='text-[10px] uppercase text-muted-foreground/60'>{node.type}</span>
        </span>
      }
      trailing={
        <div className='flex items-center gap-1'>
          <Select value={assignedTargetKey ?? ''} onValueChange={onAssign}>
            <SelectTrigger size='sm' className='h-6 min-w-[140px] text-xs'>
              <SelectValue placeholder='Apply field…' />
            </SelectTrigger>
            <SelectContent>
              {targetFields.map((f) => (
                <SelectItem key={f.key} value={f.key}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isMapped && (
            <>
              <Select value={mergeStrategy} onValueChange={onMergeChange}>
                <SelectTrigger size='sm' className='h-6 min-w-[96px] text-xs'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MERGE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <TreeRowButton tooltipText='Edit as a formula' onClick={onPromote}>
                <FunctionSquare />
              </TreeRowButton>
              <TreeRowButton tooltipText='Clear mapping' onClick={onClear}>
                <X />
              </TreeRowButton>
            </>
          )}
        </div>
      }
    />
  )
}

function ReferenceRow({
  depth,
  mapping,
  def,
  leaves,
}: {
  depth: number
  mapping: Mapping
  def: TargetDef | undefined
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
          → resolve <span className='font-medium text-foreground'>{def?.label ?? 'record'}</span> by{' '}
          <span className='font-mono text-xs'>{`{${sourceId}}`}</span>
        </span>
      }
      secondary='if-unresolved: skip'
    />
  )
}

function TargetDefCombobox({
  defs,
  value,
  onChange,
}: {
  defs: TargetDef[]
  value: string
  onChange: (entityDefinitionId: string) => void
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size='sm' className='h-6 min-w-[120px] text-xs'>
        <SelectValue placeholder='Target def…' />
      </SelectTrigger>
      <SelectContent>
        {defs.map((d) => (
          <SelectItem key={d.entityDefinitionId} value={d.entityDefinitionId}>
            {d.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function IdentityChip({
  mapping,
  leaves,
  def,
  onSave,
}: {
  mapping: Mapping
  leaves: SourcePath[]
  def: TargetDef | undefined
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
  const identifierFields = def?.fields.filter((f) => f.isIdentifier) ?? []
  const targetFields = identifierFields.length > 0 ? identifierFields : (def?.fields ?? [])

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

/** A degenerate single-token `{path}` expression (one-click row, not a calc). */
function isBareToken(expression: string): boolean {
  return /^\{[^{}]+\}$/.test(expression.trim())
}

export { Plus }
